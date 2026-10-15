import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth";
import { getSupabase } from "./supabase";
import {
  DEFAULT_BOT_CONFIG,
  computeCompetitorPricing,
  type CompetitorFilterConfig,
} from "./competitor-bot";
import { fetchP2pAds, fetchCrossPlatform } from "./p2p.functions";
import { fetchFundingBalanceInternal } from "./binance-sync";
import { fetchActiveP2pSellOrdersInternal } from "./payment-verifier";
import { updateMerchantAdInternal, toggleMerchantAdStatusInternal } from "./binance-merchant";

export type BackgroundBotTickResult = {
  ok: boolean;
  timestamp: number;
  message: string;
  botEnabled: boolean;
  autoPushEnabled: boolean;
  recommendedBuyPrice?: number;
  recommendedSellPrice?: number;
  buyPushed?: boolean;
  sellPushed?: boolean;
  buyResult?: Record<string, unknown>;
  sellResult?: Record<string, unknown>;
  error?: string;
};

// ── In-Memory Cache Terakhir untuk Akselerasi & Fallback jika DB Offline ──────
let inMemoryLastCronRun: Record<string, unknown> | null = null;
let inMemoryLastPushed: {
  buy?: number;
  sell?: number;
  buyStock?: number;
  sellStock?: number;
  buyStatus?: string;
  sellStatus?: string;
} = {};

let inMemoryBotConfig: CompetitorFilterConfig | null = null;

/**
 * Mengambil konfigurasi bot P2P dari Supabase user_settings atau fallback in-memory/default/env.
 */
export async function getBotConfigServer(): Promise<CompetitorFilterConfig> {
  const db = getSupabase();
  let cfg = inMemoryBotConfig ? { ...inMemoryBotConfig } : { ...DEFAULT_BOT_CONFIG };

  if (db) {
    try {
      const { data } = await db
        .from("user_settings")
        .select("value")
        .eq("key", "p2p_bot_config")
        .maybeSingle();

      if (data?.value) {
        const parsed = JSON.parse(data.value);
        cfg = { ...cfg, ...parsed };
        inMemoryBotConfig = { ...cfg };
      }
    } catch {
      // Abaikan jika database belum siap
    }
  }

  // Override dari Environment Variables jika ada
  if (!cfg.merchantBuyAdvNo && process.env.BINANCE_BUY_ADV_NO) {
    cfg.merchantBuyAdvNo = process.env.BINANCE_BUY_ADV_NO.trim();
  }
  if (!cfg.merchantSellAdvNo && process.env.BINANCE_SELL_ADV_NO) {
    cfg.merchantSellAdvNo = process.env.BINANCE_SELL_ADV_NO.trim();
  }

  return cfg;
}

/**
 * Menyimpan konfigurasi bot ke Supabase user_settings agar bisa dibaca background runner.
 */
