import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { getSupabase } from "./supabase";

/**
 * Pencatatan harga eksekusi transaksi nyata + hitung profit harian/mingguan/bulanan/sepanjang masa
 * menggunakan AVCO (Moving Average Cost / Rata-rata Bergerak Tertimbang) agar harga modal
 * selalu mencerminkan nilai wajar stok yang sedang dipegang secara presisi.
 *
 * KONSEP FEE (0.08% per transaksi):
 * - Fee beli 0.08% → MASUK ke HPP (Harga Pokok Pembelian). Modal stok sudah include fee beli.
 *   HPP = harga_beli × (1 + 0.0008)
 * - Fee jual 0.08% → DIKURANGKAN dari hasil jual saat matching.
 *   Net Jual = harga_jual × (1 - 0.0008)
 * - Profit Bersih = (Net Jual − HPP) × jumlah USDT
 * - Total fee per putaran beli+jual = 0.16%
 *
 * ZONA WAKTU: Indonesia (WIB UTC+7) untuk batas hari/minggu/bulan.
 */

/**
 * Normalisasi harga IDR untuk transaksi USDT/IDR di Indonesia.
 * Mencegah masalah formatting angka di mana 16.250 tersimpan atau terbaca sebagai 16.25.
 * Rentang harga USDT di Indonesia berada di kisaran Rp 14.000 - Rp 20.000.
 */
export function normalizeTradePrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (price >= 1 && price < 100) {
    // Terbagi 1000 karena titik dianggap desimal (contoh: 16.25 -> 16250)
    return Math.round(price * 1000 * 100) / 100;
  }
  if (price >= 100 && price < 1000) {
    // Terbagi 100 (contoh: 162.5 -> 16250)
    return Math.round(price * 100 * 100) / 100;
  }
  if (price >= 1000 && price < 5000) {
    // Terbagi 10 (contoh: 1625 -> 16250)
    return Math.round(price * 10 * 100) / 100;
  }
  return price;
}

/**
 * Parser angka fleksibel untuk menangani berbagai format angka Indonesia & Internasional.
 * Menangani format: 16.250,00 | 16,250.00 | 16.250 | 16250 | 1.000.000,00
 */
export function parseFlexibleNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  let s = String(val).trim();
  if (!s) return 0;

  // Hapus prefix mata uang
  s = s.replace(/^(rp|idr|usdt|\$)\s*/i, "").trim();

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    const firstComma = s.indexOf(",");
    const firstDot = s.indexOf(".");
    if (firstDot < firstComma) {
      // Format Indo: 16.250,50 -> 16250.50
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Format US: 16,250.50 -> 16250.50
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1]?.length === 3 && parseInt(parts[0] || "", 10) < 1000) {
      // "16,250" -> ribuan
      s = s.replace(/,/g, "");
    } else if (parts.length > 2) {
      // "16,250,000" -> ribuan
      s = s.replace(/,/g, "");
    } else {
      // "16250,50" -> desimal
      s = s.replace(",", ".");
    }
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2) {
      // "16.250.000" -> ribuan
      s = s.replace(/\./g, "");
    } else if (parts.length === 2) {
      const whole = parts[0] || "";
      const frac = parts[1] || "";
      // Jika whole adalah 2 digit (14-25) dan frac 3 digit (contoh 16.250), ini harga IDR ribuan
      if (whole.length >= 2 && whole.length <= 3 && frac.length === 3 && Number(whole) >= 10 && Number(whole) <= 100) {
        s = whole + frac;
      }
    }
  }

  const num = parseFloat(s);
  return Number.isFinite(num) ? num : 0;
}

export type TradeSide = "buy" | "sell";

export type Trade = {
  id: number;
  ts: string;
  side: TradeSide;
  price: number;
  amount_usdt: number;
  note: string | null;
  /** 'manual' = dicatat sendiri | 'binance_sync' = dari Binance C2C API */
  source: "manual" | "binance_sync";
  binance_order_no: string | null;
};

