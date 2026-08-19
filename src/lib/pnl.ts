import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { getSupabase } from "./supabase";

/**
 * Pencatatan harga eksekusi transaksi nyata + hitung profit harian/mingguan/bulanan/sepanjang masa
 * menggunakan LIFO Matching (lot beli terbaru dipakai dulu) agar sesuai dengan pola merchant P2P
 * yang membeli → langsung jual di putaran pendek.
 *
 * KONSEP FEE:
 * - Fee beli 0.08% → MASUK ke cost basis (HPP). Artinya, modal USDT yang tercatat di stok sudah
 *   termasuk fee beli. Ini membuat "Sisa Stok" di dashboard akurat sebagai harga modal sesungguhnya.
 * - Fee jual 0.08% → dikurangkan dari profit saat matching.
 * - Profit Bersih = harga jual × (1 - fee_rate) × amount  −  HPP × amount
 *   di mana HPP = harga beli × (1 + fee_rate)
 *
 * ZONA WAKTU: Indonesia (WIB UTC+7) untuk batas hari/minggu/bulan.
 */

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
    const { error } = await db.from("trades").insert({
      side: data.side,
      price: data.price,
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
    const { error } = await db
      .from("trades")
      .update({
        side: data.side,
        price: data.price,
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
 * Contoh: jual Rp 16.250, net = 16.250 × 0.9992 = Rp 16.237
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

    const trades = tradesData as Trade[];

    // ── Algoritma LIFO Matching ─────────────────────────────────────────────
    // Merchant P2P biasanya menjual stok yang baru saja dibeli di putaran aktif,
    // sehingga LIFO (lot terbaru dipakai dulu) lebih sesuai dengan realita.
    //
    // BuyLot menyimpan HPP (sudah termasuk fee beli), bukan harga beli mentah.
    // Ini agar "Sisa Stok" langsung mencerminkan modal sesungguhnya.
    type BuyLot = {
      id: number;
      ts: string;
      rawBuyPrice: number; // harga beli mentah dari input
      hpp: number;         // HPP = rawBuyPrice × (1 + fee_rate)
      amount: number;
    };
    const buyStack: BuyLot[] = [];

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
    let lastKnownHpp = 0; // HPP dari lot beli terakhir, untuk fallback unmatched

    for (const rawTrade of trades) {
      const price = Number(rawTrade.price);
      const amount = Number(rawTrade.amount_usdt);

      // Skip data tidak valid
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) continue;

      if (rawTrade.side === "buy") {
        const hpp = calcHpp(price);
        buyStack.push({ id: rawTrade.id, ts: rawTrade.ts, rawBuyPrice: price, hpp, amount });
        totalBuy += amount;
        totalBuyIdr += amount * price; // catat nilai IDR beli mentah (sebelum fee)
        lastKnownHpp = hpp;
        continue;
      }

      // ── Sisi JUAL ──────────────────────────────────────────────────────────
      const tradeSellIdr = amount * price;
      totalSell += amount;
      totalSellIdr += tradeSellIdr;

      let remaining = amount;
      let tradeProfit = 0;
      let tradeFeeIdr = 0;

      // LIFO: ambil dari akhir stack (lot terbaru)
      while (remaining > 1e-8 && buyStack.length > 0) {
        const lot = buyStack[buyStack.length - 1]!;
        const take = Math.min(lot.amount, remaining);

        // Fee jual untuk porsi ini
        const sellFeeForTake = take * price * BINANCE_FEE_RATE;
        // Fee beli sudah masuk ke HPP, jadi total fee yang di-track = fee beli + fee jual
        const buyFeeForTake = take * lot.rawBuyPrice * BINANCE_FEE_RATE;
        tradeFeeIdr += buyFeeForTake + sellFeeForTake;

        // Profit = (net sell per USDT - HPP per USDT) × amount
        // HPP sudah termasuk fee beli:
        //   Profit = harga jual × (1 - fee_rate) × take  −  HPP × take
        const netSellPerUsdt = calcNetSell(price);
        const profitForTake = (netSellPerUsdt - lot.hpp) * take;
        tradeProfit += profitForTake;

        lot.amount -= take;
        remaining -= take;
        if (lot.amount <= 1e-8) {
          buyStack.pop();
        }
      }

      // Porsi jual yang tidak ada pasangan beli (stok awal belum dicatat / unmatched)
      if (remaining > 1e-8) {
        unmatchedSell += remaining;

        // Gunakan HPP terakhir yang diketahui sebagai cost basis fallback.
        // Jika tidak ada riwayat beli sama sekali, lewati (profit = 0, lebih konservatif).
        if (lastKnownHpp > 0) {
          const sellFeeForRemaining = remaining * price * BINANCE_FEE_RATE;
          const rawBuyPriceFallback = lastKnownHpp / (1 + BINANCE_FEE_RATE);
          const buyFeeForRemaining = remaining * rawBuyPriceFallback * BINANCE_FEE_RATE;
          tradeFeeIdr += buyFeeForRemaining + sellFeeForRemaining;

          const netSellPerUsdt = calcNetSell(price);
          const profitForRemaining = (netSellPerUsdt - lastKnownHpp) * remaining;
          tradeProfit += profitForRemaining;
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

    // ── Sisa Stok (Open Position) ─────────────────────────────────────────────
    // openAmount        : total USDT yang belum terjual
    // openAvgHpp        : rata-rata HPP per USDT di stok (sudah termasuk fee beli)
    // openTotalCostIdr  : nilai IDR total stok berdasarkan HPP
    const openAmount = buyStack.reduce((s, l) => s + l.amount, 0);
    const openTotalHppIdr = buyStack.reduce((s, l) => s + l.amount * l.hpp, 0);
    const openAvgHpp = openAmount > 0 ? openTotalHppIdr / openAmount : (lastKnownHpp || 0);
    const openTotalCostIdr = openTotalHppIdr;

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
      total_buy_usdt: totalBuy,
      total_sell_usdt: totalSell,
      total_buy_idr: totalBuyIdr,
      total_sell_idr: totalSellIdr,
      avg_profit_per_usdt_idr: avgProfitPerUsdt,
      unmatched_sell_usdt: unmatchedSell,
      total_trades_count: trades.length,
      recent_trades: trades.slice().reverse(),
    };
  },
);