export async function saveBotConfigServer(config: Partial<CompetitorFilterConfig>): Promise<boolean> {
  const existing = inMemoryBotConfig || (await getBotConfigServer());
  const merged = { ...existing, ...config };
  inMemoryBotConfig = merged;

  const db = getSupabase();
  if (!db) return true;

  try {
    // supabase-js tidak melempar error saat upsert gagal; error dikembalikan di field `error`.
    const { error } = await db.from("user_settings").upsert(
      {
        key: "p2p_bot_config",
        value: JSON.stringify(merged),
      },
      { onConflict: "key" },
    );
    if (error) {
      console.error("Gagal menyimpan bot config ke Supabase:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Gagal menyimpan bot config ke Supabase:", err);
    return false;
  }
}

/**
 * Mesin Inti: Menjalankan satu siklus otomatisasi (Auto-Pricing Tick).
 * Dapat dipanggil oleh:
 * 1. Endpoint Webhook/Cron GET/POST /api/cron/auto-pricing
 * 2. Vercel Cron (setiap 1 menit)
 * 3. Supabase pg_cron (setiap 30-60 detik)
 * 4. Background Server Daemon / Electron Tray
 * 5. Tombol "Test Run Server Sekarang" di dashboard
 */
export async function runBackgroundBotTick(): Promise<BackgroundBotTickResult> {
  const now = Date.now();
  // CRON JOB SERVER DINONAKTIFKAN SECARA PERMANEN
  // Untuk mencegah server mengeksekusi harga usang/default yang menyebabkan harga anjlok sendiri,
  // seluruh auto-push kini hanya diproses langsung oleh dashboard browser pengguna.
  const res: BackgroundBotTickResult = {
    ok: false,
    timestamp: now,
    botEnabled: false,
    autoPushEnabled: false,
    message:
      "Cron job background server telah dinonaktifkan permanen sesuai permintaan Anda. Auto-pricing sepenuhnya berjalan aman langsung dari dashboard browser saat dibuka.",
  };
  inMemoryLastCronRun = res;
  return res;
}

// ── Kode runner lama dinonaktifkan untuk mencegah push dari background server ─
/*
    if (!config.autoPushToBinance) {
      const res: BackgroundBotTickResult = {
        ok: true,
        timestamp: now,
        botEnabled: true,
        autoPushEnabled: false,
        message: "Auto-Push ke Binance sedang OFF. Aktifkan opsi 'Auto-Push Live ke Binance' agar bot otomatis memperbarui harga iklan.",
      };
      inMemoryLastCronRun = res;
      return res;
    }

    // Ambil benchmark spot dinamis agar fallback tidak jatuh ke nilai statis usang
    let dynamicBase = 17850;
    try {
      const cross = await fetchCrossPlatform();
      if (cross?.indodax_usdt_idr_spot && cross.indodax_usdt_idr_spot > 10_000) {
        dynamicBase = cross.indodax_usdt_idr_spot;
      } else if (cross?.coingecko_usdt_idr && cross.coingecko_usdt_idr > 10_000) {
        dynamicBase = cross.coingecko_usdt_idr;
      }
    } catch {
      // Abaikan
    }

    // 1. Ambil data pasar live (iklan kompetitor buy & sell)
    const [sellRefAds, buyRefAds] = await Promise.all([
      fetchP2pAds("BUY", dynamicBase), // acuan jual saya
      fetchP2pAds("SELL", dynamicBase), // acuan beli saya
    ]);

    const isMock =
      sellRefAds.some((a) => a.adv_no?.startsWith("mock_")) ||
      buyRefAds.some((a) => a.adv_no?.startsWith("mock_"));

    if (isMock || (!sellRefAds.length && !buyRefAds.length)) {
      return {
        ok: false,
        timestamp: now,
        botEnabled: true,
        autoPushEnabled: true,
        message: isMock
          ? "Orderbook Binance P2P offline / mock fallback terdeteksi. Melewati push ke Binance untuk menjaga akurasi harga riil."
          : "Gagal mengambil data live orderbook dari Binance P2P. Coba beberapa saat lagi.",
      };
    }

    // 2. Ambil saldo funding wallet live
    const funding = await fetchFundingBalanceInternal();
    const liveStockUsdt = funding?.usdt ?? 0;

    // 3. Ambil modal HPP & Saldo Modal Bank dari user_settings
    let stockHpp = 0;
    let initialCapitalIdr = 180_000_000;
    let bankBalanceIdr = 0;

    if (db) {
      try {
        const { data: capRows } = await db
          .from("user_settings")
          .select("key, value")
          .in("key", ["initial_capital_idr", "pnl_initial_capital"]);
        if (Array.isArray(capRows) && capRows.length > 0) {
          const matched = capRows.find((r: any) => r.key === "initial_capital_idr") || capRows[0];
          initialCapitalIdr = Number(matched.value) || 180_000_000;
        }

        const { data: hppRows } = await db
          .from("user_settings")
          .select("key, value")
          .in("key", ["custom_stock_cost_idr", "pnl_custom_stock_cost"]);
        if (Array.isArray(hppRows) && hppRows.length > 0) {
          const matched = hppRows.find((r: any) => r.key === "custom_stock_cost_idr") || hppRows[0];
          stockHpp = Number(matched.value) || 0;
        }
      } catch {
        // Abaikan
      }
    }

    // Ambil harga terbaik untuk estimasi valuasi jika HPP belum diisi
    const bestSellPrice = sellRefAds.length > 0 ? sellRefAds[0].price : 0;
    const bestBuyPrice = buyRefAds.length > 0 ? buyRefAds[0].price : 0;
    const liveAnchorEst = bestSellPrice || bestBuyPrice || 16_850;

    // Hitung valuasi modal live stok dan sisa kas bank bebas (Free Cash IDR)
    const effectiveStockValuationIdr = Math.round(
      liveStockUsdt * (stockHpp > 0 ? stockHpp : liveAnchorEst)
    );
    const computedFreeCashIdr = Math.max(0, initialCapitalIdr - effectiveStockValuationIdr);
    bankBalanceIdr =
      config.bankBalanceSource === "manual" && config.manualBankBalanceIdr > 0
        ? config.manualBankBalanceIdr
        : computedFreeCashIdr;

    // 4. Ambil orderan P2P aktif untuk segregasi modal kas
    const activeOrders = await fetchActiveP2pSellOrdersInternal();
    const activeBuyOrders = activeOrders.filter((o) => o.tradeType === "BUY");
    const activeBuyOrdersUsdt =
      Math.round(activeBuyOrders.reduce((s, o) => s + (o.amountUsdt || 0), 0) * 100) / 100;
    const activeBuyOrdersIdr =
      Math.round(activeBuyOrders.reduce((s, o) => s + (o.totalPriceIdr || 0), 0));

    // 4. Hitung harga pasar wajar (fair price) live dari orderbook P2P
    const fairPrice =
      bestSellPrice > 0 && bestBuyPrice > 0
        ? Math.round((bestSellPrice + bestBuyPrice) / 2)
        : liveAnchorEst;

    // 4b. Ambil harga live cross platform (Indodax Spot) untuk proteksi dump pasar
    let indodaxSpotPrice = 0;
    try {
      const crossPlatform = await fetchCrossPlatform();
      indodaxSpotPrice = crossPlatform["indodax_usdt_idr_spot"] || 0;
    } catch {
      // Abaikan jika offline
    }

    // 5. Jalankan kalkulator strategi kompetitor
    const pricing = computeCompetitorPricing({
      sellRefAds,
      buyRefAds,
      fairPrice,
      config,
      stockHpp,
      bankBalanceIdr,
      initialCapitalIdr,
      liveStockUsdt,
      stockCapitalIdr: effectiveStockValuationIdr,
      activeBuyOrdersUsdt,
      activeBuyOrdersIdr,
      indodaxSpotPrice,
    });

    // 6. Muat riwayat harga terakhir yang pernah di-push
    let lastPushedPrices = { ...inMemoryLastPushed };
    if (db) {
      try {
        const { data: lpData } = await db
          .from("user_settings")
          .select("value")
          .eq("key", "p2p_bot_last_pushed")
          .maybeSingle();
        if (lpData?.value) {
          lastPushedPrices = { ...lastPushedPrices, ...JSON.parse(lpData.value) };
        }
      } catch {
        // Abaikan
      }
    }

    let buyPushed = false;
    let sellPushed = false;
    let buyResult: Record<string, unknown> | undefined = undefined;
    let sellResult: Record<string, unknown> | undefined = undefined;

    // ── Eksekusi Push Iklan Beli (BUY) ───────────────────────────────────────
    let roundedBuyPrice = Math.round(pricing.recommendedBuyPrice);

    // Slew-rate limiter / Proteksi Anti-Lonjakan Beli (Anti-Spike Jump):
    if (
      (!config.manualBuyPriceOverrideRp || config.manualBuyPriceOverrideRp <= 0) &&
      lastPushedPrices.buy &&
      lastPushedPrices.buy > 10_000
    ) {
      const maxAllowedJump = Math.max(50, (config.maxPriceStepRp || 30) * 2);
      if (roundedBuyPrice > lastPushedPrices.buy + maxAllowedJump) {
        roundedBuyPrice = lastPushedPrices.buy + maxAllowedJump;
      }
    }

    // ── Cek Pesanan P2P Aktif pada Iklan Jual (SELL) ─────────────────────────
    // Pada iklan JUAL, Binance mengunci kuota kripto merchant di escrow sehingga
    // perubahan stok/limit ditolak Binance saat ada order aktif berlangsung.
    // Pada iklan BELI (BUY), Binance TIDAK mengunci kuota kripto merchant, sehingga
    // kuota stok & batas transaksi fiat SELALU dapat dan WAJIB diperbarui otomatis.
    const cleanSellAdvNo = config.merchantSellAdvNo?.trim().replace(/^#/, "");
    const activeSellOrders = activeOrders.filter((o) => o.tradeType === "SELL");
    const hasActiveSellOrder = Boolean(
      cleanSellAdvNo &&
      activeSellOrders.some((o) => {
        if (o.advNo) {
          return o.advNo.trim().replace(/^#/, "") === cleanSellAdvNo;
        }
        return false;
      })
    );

    // Proteksi Batas Bawah Beli (Buy Floor): HARD FLOOR MUTLAK!
    const effectiveBuyFloor = Math.max(
      pricing.buyGuard.floorPrice || 0,
      config.manualBuyFloorRp || 0,
      config.minPriceBoundRp || 0
    );
    if (effectiveBuyFloor > 0 && roundedBuyPrice < effectiveBuyFloor) {
      roundedBuyPrice = effectiveBuyFloor;
    }

    // Proteksi Batas Atas Beli (Buy Ceiling): HARD CEILING MUTLAK!
    const effectiveBuyCeiling = Math.min(
      config.manualBuyCeilingRp && config.manualBuyCeilingRp > 0 && config.manualBuyCeilingRp < 999_999
        ? config.manualBuyCeilingRp
        : 999_999,
      pricing.buyGuard.ceilingPrice && pricing.buyGuard.ceilingPrice > 0 ? pricing.buyGuard.ceilingPrice : 999_999,
      config.maxPriceBoundRp && config.maxPriceBoundRp > 0 ? config.maxPriceBoundRp : 999_999
    );
    if (effectiveBuyCeiling < 999_999 && roundedBuyPrice > effectiveBuyCeiling) {
      roundedBuyPrice = effectiveBuyCeiling;
    }

    // Proteksi Batas Maksimum Absolut Pasar:
    if (config.maxPriceBoundRp && config.maxPriceBoundRp > 0 && roundedBuyPrice > config.maxPriceBoundRp) {
      roundedBuyPrice = config.maxPriceBoundRp;
    }

    if (config.merchantBuyAdvNo && roundedBuyPrice > 0) {
      const isBuyBlocked =
        (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0) &&
        (pricing.bankAllocation.isBelowMinLimit || pricing.bankAllocation.autoBuyStockUsdt <= 0);

      if (isBuyBlocked) {
        // Proteksi Kas Beli: kas habis / 0 atau di bawah batas minimal limit!
        // Segera OFFLINE-kan iklan di Binance agar tidak mengambil order di luar modal!
        if (lastPushedPrices.buyStatus !== "OFFLINE") {
          const offRes = await toggleMerchantAdStatusInternal(
            config.merchantBuyAdvNo.trim(),
            "OFFLINE"
          );
          buyResult = {
            ok: offRes.ok,
            status: "OFFLINE",
            message: `Saldo kas beli Rp ${pricing.bankAllocation.usableBankIdr.toLocaleString("id-ID")} di bawah minimal limit Rp ${pricing.bankAllocation.minBuyLimitIdr.toLocaleString("id-ID")}. Iklan beli otomatis di-OFFLINE-kan di Binance.`,
          };
          if (offRes.ok) {
            buyPushed = true;
            lastPushedPrices.buyStatus = "OFFLINE";
          }
        }
      } else {
        const currentBuyStock =
          config.manualBuyStockUsdt && config.manualBuyStockUsdt > 0
            ? config.manualBuyStockUsdt
            : pricing.bankAllocation.autoBuyStockUsdt;

        const priceChanged = lastPushedPrices.buy !== roundedBuyPrice;
        const stockChanged = lastPushedPrices.buyStock !== currentBuyStock;
        const statusNeedsOnline = lastPushedPrices.buyStatus === "OFFLINE";

        if (priceChanged || stockChanged || statusNeedsOnline) {
          const buyRes = await updateMerchantAdInternal({
            advNo: config.merchantBuyAdvNo.trim(),
            side: "buy",
            price: roundedBuyPrice,
            amount: currentBuyStock > 0 ? currentBuyStock : undefined,
            minSingleTransAmount: config.manualBuyMinLimitIdr || 50_000_000,
            maxSingleTransAmount: config.manualBuyMaxLimitIdr || 500_000_000,
            floorPrice: effectiveBuyFloor > 0 ? effectiveBuyFloor : undefined,
            ceilingPrice: effectiveBuyCeiling < 999_999 ? effectiveBuyCeiling : undefined,
            hasActiveOrders: false,
            priceOnly: false,
          });

          buyResult = buyRes as unknown as Record<string, unknown>;
          if (buyRes.ok) {
            buyPushed = true;
            lastPushedPrices.buy = roundedBuyPrice;
            lastPushedPrices.buyStock = currentBuyStock;
            lastPushedPrices.buyStatus = "ONLINE";
          }
        }
      }
    }

    // ── Eksekusi Push Iklan Jual (SELL) ──────────────────────────────────────
    // HARD FLOOR MUTLAK: manualSellFloorRp WAJIB berlaku tanpa syarat!
    const minSellFloor = Math.max(
      pricing.sellGuard.floorPrice || 0,
      config.manualSellFloorRp || 0,
      config.minPriceBoundRp || 0
    );
    let targetSellPrice = pricing.recommendedSellPrice;
    if (config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0) {
      targetSellPrice = Math.max(minSellFloor, Math.round(config.manualSellPriceOverrideRp));
    }
    let roundedSellPrice = Math.round(Math.max(minSellFloor, targetSellPrice));

    // Slew-rate limiter / Proteksi Anti-Lonjakan & Anti-Anjlok Jual (Anti-Spike & Anti-Dump Guard):
    // Jika di mode auto bot dan sebelumnya sudah ada harga jual yang ter-push, batasi pergerakan liar dalam 1 siklus
    if (
      (!config.manualSellPriceOverrideRp || config.manualSellPriceOverrideRp <= 0) &&
      lastPushedPrices.sell &&
      lastPushedPrices.sell > 10_000
    ) {
      const maxAllowedStep = Math.max(50, (config.maxPriceStepRp || 30) * 2);
      // Batasi lonjakan NAIK liar
      if (roundedSellPrice > lastPushedPrices.sell + maxAllowedStep) {
        roundedSellPrice = lastPushedPrices.sell + maxAllowedStep;
      }
      // Batasi penurunan ANJLOK liar (Anti-Dump / Anti-Crash)
      if (roundedSellPrice < lastPushedPrices.sell - maxAllowedStep) {
        roundedSellPrice = lastPushedPrices.sell - maxAllowedStep;
      }
    }

    if (config.maxPriceBoundRp && config.maxPriceBoundRp > 0 && roundedSellPrice > config.maxPriceBoundRp) {
      if (minSellFloor > 0 && config.maxPriceBoundRp < minSellFloor) {
        roundedSellPrice = minSellFloor;
      } else {
        roundedSellPrice = config.maxPriceBoundRp;
      }
    }
    if (minSellFloor > 0 && roundedSellPrice < minSellFloor) {
      roundedSellPrice = minSellFloor;
    }
    // Proteksi Tambahan Anti-Dump: Di mode auto bot, harga jual tidak boleh jatuh di bawah batas aman konsensus pasar
    if (!config.manualSellPriceOverrideRp || config.manualSellPriceOverrideRp <= 0) {
      const marketAnchor = fairPrice > 10_000 ? fairPrice : 0;
      const antiDumpFloor = marketAnchor > 0 ? Math.max(minSellFloor, marketAnchor - 35) : minSellFloor;
      if (antiDumpFloor > 0 && roundedSellPrice < antiDumpFloor) {
        roundedSellPrice = antiDumpFloor;
      }
    }
    if (config.merchantSellAdvNo && roundedSellPrice > 0) {
      const maxAvailableSellStockUsdt =
        liveStockUsdt > 0 ? Math.max(0, Math.floor((liveStockUsdt / 1.0005) * 100) / 100) : 0;
      const effectiveSellStock =
        config.manualSellStockUsdt && config.manualSellStockUsdt > 0
          ? config.manualSellStockUsdt
          : maxAvailableSellStockUsdt > 0
          ? maxAvailableSellStockUsdt
          : undefined;

      const priceChanged = lastPushedPrices.sell !== roundedSellPrice;
      // PENTING: Jika ada pesanan aktif (hasActiveSellOrder), JANGAN picu update hanya karena perubahan stok!
      // Karena Binance mengunci kuota stok selama pesanan aktif berlangsung.
      const stockChanged = !hasActiveSellOrder && lastPushedPrices.sellStock !== effectiveSellStock;

      if (priceChanged || stockChanged) {
        // Jika BUY baru saja di-push, beri jeda sejenak agar Binance API tidak bentrok timestamp / rate limit
        if (buyPushed) {
          await new Promise((r) => setTimeout(r, 1000));
        }

        const sellRes = await updateMerchantAdInternal({
          advNo: config.merchantSellAdvNo.trim(),
          side: "sell",
          price: roundedSellPrice,
          amount: hasActiveSellOrder ? undefined : effectiveSellStock,
          minSingleTransAmount: hasActiveSellOrder ? undefined : config.manualSellMinLimitIdr,
          maxSingleTransAmount: hasActiveSellOrder
            ? undefined
            : (config.manualSellMaxLimitIdr ||
              (effectiveSellStock && roundedSellPrice > 0
                ? Math.floor(effectiveSellStock * roundedSellPrice)
                : undefined)),
          floorPrice: minSellFloor > 0 ? minSellFloor : undefined,
          hasActiveOrders: hasActiveSellOrder,
          priceOnly: hasActiveSellOrder,
        });

        sellResult = sellRes as unknown as Record<string, unknown>;
        if (sellRes.ok) {
          sellPushed = true;
          lastPushedPrices.sell = roundedSellPrice;
          if (!hasActiveSellOrder) {
            lastPushedPrices.sellStock = effectiveSellStock;
          }
        }
      }
    }

    inMemoryLastPushed = lastPushedPrices;

    // 7. Simpan ringkasan run ke Supabase
    const tickResult: BackgroundBotTickResult = {
      ok: true,
      timestamp: now,
      botEnabled: true,
      autoPushEnabled: true,
      recommendedBuyPrice: roundedBuyPrice,
      recommendedSellPrice: roundedSellPrice,
      buyPushed,
      sellPushed,
      buyResult,
      sellResult,
      message: `Siklus bot background selesai. Beli: Rp ${roundedBuyPrice.toLocaleString("id-ID")}${buyPushed ? " (Pushed)" : ""}, Jual: Rp ${roundedSellPrice.toLocaleString("id-ID")}${sellPushed ? " (Pushed)" : ""}`,
    };

    inMemoryLastCronRun = tickResult;

    if (db) {
      try {
        await Promise.all([
          db.from("user_settings").upsert(
            {
              key: "p2p_bot_last_pushed",
              value: JSON.stringify(lastPushedPrices),
            },
            { onConflict: "key" },
          ),
          db.from("user_settings").upsert(
            {
              key: "p2p_bot_last_cron_run",
              value: JSON.stringify(tickResult),
            },
            { onConflict: "key" },
          ),
        ]);
      } catch {
        // Abaikan
      }
    }

    return tickResult;
  } catch (err) {
    const errStr = err instanceof Error ? err.message : String(err);
    const failRes: BackgroundBotTickResult = {
      ok: false,
      timestamp: now,
      botEnabled: true,
      autoPushEnabled: true,
      message: `Gagal menjalankan background auto-pricing: ${errStr}`,
      error: errStr,
    };
    inMemoryLastCronRun = failRes;
    return failRes;
  }
}
*/

// ── Server Functions untuk Komunikasi Frontend Dashboard ─────────────────────

const saveConfigInputSchema = z.object({
  sessionToken: z.string().optional(),
  config: z.record(z.unknown()),
});

export const saveBotConfigToServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => saveConfigInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return { ok: false, message: "Sesi tidak terverifikasi." };
    }

    const ok = await saveBotConfigServer(data.config as Partial<CompetitorFilterConfig>);
    return {
      ok,
      message: ok
        ? "Konfigurasi bot berhasil disinkronkan ke server 24/7."
        : "Gagal menyimpan ke database Supabase.",
    };
  });

