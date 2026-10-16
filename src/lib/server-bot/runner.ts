/**
 * Bot server: menjalankan semua otomatisasi TANPA perlu tab browser terbuka.
 *
 *  1. Auto-push harga & stok iklan (logika sama persis dengan AutoPricingBotPanel: floor/ceiling,
 *     slew limiter, anti-dump, proteksi kas, deteksi war, backoff).
 *  2. Auto-verify liveness: tersambung sendiri ke chat Binance (WebSocket) + loop cadangan.
 *  3. Auto-sync riwayat transaksi Binance tiap 180 detik.
 *
 * Hanya aktif bila env SERVER_BOT=1 (server lokal yang berjalan terus). Di Vercel/serverless tidak
 * dijalankan. Saat aktif, server memegang "lease" penjalan bot sehingga tab browser hanya memantau.
 * Saklar "Semua Bot", config.enabled, dan config.autoPushToBinance tetap dihormati.
 */
import { hostname } from "node:os";

import { claimBotRunnerLease, getBotConfigServer } from "../background-bot-engine";
import { toggleMerchantAdStatusInternal, updateMerchantAdInternal } from "../binance-merchant";
import { executeBinanceSync, fetchFundingBalanceInternal, type FundingBalance } from "../binance-sync";
import { isBotAutomationEnabled } from "../bot-master-switch";
import { computeCompetitorPricing, type CompetitorFilterConfig } from "../competitor-bot";
import {
  getBinanceChatCredentialsInternal,
  parseLivenessChatMessage,
  processLivenessChatInternal,
} from "../liveness-verifier";
import { getMarketDataInternal } from "../p2p.functions";
import { getActiveOrdersSummaryInternal, getVerifierStateInternal } from "../payment-verifier";
import { computePnlSummaryInternal, type PnlSummary } from "../pnl";
import { applyPriceWarHold, EMPTY_WAR_SIDE, updatePriceWarSide, type PriceWarConfig } from "../price-war-guard";

type Side = "buy" | "sell";
export type ServerBotEvent = { t: number; kind: string; message: string; ok?: boolean };

export type ServerBotStatus = {
  active: boolean;
  startedAt: number;
  runnerLabel: string;
  isLeader: boolean;
  lastTickAt: number;
  lastTickNote: string;
  autoPushRunning: boolean;
  chatConnected: boolean;
  chatLastMessageAt: number;
  lastPushed: { buy?: number; sell?: number };
  events: ServerBotEvent[];
};

const RUNNER_ID = `server-${hostname()}`;
const RUNNER_LABEL = `Server lokal (${hostname()})`;
const MAX_STEP_DEFAULT = 30;

type State = {
  started: boolean;
  status: ServerBotStatus;
  config: { value: CompetitorFilterConfig | null; at: number };
  pnl: { value: PnlSummary | null; at: number };
  funding: { value: FundingBalance | null; at: number };
  orders: { value: Awaited<ReturnType<typeof getActiveOrdersSummaryInternal>> | null; at: number };
  lastPushedPrice: { buy?: number; sell?: number };
  lastPushedStock: { buy?: number | undefined; sell?: number | undefined };
  lastPushTime: number;
  pushFail: { buy: number; sell: number };
  pushRetryAt: { buy: number; sell: number };
  buyAdOfflined: boolean;
  war: { buy: typeof EMPTY_WAR_SIDE; sell: typeof EMPTY_WAR_SIDE };
  ticking: boolean;
  submittedLiveness: Set<string>;
  notified: Record<string, boolean>;
};

const g = globalThis as unknown as { __serverBot?: State };
const st = (): State =>
  (g.__serverBot ??= {
    started: false,
    status: {
      active: false,
      startedAt: 0,
      runnerLabel: RUNNER_LABEL,
      isLeader: false,
      lastTickAt: 0,
      lastTickNote: "",
      autoPushRunning: false,
      chatConnected: false,
      chatLastMessageAt: 0,
      lastPushed: {},
      events: [],
    },
    config: { value: null, at: 0 },
    pnl: { value: null, at: 0 },
    funding: { value: null, at: 0 },
    orders: { value: null, at: 0 },
    lastPushedPrice: {},
    lastPushedStock: {},
    lastPushTime: 0,
    pushFail: { buy: 0, sell: 0 },
    pushRetryAt: { buy: 0, sell: 0 },
    buyAdOfflined: false,
    war: { buy: EMPTY_WAR_SIDE, sell: EMPTY_WAR_SIDE },
    ticking: false,
    submittedLiveness: new Set(),
    notified: {},
  });

