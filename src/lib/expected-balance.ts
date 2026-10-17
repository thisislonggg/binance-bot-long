/**
 * Perkiraan saldo rekening bank dari order P2P yang sudah selesai.
 *
 * Anda menyetel saldo awal (angka asli di m-banking) satu kali. Sejak itu setiap order
 * yang selesai di Binance otomatis menggeser perkiraan: order JUAL selesai (sudah Anda release)
 * = uang masuk (+), order BELI selesai = uang keluar (−).
 *
 * Order yang saat saldo disetel sudah selesai / sudah ditandai bayar dianggap sudah termasuk
 * di angka saldo itu, jadi tidak dihitung dua kali.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { fetchC2cOrdersForWindow, type BinanceC2cOrder } from "./binance-sync";
import { parseFlexibleNumber } from "./pnl";
import { getSupabase } from "./supabase";

const ANCHOR_KEY = "expected_balance_anchor";
const CACHE_MS = 10_000;
const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;
/** Order dicari berdasarkan waktu dibuat: mundur 24 jam agar order yang dibuat sebelum saldo disetel ikut terbaca. */
const LOOKBACK_MS = 24 * MS_HOUR;

type Anchor = {
  balanceIdr: number;
  ts: number;
  /** Order yang sudah tercermin di saldo awal (selesai / sudah dibayar saat saldo disetel). */
  included: string[];
  /** Metode yang tidak lewat rekening ini, format "sell:BANKBRI" / "buy:BCAMobile". */
  excludedMethods: string[];
};

type OrderRow = {
  orderNumber: string;
  side: "buy" | "sell";
  totalIdr: number;
  status: string;
  createTime: number;
  nickname: string;
  method: string;
};

export type ExpectedBalanceEntry = {
  orderNumber: string;
  side: "buy" | "sell";
  totalIdr: number;
  createTime: number;
  nickname: string;
  method: string;
  /** counted = sudah masuk perkiraan, pending = sudah dibayar tapi belum selesai, skipped = metode tidak dihitung */
  state: "counted" | "pending" | "skipped";
};

export type ExpectedBalanceMethod = { key: string; side: "buy" | "sell"; method: string; count: number; excluded: boolean };

export type ExpectedBalanceState = {
  configured: boolean;
  anchor: { balanceIdr: number; ts: number } | null;
  expectedIdr: number;
  inIdr: number;
  outIdr: number;
  sellCount: number;
  buyCount: number;
  pendingInIdr: number;
  pendingOutIdr: number;
  pendingCount: number;
  entries: ExpectedBalanceEntry[];
  methods: ExpectedBalanceMethod[];
  updatedAt: number;
  error?: string;
};

// ── Status order ────────────────────────────────────────────────────────────
function isCompletedStatus(s: string): boolean {
  return s.includes("COMPLET") || s.includes("SUCCESS") || s.includes("FINISH") || s === "4";
}
/** Sudah ditandai bayar tapi belum selesai: uangnya sudah berpindah di bank. */
function isPaidStatus(s: string): boolean {
  return (
    s.includes("BUYER_PAYED") ||
    s.includes("PAID") ||
    s.includes("DISTRIBUTING") ||
    s.includes("TO_RELEASE") ||
    s.includes("APPEAL") ||
    s === "2" ||
    s === "3"
  );
}

function toRow(o: BinanceC2cOrder): OrderRow | null {
  const orderNumber = String(o.orderNumber || "");
  const asset = String(o.asset ?? "USDT").toUpperCase();
  const fiat = String(o.fiat ?? "IDR").toUpperCase();
  if (!orderNumber || !asset.includes("USD") || !fiat.includes("IDR")) return null;
  const totalIdr = parseFlexibleNumber(o.totalPrice);
  if (!(totalIdr > 0)) return null;
  return {
    orderNumber,
    side: String(o.tradeType).toUpperCase().includes("BUY") ? "buy" : "sell",
    totalIdr,
    status: String(o.orderStatus ?? "").toUpperCase(),
    createTime: Number(o.createTime) || 0,
    nickname: String(o.counterPartNickName || ""),
    method: String(o.payMethodName || "Lainnya"),
  };
}

function apiKeys(): { key: string; secret: string } | null {
  const key = process.env["BINANCE_API_KEY"]?.trim();
  const secret = process.env["BINANCE_API_SECRET"]?.trim();
  if (!key || !secret || key === "your_binance_api_key_here") return null;
  return { key, secret };
}