const getConfigInputSchema = z.object({
  sessionToken: z.string().optional(),
});

export const getBotConfigFromServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getConfigInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; config: CompetitorFilterConfig }> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return { ok: false, config: DEFAULT_BOT_CONFIG };
    }

    const config = await getBotConfigServer();
    return { ok: true, config };
  });

// ── Kunci Penjalan Tunggal (Single-Runner Lease) ─────────────────────────────
// Auto-push sekarang berjalan dari dashboard browser. Tanpa kunci ini, setiap tab / HP / jendela
// Electron yang terbuka menjalankan loop push sendiri dan saling menimpa harga iklan di Binance.
// Hanya satu runnerId yang memegang lease; lease kedaluwarsa otomatis jika tab ditutup / tertidur.

const RUNNER_LEASE_KEY = "p2p_bot_runner_lease";
const RUNNER_LEASE_TTL_MS = 20_000;

export type BotRunnerLease = { runnerId: string; label?: string; expiresAt: number };

let inMemoryRunnerLease: BotRunnerLease | null = null;

async function readRunnerLease(): Promise<BotRunnerLease | null> {
  const db = getSupabase();
  if (!db) return inMemoryRunnerLease;
  try {
    const { data } = await db.from("user_settings").select("value").eq("key", RUNNER_LEASE_KEY).maybeSingle();
    return data?.value ? (JSON.parse(data.value) as BotRunnerLease) : null;
  } catch {
    return inMemoryRunnerLease;
  }
}