function log(kind: string, message: string, ok?: boolean): void {
  const s = st();
  s.status.events.unshift({ t: Date.now(), kind, message, ...(ok !== undefined ? { ok } : {}) });
  if (s.status.events.length > 60) s.status.events.length = 60;
  console.log(`[server-bot] ${kind}: ${message}`);
}

/** Catat sekali sampai kondisinya berubah (agar log tidak banjir tiap detik). */
function logOnce(key: string, kind: string, message: string): void {
  const s = st();
  if (s.notified[key]) return;
  s.notified[key] = true;
  log(kind, message);
}
function clearOnce(key: string): void {
  st().notified[key] = false;
}

export function getServerBotStatusInternal(): ServerBotStatus {
  const s = st();
  return { ...s.status, lastPushed: { ...s.lastPushedPrice }, events: s.status.events.slice(0, 30) };
}

async function cached<T>(slot: { value: T | null; at: number }, ttlMs: number, load: () => Promise<T>): Promise<T | null> {
  if (slot.value !== null && Date.now() - slot.at < ttlMs) return slot.value;
  try {
    slot.value = await load();
    slot.at = Date.now();
  } catch (err) {
    log("error", `Gagal memuat data: ${err instanceof Error ? err.message : String(err)}`, false);
  }
  return slot.value;
}

// ── 1. Auto-push harga ──────────────────────────────────────────────────────

type TickContext = {
  config: CompetitorFilterConfig;
  pricing: ReturnType<typeof computeCompetitorPricing>;
  recommendedBuyPrice: number;
  recommendedSellPrice: number;
  fairPrice: number;
  maxAvailableSellStockUsdt: number;
  hasActiveSellOrder: boolean;
};