async function fetchOrders(startMs: number, endMs: number): Promise<OrderRow[]> {
  const keys = apiKeys();
  if (!keys) return [];
  const rows: OrderRow[] = [];
  // Binance membatasi satu query maksimal 30 hari.
  for (let start = startMs; start < endMs; start += 25 * MS_DAY) {
    const end = Math.min(start + 25 * MS_DAY, endMs);
    const [buy, sell] = await Promise.all([
      fetchC2cOrdersForWindow(keys.key, keys.secret, "BUY", start, end),
      fetchC2cOrdersForWindow(keys.key, keys.secret, "SELL", start, end),
    ]);
    for (const o of [...buy, ...sell]) {
      const r = toRow(o);
      if (r) rows.push(r);
    }
  }
  return rows;
}

// ── Penyimpanan saldo awal (Supabase, atau memori bila tanpa database) ─────────
const mem = globalThis as any;

async function loadAnchor(): Promise<Anchor | null> {
  const db = getSupabase();
  if (!db) return (mem.__p2pExpectedBalanceAnchor as Anchor | undefined) ?? null;
  const { data } = await db.from("user_settings").select("value").eq("key", ANCHOR_KEY).maybeSingle();
  const raw = (data as { value?: string } | null)?.value;
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Anchor;
    if (!(a.ts > 0) || !Number.isFinite(a.balanceIdr)) return null;
    return { ...a, included: a.included ?? [], excludedMethods: a.excludedMethods ?? [] };
  } catch {
    return null;
  }
}

async function saveAnchor(anchor: Anchor): Promise<void> {
  const db = getSupabase();
  if (!db) {
    mem.__p2pExpectedBalanceAnchor = anchor;
    return;
  }
  const { error } = await db
    .from("user_settings")
    .upsert({ key: ANCHOR_KEY, value: JSON.stringify(anchor) } as any, { onConflict: "key" });
  if (error) throw new Error(`Gagal menyimpan saldo awal: ${error.message}`);
}

// ── Cache order: order lama sudah final, cukup ambil ulang 24 jam terakhir ────
type Cache = { anchorTs: number; orders: Map<string, OrderRow>; fetchedUntil: number; fetchedAt: number };
let inflight: Promise<Cache> | null = null;