async function writeRunnerLease(lease: BotRunnerLease): Promise<void> {
  inMemoryRunnerLease = lease;
  const db = getSupabase();
  if (!db) return;
  await db
    .from("user_settings")
    .upsert({ key: RUNNER_LEASE_KEY, value: JSON.stringify(lease) }, { onConflict: "key" });
}

/**
 * Ambil / perpanjang lease untuk runnerId. Gagal jika runner lain masih memegang lease yang
 * belum kedaluwarsa, kecuali takeover = true (pengguna menekan "Ambil Alih").
 */
export async function claimBotRunnerLease(
  runnerId: string,
  opts: { label?: string; takeover?: boolean } = {},
): Promise<{ isLeader: boolean; holder: BotRunnerLease | null }> {
  const now = Date.now();
  const current = await readRunnerLease();
  const heldByOther = current && current.runnerId !== runnerId && current.expiresAt > now;
  if (heldByOther && !opts.takeover) {
    return { isLeader: false, holder: current };
  }
  const lease: BotRunnerLease = { runnerId, expiresAt: now + RUNNER_LEASE_TTL_MS };
  const label = opts.label ?? (current?.runnerId === runnerId ? current.label : undefined);
  if (label) lease.label = label;
  await writeRunnerLease(lease);
  return { isLeader: true, holder: lease };
}