async function pushSide(side: Side, requestedPrice: number, ctx: TickContext): Promise<{ ok: boolean; code?: string; price: number }> {
  const { config, pricing } = ctx;
  const advNo = (side === "buy" ? config.merchantBuyAdvNo : config.merchantSellAdvNo)?.trim();
  if (!advNo) return { ok: false, price: requestedPrice };
  const bankAllocation = pricing.bankAllocation;

  if (side === "buy" && (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0)) {
    if (bankAllocation.isBelowMinLimit || bankAllocation.autoBuyStockUsdt <= 0) {
      await toggleMerchantAdStatusInternal(advNo, "OFFLINE").catch(() => undefined);
      return { ok: false, price: requestedPrice };
    }
  }

  let price = Math.round(requestedPrice);
  const effectiveSellFloor = Math.max(pricing.sellGuard.floorPrice || 0, config.manualSellFloorRp || 0, config.minPriceBoundRp || 0);
  if (side === "sell" && effectiveSellFloor > 0 && price < effectiveSellFloor) price = effectiveSellFloor;
  const effectiveBuyFloor = Math.max(pricing.buyGuard.floorPrice || 0, config.manualBuyFloorRp || 0);
  if (side === "buy" && effectiveBuyFloor > 0 && price < effectiveBuyFloor) price = effectiveBuyFloor;
  const effectiveBuyCeiling =
    config.buyCeilingMode === "manual" && config.manualBuyCeilingRp > 0 && config.manualBuyCeilingRp < 999_999
      ? config.manualBuyCeilingRp
      : pricing.buyGuard.ceilingPrice || 0;
  if (side === "buy" && effectiveBuyCeiling > 0 && price > effectiveBuyCeiling) price = effectiveBuyCeiling;
  if (config.maxPriceBoundRp && config.maxPriceBoundRp > 0 && price > config.maxPriceBoundRp) {
    price = side === "sell" && effectiveSellFloor > 0 && config.maxPriceBoundRp < effectiveSellFloor ? effectiveSellFloor : config.maxPriceBoundRp;
  }

  const stock =
    side === "buy"
      ? config.manualBuyStockUsdt && config.manualBuyStockUsdt > 0
        ? config.manualBuyStockUsdt
        : bankAllocation.autoBuyStockUsdt > 0
          ? bankAllocation.autoBuyStockUsdt
          : undefined
      : config.manualSellStockUsdt && config.manualSellStockUsdt > 0
        ? config.manualSellStockUsdt
        : ctx.maxAvailableSellStockUsdt > 0
          ? ctx.maxAvailableSellStockUsdt
          : undefined;
  const maxLimit =
    side === "buy"
      ? config.manualBuyMaxLimitIdr && config.manualBuyMaxLimitIdr > 0
        ? config.manualBuyMaxLimitIdr
        : 500_000_000
      : config.manualSellMaxLimitIdr && config.manualSellMaxLimitIdr > 0
        ? config.manualSellMaxLimitIdr
        : stock && price > 0
          ? Math.floor(stock * price)
          : undefined;
  const minLimit =
    side === "buy"
      ? config.manualBuyMinLimitIdr && config.manualBuyMinLimitIdr > 0
        ? config.manualBuyMinLimitIdr
        : 50_000_000
      : config.manualSellMinLimitIdr && config.manualSellMinLimitIdr > 0
        ? config.manualSellMinLimitIdr
        : undefined;
  const hasActiveOrders = side === "sell" ? ctx.hasActiveSellOrder : false;
  const floorPrice = side === "sell" ? (effectiveSellFloor > 0 ? effectiveSellFloor : undefined) : effectiveBuyFloor > 0 ? effectiveBuyFloor : undefined;
  const ceilingPrice = side === "buy" && effectiveBuyCeiling > 0 ? effectiveBuyCeiling : undefined;

  // Cek terakhir tepat sebelum mengirim: saklar utama & lease (seperti pushPriceToBinanceAd).
  if (!(await isBotAutomationEnabled())) return { ok: false, price };
  const lease = await claimBotRunnerLease(RUNNER_ID, { label: RUNNER_LABEL, takeover: true });
  if (!lease.isLeader) return { ok: false, price };

  const res = await updateMerchantAdInternal({
    advNo,
    side,
    price,
    ...(!hasActiveOrders && stock !== undefined ? { amount: stock } : {}),
    ...(!hasActiveOrders && minLimit !== undefined ? { minSingleTransAmount: minLimit } : {}),
    ...(!hasActiveOrders && maxLimit !== undefined ? { maxSingleTransAmount: maxLimit } : {}),
    ...(floorPrice !== undefined ? { floorPrice } : {}),
    ...(ceilingPrice !== undefined ? { ceilingPrice } : {}),
    hasActiveOrders,
    priceOnly: hasActiveOrders,
  });
  const code = typeof res.code === "string" ? res.code : res.code !== undefined ? String(res.code) : undefined;
  const sent = (res.data as { targetPrice?: number } | undefined)?.targetPrice;
  const sentPrice = typeof sent === "number" && sent > 0 ? sent : price;
  log("push", `${side === "buy" ? "BELI" : "JUAL"} Rp ${sentPrice.toLocaleString("id-ID")}: ${res.message ?? code ?? ""}`, res.ok);
  return { ok: res.ok, ...(code ? { code } : {}), price: sentPrice };
}

function recordPushResult(side: Side, res: { ok: boolean; code?: string; price: number } | undefined, stock: number | undefined, recordStock: boolean) {
  const s = st();
  if (!res || !res.ok) {
    s.pushFail[side] += 1;
    s.pushRetryAt[side] = Date.now() + Math.min(60_000, 5_000 * 2 ** (s.pushFail[side] - 1));
    return;
  }
  s.pushFail[side] = 0;
  s.pushRetryAt[side] = 0;
  if (res.code?.startsWith("AUTO_OFFLINED")) return;
  s.lastPushedPrice[side] = res.price;
  if (recordStock) s.lastPushedStock[side] = stock;
}