export type PnlSummary = {
  configured: boolean;
  today_profit_idr: number;
  yesterday_profit_idr: number;
  last_24h_profit_idr: number;
  week_profit_idr: number;
  month_profit_idr: number;
  all_time_profit_idr: number;
  today_trades_count: number;
  today_turnover_idr: number;
  today_fees_idr: number;
  total_fees_idr: number;
  open_position_usdt: number;
  /** HPP per USDT = harga beli rata-rata + fee beli. Ini adalah modal sesungguhnya per USDT. */
  open_position_avg_cost_idr: number;
  /** Nilai IDR total stok yang belum terjual, dihitung dari HPP (termasuk fee beli). */
  open_position_total_cost_idr: number;
  /** Rata-rata harga beli historis mentah (sebelum fee) */
  avg_buy_price_idr: number;
  /** Rata-rata harga jual historis mentah (sebelum fee) */
  avg_sell_price_idr: number;
  total_buy_usdt: number;
  total_sell_usdt: number;
  total_buy_idr: number;
  total_sell_idr: number;
  avg_profit_per_usdt_idr: number;
  unmatched_sell_usdt: number;
  total_trades_count: number;
  recent_trades: Trade[];
};

const EMPTY_SUMMARY: PnlSummary = {
  configured: false,
  today_profit_idr: 0,
  yesterday_profit_idr: 0,
  last_24h_profit_idr: 0,
  week_profit_idr: 0,
  month_profit_idr: 0,
  all_time_profit_idr: 0,
  today_trades_count: 0,
  today_turnover_idr: 0,
  today_fees_idr: 0,
  total_fees_idr: 0,
  open_position_usdt: 0,
  open_position_avg_cost_idr: 0,
  open_position_total_cost_idr: 0,
  avg_buy_price_idr: 0,
  avg_sell_price_idr: 0,
  total_buy_usdt: 0,
  total_sell_usdt: 0,
  total_buy_idr: 0,
  total_sell_idr: 0,
  avg_profit_per_usdt_idr: 0,
  unmatched_sell_usdt: 0,
  total_trades_count: 0,
  recent_trades: [],
};

const logTradeSchema = z.object({
  sessionToken: z.string().optional(),
  side: z.enum(["buy", "sell"]),
  price: z.number().positive(),
  amountUsdt: z.number().positive(),
  note: z.string().max(200).optional(),
});

export const logTrade = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => logTradeSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await requireSession(data.sessionToken);

    const db = getSupabase();
    if (!db) return { ok: false };
    const normalizedPrice = normalizeTradePrice(data.price);
    const { error } = await db.from("trades").insert({
      side: data.side,
      price: normalizedPrice,
      amount_usdt: data.amountUsdt,
      note: data.note ?? null,
    });
    return { ok: !error };
  });

const updateTradeSchema = z.object({
  sessionToken: z.string().optional(),
  id: z.number(),
  side: z.enum(["buy", "sell"]),
  price: z.number().positive(),
  amountUsdt: z.number().positive(),
  note: z.string().max(200).optional(),
});

export const updateTrade = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateTradeSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await requireSession(data.sessionToken);

    const db = getSupabase();
    if (!db) return { ok: false };
    const normalizedPrice = normalizeTradePrice(data.price);
    const { error } = await db
      .from("trades")
      .update({
        side: data.side,
        price: normalizedPrice,
        amount_usdt: data.amountUsdt,
        note: data.note ?? null,
      })
      .eq("id", data.id);
    return { ok: !error };
  });

const deleteTradeSchema = z.object({
  sessionToken: z.string().optional(),
  id: z.number(),
});

export const deleteTrade = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => deleteTradeSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; id?: number }> => {
    await requireSession(data.sessionToken);

    const db = getSupabase();
    if (!db) return { ok: false };
    const { error } = await db.from("trades").delete().eq("id", data.id);
    return { ok: !error, id: data.id };
  });

const TRADES_LOOKBACK_LIMIT = 5000;

/**
 * Fee Binance P2P: 0.08% untuk Maker (biasanya merchant).
 * Fee beli DIMASUKKAN ke HPP (harga pokok pembelian).
 * Fee jual DIKURANGKAN dari hasil penjualan saat menghitung profit.
 */
const BINANCE_FEE_RATE = 0.0008; // 0.08%

/**
 * Harga Pokok Pembelian (HPP) per USDT.
 * HPP = harga beli × (1 + fee_rate)
 * Contoh: beli Rp 16.200, HPP = 16.200 × 1.0008 = Rp 16.212,96
 */
function calcHpp(buyPrice: number): number {
  return buyPrice * (1 + BINANCE_FEE_RATE);
}

/**
 * Hasil bersih per USDT setelah fee jual.
 * Net Sell = harga jual × (1 - fee_rate)
 * Contoh: jual Rp 16.250, net = 16.250 × 0.9992 = Rp 16.237,00
 */
function calcNetSell(sellPrice: number): number {
  return sellPrice * (1 - BINANCE_FEE_RATE);
}

const getPnlInputSchema = z.object({ sessionToken: z.string().optional() });