async function refreshOrders(anchor: Anchor): Promise<Cache> {
  const now = Date.now();
  const cur = mem.__p2pExpectedBalanceCache as Cache | undefined;
  if (cur && cur.anchorTs === anchor.ts && now - cur.fetchedAt < CACHE_MS) return cur;
  if (inflight) return inflight;
  inflight = (async () => {
    const reuse = cur && cur.anchorTs === anchor.ts;
    const start = reuse ? cur.fetchedUntil - LOOKBACK_MS : anchor.ts - LOOKBACK_MS;
    const rows = await fetchOrders(start, now);
    const orders = reuse ? new Map(cur.orders) : new Map<string, OrderRow>();
    for (const r of rows) orders.set(r.orderNumber, r);
    const next: Cache = { anchorTs: anchor.ts, orders, fetchedUntil: now, fetchedAt: Date.now() };
    mem.__p2pExpectedBalanceCache = next;
    return next;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function emptyState(configured: boolean, anchor: Anchor | null, error?: string): ExpectedBalanceState {
  return {
    configured,
    anchor: anchor ? { balanceIdr: anchor.balanceIdr, ts: anchor.ts } : null,
    expectedIdr: anchor?.balanceIdr ?? 0,
    inIdr: 0,
    outIdr: 0,
    sellCount: 0,
    buyCount: 0,
    pendingInIdr: 0,
    pendingOutIdr: 0,
    pendingCount: 0,
    entries: [],
    methods: [],
    updatedAt: Date.now(),
    ...(error ? { error } : {}),
  };
}

export async function getExpectedBalanceInternal(): Promise<ExpectedBalanceState> {
  const configured = Boolean(apiKeys());
  const anchor = await loadAnchor();
  if (!anchor || !configured) return emptyState(configured, anchor);

  let cache: Cache;
  try {
    cache = await refreshOrders(anchor);
  } catch (e: any) {
    return emptyState(configured, anchor, e?.message || String(e));
  }

  const included = new Set(anchor.included);
  const excluded = new Set(anchor.excludedMethods);
  const state = emptyState(configured, anchor);
  const methodCounts = new Map<string, ExpectedBalanceMethod>();
  const entries: ExpectedBalanceEntry[] = [];

  for (const o of cache.orders.values()) {
    const done = isCompletedStatus(o.status);
    const paid = !done && isPaidStatus(o.status);
    if (!done && !paid) continue;

    const key = `${o.side}:${o.method}`;
    const m = methodCounts.get(key) ?? { key, side: o.side, method: o.method, count: 0, excluded: excluded.has(key) };
    m.count++;
    methodCounts.set(key, m);

    if (included.has(o.orderNumber) || o.createTime < anchor.ts - LOOKBACK_MS) continue;
    const skipped = excluded.has(key);
    const entryState: ExpectedBalanceEntry["state"] = skipped ? "skipped" : done ? "counted" : "pending";
    entries.push({
      orderNumber: o.orderNumber,
      side: o.side,
      totalIdr: o.totalIdr,
      createTime: o.createTime,
      nickname: o.nickname,
      method: o.method,
      state: entryState,
    });
    if (skipped) continue;

    if (done) {
      if (o.side === "sell") {
        state.inIdr += o.totalIdr;
        state.sellCount++;
      } else {
        state.outIdr += o.totalIdr;
        state.buyCount++;
      }
    } else {
      state.pendingCount++;
      if (o.side === "sell") state.pendingInIdr += o.totalIdr;
      else state.pendingOutIdr += o.totalIdr;
    }
  }

  state.expectedIdr = Math.round(anchor.balanceIdr + state.inIdr - state.outIdr);
  state.inIdr = Math.round(state.inIdr);
  state.outIdr = Math.round(state.outIdr);
  state.pendingInIdr = Math.round(state.pendingInIdr);
  state.pendingOutIdr = Math.round(state.pendingOutIdr);
  state.entries = entries.sort((a, b) => b.createTime - a.createTime).slice(0, 25);
  state.methods = [...methodCounts.values()].sort((a, b) => a.side.localeCompare(b.side) || b.count - a.count);
  state.updatedAt = cache.fetchedAt;
  return state;
}

/** Setel saldo awal = saldo asli di bank sekarang. */
export async function setExpectedBalanceAnchorInternal(balanceIdr: number): Promise<ExpectedBalanceState> {
  if (!apiKeys()) throw new Error("API key Binance belum diisi");
  const now = Date.now();
  // Gagal ambil order = jangan simpan: tanpa daftar ini order lama bisa terhitung dua kali.
  const rows = await fetchOrders(now - LOOKBACK_MS, now);
  const included = rows
    .filter((r) => isCompletedStatus(r.status) || isPaidStatus(r.status))
    .map((r) => r.orderNumber);
  const prev = await loadAnchor();
  await saveAnchor({
    balanceIdr: Math.round(balanceIdr),
    ts: now,
    included,
    excludedMethods: prev?.excludedMethods ?? [],
  });
  mem.__p2pExpectedBalanceCache = {
    anchorTs: now,
    orders: new Map(rows.map((r) => [r.orderNumber, r])),
    fetchedUntil: now,
    fetchedAt: now,
  } satisfies Cache;
  return getExpectedBalanceInternal();
}

// ── Server functions ────────────────────────────────────────────────────────
export const getExpectedBalance = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ sessionToken: z.string().optional() }).parse(data))
  .handler(async ({ data }): Promise<ExpectedBalanceState> => {
    await requireSession(data.sessionToken);
    return getExpectedBalanceInternal();
  });

export const setExpectedBalanceAnchor = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ sessionToken: z.string().optional(), balanceIdr: z.number().nonnegative() }).parse(data),
  )
  .handler(async ({ data }): Promise<ExpectedBalanceState> => {
    await requireSession(data.sessionToken);
    return setExpectedBalanceAnchorInternal(data.balanceIdr);
  });

export const setExpectedBalanceMethods = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ sessionToken: z.string().optional(), excludedMethods: z.array(z.string().max(80)).max(100) }).parse(data),
  )
  .handler(async ({ data }): Promise<ExpectedBalanceState> => {
    await requireSession(data.sessionToken);
    const anchor = await loadAnchor();
    if (!anchor) throw new Error("Setel saldo awal dulu");
    await saveAnchor({ ...anchor, excludedMethods: data.excludedMethods });
    return getExpectedBalanceInternal();
  });