export async function releaseBotRunnerLease(runnerId: string): Promise<void> {
  const current = await readRunnerLease();
  if (current && current.runnerId === runnerId) {
    await writeRunnerLease({ ...current, expiresAt: 0 });
  }
}

const runnerHeartbeatInputSchema = z.object({
  sessionToken: z.string().optional(),
  runnerId: z.string().min(8),
  label: z.string().max(80).optional(),
  takeover: z.boolean().optional(),
  release: z.boolean().optional(),
});

export const heartbeatBotRunnerServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => runnerHeartbeatInputSchema.parse(data))
  .handler(
    async ({ data }): Promise<{ ok: boolean; isLeader: boolean; holder: BotRunnerLease | null; message?: string }> => {
      try {
        await requireSession(data.sessionToken);
      } catch {
        return { ok: false, isLeader: false, holder: null, message: "Sesi tidak terverifikasi." };
      }
      if (data.release) {
        await releaseBotRunnerLease(data.runnerId);
        return { ok: true, isLeader: false, holder: null };
      }
      try {
        const res = await claimBotRunnerLease(data.runnerId, {
          ...(data.label ? { label: data.label } : {}),
          ...(data.takeover ? { takeover: true } : {}),
        });
        return { ok: true, ...res };
      } catch (err) {
        return { ok: false, isLeader: false, holder: null, message: err instanceof Error ? err.message : String(err) };
      }
    },
  );

export const triggerBackgroundBotTickServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getConfigInputSchema.parse(data))
  .handler(async ({ data }): Promise<BackgroundBotTickResult> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return {
        ok: false,
        timestamp: Date.now(),
        botEnabled: false,
        autoPushEnabled: false,
        message: "Sesi tidak terverifikasi.",
      };
    }

    return runBackgroundBotTick();
  });

export const getBackgroundBotStatusServer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getConfigInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; lastRun: Record<string, unknown> | null }> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return { ok: false, lastRun: null };
    }

    const db = getSupabase();
    if (db) {
      try {
        const { data: dbData } = await db
          .from("user_settings")
          .select("value")
          .eq("key", "p2p_bot_last_cron_run")
          .maybeSingle();

        if (dbData?.value) {
          return { ok: true, lastRun: JSON.parse(dbData.value) };
        }
      } catch {
        // Abaikan
      }
    }

    return { ok: true, lastRun: inMemoryLastCronRun };
  });