export const getPnlSummary = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getPnlInputSchema.parse(data))
  .handler(async ({ data }): Promise<PnlSummary> => {
    await requireSession(data.sessionToken);

    const db = getSupabase();
    if (!db) return EMPTY_SUMMARY;

    const { data: tradesData, error } = await db
      .from("trades")
      .select("id, ts, side, price, amount_usdt, note, source, binance_order_no")
      .order("ts", { ascending: true })
      .limit(TRADES_LOOKBACK_LIMIT);
    if (error || !tradesData) return EMPTY_SUMMARY;

    const rawTrades = tradesData as Trade[];

    // ── Algoritma AVCO (Weighted Moving Average Cost) ─────────────────────────
    // Setiap transaksi BELI memperbarui rata-rata tertimbang modal (HPP).
    // Setiap transaksi JUAL menggunakan rata-rata HPP saat itu sebagai cost basis.
    // Hasil: open_position_avg_cost_idr selalu mencerminkan modal riil per USDT.

    let inventory = 0;   // stok USDT yang sedang dipegang
    let avgHpp = 0;      // rata-rata HPP tertimbang dari stok (selalu termasuk fee beli)
    let lastBuyHpp = 0;  // HPP dari lot beli terakhir (untuk fallback)

    const realized: {
      ts: string;
      profit_idr: number;
      fee_idr: number;
      matched_usdt: number;
      sell_idr: number;
    }[] = [];

    let totalBuy = 0;
    let totalSell = 0;
    let totalBuyIdr = 0;
    let totalSellIdr = 0;
    let unmatchedSell = 0;
    let totalMatchedSellUsdt = 0;

    const normalizedTrades: Trade[] = [];

    for (const rawTrade of rawTrades) {
      const rawPrice = Number(rawTrade.price);
      const amount = Number(rawTrade.amount_usdt);

      // Skip data tidak valid
      if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(amount) || amount <= 0) continue;

      const price = normalizeTradePrice(rawPrice);
      normalizedTrades.push({
        ...rawTrade,
        price,
      });

      if (rawTrade.side === "buy") {
        const hpp = calcHpp(price);
        lastBuyHpp = hpp;

        if (inventory <= 1e-8) {
          // Stok sebelumnya kosong atau habis -> set modal baru
          inventory = amount;
          avgHpp = hpp;
        } else {
          // Ada sisa stok lama -> perbarui rata-rata tertimbang
          const newInventory = inventory + amount;
          avgHpp = (inventory * avgHpp + amount * hpp) / newInventory;
          inventory = newInventory;
        }

        totalBuy += amount;
        totalBuyIdr += amount * price; // harga beli mentah (sebelum fee) untuk statistik
        continue;
      }

      // ── Sisi JUAL ──────────────────────────────────────────────────────────
      const tradeSellIdr = amount * price;
      totalSell += amount;
      totalSellIdr += tradeSellIdr;

      let tradeProfit = 0;
      let tradeFeeIdr = 0;
      const netSellPerUsdt = calcNetSell(price);

      // Porsi yang bisa di-match dengan inventaris yang ada
      const matched = Math.min(amount, Math.max(0, inventory));
      const unmatched = amount - matched;
      const effectiveHpp = avgHpp > 0 ? avgHpp : (lastBuyHpp > 0 ? lastBuyHpp : 0);

      if (matched > 1e-8 && avgHpp > 0) {
        // Cost basis = avgHpp saat ini (AVCO: rata-rata tertimbang semua stok)
        const rawBuyForMatched = avgHpp / (1 + BINANCE_FEE_RATE); // balik ke harga beli mentah
        const buyFeeMatched = matched * rawBuyForMatched * BINANCE_FEE_RATE;
        const sellFeeMatched = matched * price * BINANCE_FEE_RATE;
        tradeFeeIdr += buyFeeMatched + sellFeeMatched;
        tradeProfit += (netSellPerUsdt - avgHpp) * matched;
        inventory -= matched;
        if (inventory < 1e-8) inventory = 0;
      }

      if (unmatched > 1e-8) {
        // Jual melebihi stok tercatat: gunakan HPP terakhir yang diketahui
        unmatchedSell += unmatched;

        if (effectiveHpp > 0) {
          const rawBuyFallback = effectiveHpp / (1 + BINANCE_FEE_RATE);
          const buyFeeUnmatched = unmatched * rawBuyFallback * BINANCE_FEE_RATE;
          const sellFeeUnmatched = unmatched * price * BINANCE_FEE_RATE;
          tradeFeeIdr += buyFeeUnmatched + sellFeeUnmatched;
          tradeProfit += (netSellPerUsdt - effectiveHpp) * unmatched;
        }
      }

      totalMatchedSellUsdt += amount;
      realized.push({
        ts: rawTrade.ts,
        profit_idr: tradeProfit,
        fee_idr: tradeFeeIdr,
        matched_usdt: amount,
        sell_idr: tradeSellIdr,
      });
    }

    // ── Batas Waktu Berbasis WIB (UTC+7) ─────────────────────────────────────
    const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const nowWib = new Date(nowMs + WIB_OFFSET_MS);

    const y = nowWib.getUTCFullYear();
    const mo = nowWib.getUTCMonth();
    const day = nowWib.getUTCDate();

    const startOfTodayMs = Date.UTC(y, mo, day) - WIB_OFFSET_MS;
    const startOfYesterdayMs = startOfTodayMs - 24 * 60 * 60 * 1000;
    const startOfLast24hMs = nowMs - 24 * 60 * 60 * 1000;
    const startOfWeekMs = startOfTodayMs - 6 * 24 * 60 * 60 * 1000;
    const startOfMonthMs = startOfTodayMs - 29 * 24 * 60 * 60 * 1000;

    const startOfToday = new Date(startOfTodayMs);
    const startOfYesterday = new Date(startOfYesterdayMs);
    const startOfLast24h = new Date(startOfLast24hMs);
    const startOfWeek = new Date(startOfWeekMs);
    const startOfMonth = new Date(startOfMonthMs);

    let todayProfit = 0;
    let yesterdayProfit = 0;
    let last24hProfit = 0;
    let weekProfit = 0;
    let monthProfit = 0;
    let allTimeProfit = 0;
    let todayTradesCount = 0;
    let todayTurnoverIdr = 0;
    let todayFeesIdr = 0;
    let totalFeesIdr = 0;

    for (const r of realized) {
      const d = new Date(r.ts);
      allTimeProfit += r.profit_idr;
      totalFeesIdr += r.fee_idr;

      if (d >= startOfMonth) monthProfit += r.profit_idr;
      if (d >= startOfWeek) weekProfit += r.profit_idr;
      if (d >= startOfLast24h) last24hProfit += r.profit_idr;
      if (d >= startOfYesterday && d < startOfToday) yesterdayProfit += r.profit_idr;
      if (d >= startOfToday) {
        todayProfit += r.profit_idr;
        todayTurnoverIdr += r.sell_idr;
        todayFeesIdr += r.fee_idr;
        todayTradesCount++;
      }
    }

    // ── Sisa Stok & Modal (Open Position) dari AVCO ───────────────────────────
    const openAmount = Math.max(0, inventory);
    const openAvgHpp = avgHpp > 0 ? avgHpp : (lastBuyHpp > 0 ? lastBuyHpp : 0);
    const openTotalCostIdr = openAmount * openAvgHpp;
    const avgBuyPrice = totalBuy > 0 ? totalBuyIdr / totalBuy : 0;
    const avgSellPrice = totalSell > 0 ? totalSellIdr / totalSell : 0;
    const avgProfitPerUsdt = totalMatchedSellUsdt > 0 ? allTimeProfit / totalMatchedSellUsdt : 0;

    return {
      configured: true,
      today_profit_idr: todayProfit,
      yesterday_profit_idr: yesterdayProfit,
      last_24h_profit_idr: last24hProfit,
      week_profit_idr: weekProfit,
      month_profit_idr: monthProfit,
      all_time_profit_idr: allTimeProfit,
      today_trades_count: todayTradesCount,
      today_turnover_idr: todayTurnoverIdr,
      today_fees_idr: todayFeesIdr,
      total_fees_idr: totalFeesIdr,
      open_position_usdt: openAmount,
      open_position_avg_cost_idr: openAvgHpp,        // HPP per USDT (termasuk fee beli)
      open_position_total_cost_idr: openTotalCostIdr, // Nilai IDR total stok
      avg_buy_price_idr: avgBuyPrice,
      avg_sell_price_idr: avgSellPrice,
      total_buy_usdt: totalBuy,
      total_sell_usdt: totalSell,
      total_buy_idr: totalBuyIdr,
      total_sell_idr: totalSellIdr,
      avg_profit_per_usdt_idr: avgProfitPerUsdt,
      unmatched_sell_usdt: unmatchedSell,
      total_trades_count: rawTrades.length,
      recent_trades: normalizedTrades.slice().reverse(),
    };
  },
);

