import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { getSupabase } from "./supabase";

/**
 * Pencatatan harga eksekusi transaksi nyata (bukan rekomendasi bot) + hitung
 * profit harian/mingguan/bulanan/sepanjang masa pakai FIFO cost-basis: tiap
 * SELL dicocokkan ke lot BELI tertua yang belum terpakai,
 * profit = (harga jual - harga beli lot) x jumlah yang match.
 * Ini standar akuntansi FIFO, jadi jual sebagian dari satu lot beli tetap dihitung benar.
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
  week_profit_idr: number;
  month_profit_idr: number;
  all_time_profit_idr: number;
  open_position_usdt: number;
  open_position_avg_cost_idr: number;
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
  week_profit_idr: 0,
  month_profit_idr: 0,
  all_time_profit_idr: 0,
  open_position_usdt: 0,
  open_position_avg_cost_idr: 0,
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
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await requireSession(data.sessionToken);

    const db = getSupabase();
    if (!db) return { ok: false };
    const { error } = await db.from("trades").delete().eq("id", data.id);
    return { ok: !error };
  });

// Ambil histori transaksi secukupnya untuk matching FIFO yang akurat.
const TRADES_LOOKBACK_LIMIT = 5000;

const pnlSummarySchema = z.object({ sessionToken: z.string().optional() });

export const getPnlSummary = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => pnlSummarySchema.parse(data))
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

    type Lot = { price: number; amount: number };
    const openLots: Lot[] = [];
    const realized: { ts: string; profit_idr: number; matched_usdt: number }[] = [];
    let totalBuy = 0;
    let totalSell = 0;
    let totalBuyIdr = 0;
    let totalSellIdr = 0;
    let unmatchedSell = 0;
    let totalMatchedSellUsdt = 0;

    for (const t of trades) {
      if (t.side === "buy") {
        openLots.push({ price: t.price, amount: t.amount_usdt });
        totalBuy += t.amount_usdt;
        totalBuyIdr += t.amount_usdt * t.price;
        continue;
      }

      totalSell += t.amount_usdt;
      totalSellIdr += t.amount_usdt * t.price;
      let remaining = t.amount_usdt;
      let profit = 0;
      let matchedInThisTrade = 0;

      while (remaining > 1e-9 && openLots.length > 0) {
        const lot = openLots[0]!;
        const matched = Math.min(lot.amount, remaining);
        profit += (t.price - lot.price) * matched;
        matchedInThisTrade += matched;
        lot.amount -= matched;
        remaining -= matched;
        if (lot.amount <= 1e-9) openLots.shift();
      }

      totalMatchedSellUsdt += matchedInThisTrade;
      unmatchedSell += remaining;
      realized.push({ ts: t.ts, profit_idr: profit, matched_usdt: matchedInThisTrade });
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 6); // 7 hari rolling
    const startOfMonth = new Date(startOfToday);
    startOfMonth.setDate(startOfMonth.getDate() - 29); // 30 hari rolling

    let todayProfit = 0;
    let weekProfit = 0;
    let monthProfit = 0;
    let allTimeProfit = 0;

    for (const r of realized) {
      const d = new Date(r.ts);
      allTimeProfit += r.profit_idr;
      if (d >= startOfMonth) monthProfit += r.profit_idr;
      if (d >= startOfWeek) weekProfit += r.profit_idr;
      if (d >= startOfToday) todayProfit += r.profit_idr;
    }

    const openAmount = openLots.reduce((s, l) => s + l.amount, 0);
    const openCost = openLots.reduce((s, l) => s + l.amount * l.price, 0);

    const avgProfitPerUsdt = totalMatchedSellUsdt > 0 ? allTimeProfit / totalMatchedSellUsdt : 0;

    return {
      configured: true,
      today_profit_idr: todayProfit,
      week_profit_idr: weekProfit,
      month_profit_idr: monthProfit,
      all_time_profit_idr: allTimeProfit,
      open_position_usdt: openAmount,
      open_position_avg_cost_idr: openAmount > 0 ? openCost / openAmount : 0,
      total_buy_usdt: totalBuy,
      total_sell_usdt: totalSell,
      total_buy_idr: totalBuyIdr,
      total_sell_idr: totalSellIdr,
      avg_profit_per_usdt_idr: avgProfitPerUsdt,
      unmatched_sell_usdt: unmatchedSell,
      total_trades_count: trades.length,
      recent_trades: trades.slice(-50).reverse(),
    };
  },
);