async function autoPushTick(): Promise<void> {
  const s = st();
  const config = await cached(s.config, 5_000, getBotConfigServer);
  if (!config) return;
  const master = await isBotAutomationEnabled();
  s.status.autoPushRunning = Boolean(master && config.enabled && config.autoPushToBinance);
  if (!s.status.autoPushRunning) {
    s.status.lastTickNote = !master ? "Saklar utama OFF" : !config.enabled ? "Bot OFF" : "Auto-push OFF";
    return;
  }

  // Lease: server selalu jadi penjalan bot (tab browser hanya memantau).
  const lease = await claimBotRunnerLease(RUNNER_ID, { label: RUNNER_LABEL, takeover: true });
  s.status.isLeader = lease.isLeader;
  if (!lease.isLeader) return;

  const market = await getMarketDataInternal();
  if (market.isMock || market.sellRefAds.length === 0 || market.buyRefAds.length === 0) {
    logOnce("mock", "warn", "Data pasar Binance tidak tersedia (mock/kosong). Auto-push ditahan.");
    s.status.lastTickNote = "Menunggu data pasar Binance";
    return;
  }
  clearOnce("mock");

  const [pnl, funding, orders] = await Promise.all([
    cached(s.pnl, 60_000, computePnlSummaryInternal),
    cached(s.funding, 30_000, fetchFundingBalanceInternal),
    cached(s.orders, 10_000, getActiveOrdersSummaryInternal),
  ]);
  if (!pnl) {
    logOnce("pnl", "warn", "Data P&L belum termuat. Auto-push menunggu (agar batas bawah jual tidak 0).");
    s.status.lastTickNote = "Menunggu data P&L";
    return;
  }
  clearOnce("pnl");

  // Masukan identik dengan dashboard (src/routes/index.tsx).
  const initialCapital = pnl.initial_capital_idr && pnl.initial_capital_idr > 0 ? pnl.initial_capital_idr : 180_000_000;
  const isFundingLive = funding && funding.usdt !== null && !funding.error && !funding.not_configured;
  const stockUsdt = isFundingLive ? (funding!.usdt ?? 0) : (pnl.open_position_usdt ?? 0);
  const effectiveCost = pnl.open_position_avg_cost_idr > 0 ? pnl.open_position_avg_cost_idr : 0;
  const stockValuationCost = effectiveCost > 0 ? effectiveCost : market.fairPrice > 0 ? market.fairPrice : 17_850;
  const stockCapitalIdr = stockUsdt > 0 ? Math.round(stockUsdt * stockValuationCost) : 0;
  const freeCashIdr = Math.max(0, initialCapital - stockCapitalIdr + (pnl.all_time_profit_idr ?? 0));

  const pricing = computeCompetitorPricing({
    sellRefAds: market.sellRefAds,
    buyRefAds: market.buyRefAds,
    config,
    stockHpp: effectiveCost,
    fairPrice: market.fairPrice,
    bankBalanceIdr: freeCashIdr,
    initialCapitalIdr: initialCapital,
    liveStockUsdt: stockUsdt,
    stockCapitalIdr,
    activeBuyOrdersUsdt: orders?.totalActiveBuyUsdt || 0,
    activeBuyOrdersIdr: orders?.totalActiveBuyIdr || 0,
    indodaxSpotPrice: market.indodaxSpotPrice,
  });

  // Deteksi war antar bot (sama dengan panel).
  const warCfg: PriceWarConfig = {
    enabled: config.priceWarGuardEnabled !== false,
    windowSec: config.priceWarWindowSec ?? 60,
    minSteps: config.priceWarMinSteps ?? 3,
    minMoveRp: config.priceWarMinMoveRp ?? 10,
    cooldownSec: config.priceWarCooldownSec ?? 120,
  };
  const now = Date.now();
  const wasWar = { buy: s.war.buy.active, sell: s.war.sell.active };
  s.war.buy = updatePriceWarSide(s.war.buy, pricing.recommendedBuyPrice, now, warCfg, "up");
  s.war.sell = updatePriceWarSide(s.war.sell, pricing.recommendedSellPrice, now, warCfg, "down");
  for (const side of ["buy", "sell"] as const) {
    if (s.war[side].active && !wasWar[side]) {
      log("war", `War bot terdeteksi di sisi ${side === "buy" ? "BELI" : "JUAL"}: harga ditahan di Rp ${s.war[side].holdPrice.toLocaleString("id-ID")}.`);
    } else if (!s.war[side].active && wasWar[side]) {
      log("war", `War sisi ${side === "buy" ? "beli" : "jual"} mereda.`);
    }
  }
  const recommendedBuyPrice = applyPriceWarHold(pricing.recommendedBuyPrice, s.war.buy, "up");
  const recommendedSellPrice = applyPriceWarHold(pricing.recommendedSellPrice, s.war.sell, "down");

  const maxAvailableSellStockUsdt = stockUsdt > 0 ? Math.max(0, Math.floor((stockUsdt / 1.0005) * 100) / 100) : 0;
  const cleanSellAdvNo = config.merchantSellAdvNo?.trim().replace(/^#/, "");
  const hasActiveSellOrder = Boolean(
    cleanSellAdvNo && (orders?.activeSellOrders ?? []).some((o) => o.advNo && o.advNo.trim().replace(/^#/, "") === cleanSellAdvNo),
  );
  const ctx: TickContext = { config, pricing, recommendedBuyPrice, recommendedSellPrice, fairPrice: market.fairPrice, maxAvailableSellStockUsdt, hasActiveSellOrder };
  s.status.lastTickNote = `Beli Rp ${Math.round(recommendedBuyPrice).toLocaleString("id-ID")} · Jual Rp ${Math.round(recommendedSellPrice).toLocaleString("id-ID")}`;

  const minIntervalMs = Math.max(1, config.autoPushMinIntervalSec ?? 1) * 1000;
  if (now - s.lastPushTime < minIntervalMs) return;
  const maxStep = Math.max(50, (config.maxPriceStepRp || MAX_STEP_DEFAULT) * 2);
  let buyTriggered = false;

  // ── Sisi BELI ──
  if (config.merchantBuyAdvNo && recommendedBuyPrice > 0 && now >= s.pushRetryAt.buy) {
    const isBuyBlocked =
      (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0) &&
      (pricing.bankAllocation.isBelowMinLimit || pricing.bankAllocation.autoBuyStockUsdt <= 0);
    if (isBuyBlocked) {
      if (!s.buyAdOfflined) {
        const res = await toggleMerchantAdStatusInternal(config.merchantBuyAdvNo.trim(), "OFFLINE").catch(() => null);
        if (res?.ok) {
          s.buyAdOfflined = true;
          log("push", `Kas beli Rp ${pricing.bankAllocation.usableBankIdr.toLocaleString("id-ID")} di bawah batas minimal: iklan beli di-OFFLINE-kan.`, true);
        }
      }
    } else {
      if (s.buyAdOfflined) {
        s.buyAdOfflined = false;
        await toggleMerchantAdStatusInternal(config.merchantBuyAdvNo.trim(), "ONLINE").catch(() => undefined);
      }
      let rounded = Math.round(recommendedBuyPrice);
      const buyFloor = Math.max(pricing.buyGuard.floorPrice || 0, config.manualBuyFloorRp || 0);
      if (!(buyFloor > 0 && rounded < buyFloor)) {
        const last = s.lastPushedPrice.buy;
        if ((!config.manualBuyPriceOverrideRp || config.manualBuyPriceOverrideRp <= 0) && last && last > 10_000) {
          if (rounded > last + maxStep) rounded = last + maxStep;
          else if (rounded < last - maxStep) rounded = last - maxStep;
        }
        const stock =
          config.manualBuyStockUsdt && config.manualBuyStockUsdt > 0 ? config.manualBuyStockUsdt : pricing.bankAllocation.autoBuyStockUsdt;
        if (s.lastPushedPrice.buy !== rounded || s.lastPushedStock.buy !== stock) {
          s.lastPushTime = now;
          buyTriggered = true;
          const res = await pushSide("buy", rounded, ctx).catch((err) => {
            log("error", `Push beli gagal: ${err instanceof Error ? err.message : String(err)}`, false);
            return undefined;
          });
          recordPushResult("buy", res, stock, true);
        }
      }
    }
  }

  // ── Sisi JUAL ──
  if (config.merchantSellAdvNo && recommendedSellPrice > 0 && Date.now() >= s.pushRetryAt.sell) {
    const sellFloor = Math.max(pricing.sellGuard.floorPrice || 0, config.manualSellFloorRp || 0, config.minPriceBoundRp || 0);
    let rounded = Math.round(recommendedSellPrice);
    if (sellFloor > 0 && rounded < sellFloor) rounded = sellFloor;
    const last = s.lastPushedPrice.sell;
    if ((!config.manualSellPriceOverrideRp || config.manualSellPriceOverrideRp <= 0) && last && last > 10_000) {
      if (rounded > last + maxStep) rounded = last + maxStep;
      else if (rounded < last - maxStep) rounded = last - maxStep;
    }
    if (sellFloor > 0 && rounded < sellFloor) rounded = sellFloor;
    if (!config.manualSellPriceOverrideRp || config.manualSellPriceOverrideRp <= 0) {
      const anchor = market.fairPrice > 10_000 ? market.fairPrice : 0;
      const antiDumpFloor = anchor > 0 ? Math.max(sellFloor, anchor - 35) : sellFloor;
      if (antiDumpFloor > 0 && rounded < antiDumpFloor) rounded = antiDumpFloor;
    }
    if (config.maxPriceBoundRp && config.maxPriceBoundRp > 0 && rounded > config.maxPriceBoundRp) {
      rounded = sellFloor > 0 && config.maxPriceBoundRp < sellFloor ? sellFloor : config.maxPriceBoundRp;
    }
    const stock =
      config.manualSellStockUsdt && config.manualSellStockUsdt > 0
        ? config.manualSellStockUsdt
        : maxAvailableSellStockUsdt > 0
          ? maxAvailableSellStockUsdt
          : undefined;
    const priceChanged = s.lastPushedPrice.sell !== rounded;
    const stockChanged = !hasActiveSellOrder && s.lastPushedStock.sell !== stock;
    if (priceChanged || stockChanged) {
      s.lastPushTime = Date.now();
      // Jeda 1 detik setelah push beli agar request tidak bertabrakan di Binance SAPI.
      if (buyTriggered) await new Promise((r) => setTimeout(r, 1000));
      const res = await pushSide("sell", rounded, ctx).catch((err) => {
        log("error", `Push jual gagal: ${err instanceof Error ? err.message : String(err)}`, false);
        return undefined;
      });
      recordPushResult("sell", res, stock, !hasActiveSellOrder);
    }
  }
}

async function tickLoop(): Promise<void> {
  const s = st();
  for (;;) {
    const started = Date.now();
    if (!s.ticking) {
      s.ticking = true;
      try {
        await autoPushTick();
      } catch (err) {
        log("error", `Siklus bot gagal: ${err instanceof Error ? err.message : String(err)}`, false);
      } finally {
        s.ticking = false;
        s.status.lastTickAt = Date.now();
      }
    }
    const intervalMs = Math.max(1000, (s.config.value?.autoPushMinIntervalSec ?? 1) * 1000);
    await new Promise((r) => setTimeout(r, Math.max(250, intervalMs - (Date.now() - started))));
  }
}

// ── 2. Auto-verify liveness (chat Binance) ──────────────────────────────────

function connectChat(): void {
  const s = st();
  const reconnect = (ms: number) => setTimeout(connectChat, ms);
  void (async () => {
    const creds = await getBinanceChatCredentialsInternal().catch((err) => ({ ok: false, error: String(err) }) as const);
    if (!creds.ok || !("listenKey" in creds) || !creds.chatWssUrl || !creds.listenKey) {
      logOnce("chat-creds", "chat", `Gagal mengambil kredensial chat: ${"error" in creds ? creds.error : "tidak lengkap"}`);
      reconnect(30_000);
      return;
    }
    clearOnce("chat-creds");
    const raw = creds.chatWssUrl.trim();
    const base = (/^wss?:\/\//.test(raw) ? raw : `wss://${raw}`).replace(/\/+$/, "");
    const ws = new WebSocket(`${base}/${creds.listenKey}?token=${creds.listenToken}&clientType=web`);
    let ping: ReturnType<typeof setInterval> | undefined;
    ws.onopen = () => {
      s.status.chatConnected = true;
      log("chat", "Terhubung ke chat Binance (auto-verify liveness aktif).", true);
      ping = setInterval(() => {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        } catch {}
      }, 25_000);
    };
    ws.onmessage = (event) => {
      s.status.chatLastMessageAt = Date.now();
      if (typeof event.data !== "string") return;
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const item of (Array.isArray(payload) ? payload : [payload]) as Record<string, any>[]) {
        if (!item || typeof item !== "object") continue;
        const msgType = String(item["type"] || item["msgType"] || item["data"]?.type || "").toLowerCase();
        if (msgType === "statistics" || msgType === "pong") continue;
        const rawContent = item["data"]?.content ?? item["content"] ?? item["text"] ?? item["data"]?.text ?? item["message"] ?? "";
        const content = typeof rawContent === "string" ? rawContent : rawContent ? JSON.stringify(rawContent) : "";
        const parsed = parseLivenessChatMessage(content);
        if (!parsed.isLivenessMessage || !parsed.isCompleted) continue;
        const envelopeOrderNo = item["orderNo"] || item["data"]?.orderNo || item["orderNumber"];
        const key = String(parsed.orderNumber || envelopeOrderNo || "?");
        if (s.submittedLiveness.has(key)) continue;
        s.submittedLiveness.add(key);
        const fromSelf = typeof item["self"] === "boolean" ? item["self"] : typeof item["data"]?.self === "boolean" ? item["data"].self : undefined;
        void processLivenessChatInternal({
          chatText: content,
          source: "binance_chat_ws",
          ...(parsed.orderNumber || envelopeOrderNo ? { orderNumberHint: String(parsed.orderNumber || envelopeOrderNo) } : {}),
          messageType: msgType,
          ...(fromSelf !== undefined ? { fromSelf } : {}),
          ...(envelopeOrderNo ? { envelopeOrderNo: String(envelopeOrderNo) } : {}),
        } as Parameters<typeof processLivenessChatInternal>[0])
          .then((res) => log("liveness", res.message, res.ok))
          .catch((err) => {
            s.submittedLiveness.delete(key);
            log("error", `Proses liveness gagal: ${err instanceof Error ? err.message : String(err)}`, false);
          });
      }
    };
    ws.onclose = (ev) => {
      if (ping) clearInterval(ping);
      if (s.status.chatConnected) log("chat", `Koneksi chat Binance terputus (kode ${ev.code}). Menyambung ulang...`);
      s.status.chatConnected = false;
      reconnect(5_000);
    };
    ws.onerror = () => {
      // onclose menyusul otomatis
    };
  })();
}

/** Loop cadangan: coba ulang auto-verify order yang liveness-nya sudah tercatat (mis. sempat ditolak Binance). */
async function verifierBackupLoop(): Promise<void> {
  for (;;) {
    try {
      await getVerifierStateInternal();
    } catch (err) {
      logOnce("verifier", "error", `Loop cadangan verifier gagal: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

// ── 3. Auto-sync riwayat transaksi ──────────────────────────────────────────

async function syncLoop(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20_000));
  for (;;) {
    const key = process.env["BINANCE_API_KEY"]?.trim();
    const secret = process.env["BINANCE_API_SECRET"]?.trim();
    if (key && secret && (await isBotAutomationEnabled())) {
      try {
        const res = await executeBinanceSync(key, secret);
        if (res.ok && res.added > 0) {
          log("sync", `Sinkron Binance: ${res.added} transaksi baru.`, true);
          st().pnl.at = 0; // P&L dihitung ulang dengan transaksi baru
        } else if (!res.ok) {
          logOnce("sync", "sync", `Sinkron Binance gagal: ${res.error ?? "?"}`);
        } else {
          clearOnce("sync");
        }
      } catch (err) {
        logOnce("sync", "error", `Sinkron Binance gagal: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 180_000));
  }
}

export function startServerBot(): void {
  if (process.env["SERVER_BOT"] !== "1") return;
  const s = st();
  if (s.started) return;
  s.started = true;
  s.status.active = true;
  s.status.startedAt = Date.now();
  log("start", `Bot server dimulai (${RUNNER_LABEL}). Tab browser tidak perlu terbuka.`, true);
  void tickLoop();
  connectChat();
  void verifierBackupLoop();
  void syncLoop();
}
