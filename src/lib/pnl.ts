import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { getSupabase } from "./supabase";

/**
 * Pencatatan harga eksekusi transaksi nyata + hitung profit harian/mingguan/bulanan/sepanjang masa
 * menggunakan AVCO (Moving Average Cost / Rata-rata Bergerak Tertimbang) agar harga modal
 * selalu mencerminkan nilai wajar stok yang sedang dipegang secara presisi.
 *
 * KONSEP FEE (berbasis timestamp transaksi — hanya berlaku untuk binance_sync):
 * - Sebelum cut-off permintaan perubahan (4 Sep 2026 10:00:00 WIB / 2026-09-04T03:00:00Z): fee historis 0.08%.
 * - Mulai cut-off dan seterusnya: fee baru 0.07%.
 * - Fee beli → DIKURANGKAN dari USDT yang diterima.
 *   Stok masuk = amount × (1 - fee_rate)
 *   HPP per USDT = harga_beli / (1 - fee_rate)
 * - Fee jual → DITAMBAHKAN ke USDT yang keluar dari stok (memakan stok ekstra).
 *   Stok keluar = amount × (1 + fee_rate)
 *   Net Jual per USDT = harga_jual × (1 - fee_rate) untuk kalkulasi profit.
 * - Transaksi manual (source = 'manual'): TIDAK dikenakan fee beli/jual apapun.
 *   Stok masuk = amount penuh, stok keluar = amount penuh, Net Jual = harga_jual mentah.
 * - Profit Bersih = (Net Jual − HPP) × jumlah nominal USDT
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
  /** Profit bersih per transaksi jual (IDR). Undefined untuk transaksi beli. */
  profit_idr?: number;
  /** HPP rata-rata saat transaksi jual terjadi (IDR/USDT). Undefined untuk transaksi beli. */
  avg_cost_at_sell?: number;
  /** Fee rate yang berlaku untuk transaksi ini (misal 0.0008 untuk 0.08% atau 0.0007 untuk 0.07%). */
  fee_rate?: number;
  /** Estimasi fee transaksi yang dikenakan (IDR). */
  fee_idr?: number;
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
  /** Stok USDT yang belum terjual (Open Position / Saldo Stok) */
  open_position_usdt: number;
  /** Nilai HPP modal rata-rata per USDT saat ini (termasuk fee beli). */
  open_position_avg_cost_idr: number;
  /** Nilai IDR total stok yang belum terjual, dihitung dari HPP (termasuk fee beli). */
  open_position_total_cost_idr: number;
  /** Jumlah stok otomatis dari kalkulasi transaksi */
  auto_stock_amount_usdt: number;
  /** Jumlah stok kustom jika diinput manual */
  custom_stock_amount_usdt: number;
  /** True jika jumlah stok diatur manual */
  is_custom_stock_amount: boolean;
  /** Harga modal rata-rata otomatis dari kalkulasi AVCO transaksi */
  auto_stock_avg_cost_idr: number;
  /** Harga modal kustom jika pengguna mengatur manual / override */
  custom_stock_cost_idr: number;
  /** True jika pengguna sedang memakai harga modal manual */
  is_custom_stock_cost: boolean;
  /** Modal awal yang diinput pengguna (IDR) */
  initial_capital_idr: number;
  /** Sisa kas/fiat IDR yang belum terpakai untuk beli stok */
  free_cash_idr: number;
  /** Total ekuitas portofolio saat ini (Kas Bebas + Nilai Stok USDT + Profit) */
  total_equity_idr: number;
  /** Persentase modal awal yang sedang berputar di stok USDT */
  capital_utilization_pct: number;
  /** Return on Capital / ROI terhadap modal awal (%) */
  roi_pct: number;
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
  auto_stock_amount_usdt: 0,
  custom_stock_amount_usdt: 0,
  is_custom_stock_amount: false,
  auto_stock_avg_cost_idr: 0,
  custom_stock_cost_idr: 0,
  is_custom_stock_cost: false,
  initial_capital_idr: 0,
  free_cash_idr: 0,
  total_equity_idr: 0,
  capital_utilization_pct: 0,
  roi_pct: 0,
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

export const INITIAL_CAPITAL_KEY = "initial_capital_idr";
export const CUSTOM_STOCK_COST_KEY = "custom_stock_cost_idr";
export const CUSTOM_STOCK_AMOUNT_KEY = "custom_stock_amount_usdt";

const getCapitalInputSchema = z.object({ sessionToken: z.string().optional() });

export const getInitialCapital = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getCapitalInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ initial_capital_idr: number }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { initial_capital_idr: 0 };
    const { data: row } = await db
      .from("user_settings")
      .select("value")
      .eq("key", INITIAL_CAPITAL_KEY)
      .maybeSingle();
    const val = parseFlexibleNumber((row as any)?.value);
    return { initial_capital_idr: val > 0 ? val : 0 };
  });

const setCapitalInputSchema = z.object({
  sessionToken: z.string().optional(),
  initialCapitalIdr: z.number().nonnegative(),
});

export const setInitialCapital = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setCapitalInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; initial_capital_idr: number }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { ok: false, initial_capital_idr: data.initialCapitalIdr };
    const { error } = await db
      .from("user_settings")
      .upsert(
        { key: INITIAL_CAPITAL_KEY, value: String(data.initialCapitalIdr) } as any,
        { onConflict: "key" },
      );
    return { ok: !error, initial_capital_idr: data.initialCapitalIdr };
  });

const setCustomCostSchema = z.object({
  sessionToken: z.string().optional(),
  costIdr: z.number().nonnegative(),
});

export const setCustomStockCost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setCustomCostSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; costIdr: number }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { ok: false, costIdr: data.costIdr };

    if (data.costIdr <= 0) {
      await db.from("user_settings").delete().eq("key", CUSTOM_STOCK_COST_KEY);
      return { ok: true, costIdr: 0 };
    }

    const { error } = await db
      .from("user_settings")
      .upsert(
        { key: CUSTOM_STOCK_COST_KEY, value: String(data.costIdr) } as any,
        { onConflict: "key" },
      );
    return { ok: !error, costIdr: data.costIdr };
  });

export const resetCustomStockCost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getCapitalInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { ok: false };
    const { error } = await db.from("user_settings").delete().eq("key", CUSTOM_STOCK_COST_KEY);
    return { ok: !error };
  });

const setCustomAmountSchema = z.object({
  sessionToken: z.string().optional(),
  amountUsdt: z.number().nonnegative(),
});

export const setCustomStockAmount = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setCustomAmountSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; amountUsdt: number }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { ok: false, amountUsdt: data.amountUsdt };

    if (data.amountUsdt <= 0) {
      await db.from("user_settings").delete().eq("key", CUSTOM_STOCK_AMOUNT_KEY);
      return { ok: true, amountUsdt: 0 };
    }

    const { error } = await db
      .from("user_settings")
      .upsert(
        { key: CUSTOM_STOCK_AMOUNT_KEY, value: String(data.amountUsdt) } as any,
        { onConflict: "key" },
      );
    return { ok: !error, amountUsdt: data.amountUsdt };
  });

export const resetCustomStockAmount = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getCapitalInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { ok: false };
    const { error } = await db.from("user_settings").delete().eq("key", CUSTOM_STOCK_AMOUNT_KEY);
    return { ok: !error };
  });

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
 * Fee Binance P2P untuk Maker (biasanya merchant):
 * - Sebelum cut-off (4 Sep 2026 10:00:00 WIB / 2026-09-04T03:00:00.000Z): rate historis 0.08% (0.0008).
 * - Mulai 4 Sep 2026 10:00:00 WIB dan seterusnya: rate aktif 0.07% (0.0007).
 * - Fee beli DIMASUKKAN ke HPP (harga pokok pembelian).
 * - Fee jual DIKURANGKAN dari hasil penjualan saat menghitung profit.
 */
export const FEE_CHANGE_TIMESTAMP = "2026-09-04T03:00:00.000Z";
export const HISTORICAL_BINANCE_FEE_RATE = 0.0008; // 0.08% untuk transaksi sebelum cut-off
export const CURRENT_BINANCE_FEE_RATE = 0.0007;    // 0.07% untuk transaksi baru

export function getBinanceFeeRate(tradeTs?: string | number | null): number {
  if (!tradeTs) return CURRENT_BINANCE_FEE_RATE;
  let time: number;
  if (typeof tradeTs === "number") {
    time = tradeTs;
  } else {
    const num = Number(tradeTs);
    if (!isNaN(num) && num > 1e11) {
      time = num;
    } else {
      time = new Date(tradeTs).getTime();
    }
  }
  if (isNaN(time)) return CURRENT_BINANCE_FEE_RATE;
  return time < new Date(FEE_CHANGE_TIMESTAMP).getTime()
    ? HISTORICAL_BINANCE_FEE_RATE
    : CURRENT_BINANCE_FEE_RATE;
}

/**
 * Harga Pokok Pembelian (HPP) per USDT.
 * HPP = harga beli × (1 + fee_rate)
 * Contoh: beli Rp 16.200 (fee 0.07%), HPP = 16.200 × 1.0007 = Rp 16.211,34
 */
export function calcHpp(buyPrice: number, feeRate: number = CURRENT_BINANCE_FEE_RATE): number {
  return buyPrice * (1 + feeRate);
}

/**
 * Hasil bersih per USDT setelah fee jual.
 * Net Sell = harga jual × (1 - fee_rate)
 * Contoh: jual Rp 16.250 (fee 0.07%), net = 16.250 × 0.9993 = Rp 16.238,625
 */
export function calcNetSell(sellPrice: number, feeRate: number = CURRENT_BINANCE_FEE_RATE): number {
  return sellPrice * (1 - feeRate);
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
      const isBinanceSync = rawTrade.source === "binance_sync";
      const isManual = rawTrade.source === "manual";
      // Fee rate berbasis waktu transaksi: sebelum cut-off tetap 0.08%, setelah cut-off 0.07%
      const feeRate = isBinanceSync ? getBinanceFeeRate(rawTrade.ts) : 0;

      if (rawTrade.side === "buy") {
        // Untuk binance_sync: stok yang masuk dikurangi fee (0.08% sebelum cut-off, 0.07% setelahnya)
        // (misal beli 10.000 USDT → masuk amount × (1 - feeRate))
        // Untuk manual: jumlah penuh dipakai (user sudah input jumlah aktual)
        const actualAmount = isBinanceSync
          ? amount * (1 - feeRate)  // USDT yang benar-benar diterima
          : amount;
        // HPP = total IDR dibayar / USDT diterima = price / (1 - fee)
        const hpp = isBinanceSync
          ? price / (1 - feeRate)   // biaya per USDT yang diterima
          : calcHpp(price, feeRate); // manual tetap pakai calcHpp
        lastBuyHpp = hpp;

        if (inventory <= 1e-8) {
          // Stok sebelumnya kosong atau habis -> set modal baru
          inventory = actualAmount;
          avgHpp = hpp;
        } else {
          // Ada sisa stok lama -> perbarui rata-rata tertimbang
          const newInventory = inventory + actualAmount;
          avgHpp = (inventory * avgHpp + actualAmount * hpp) / newInventory;
          inventory = newInventory;
        }

        totalBuy += actualAmount;              // USDT yang benar-benar masuk ke stok
        totalBuyIdr += amount * price;         // IDR yang dibayarkan (nominal penuh)
        // Beli: push dengan fee_rate & estimasi fee_idr
        const buyFeeIdr = isBinanceSync ? amount * price * feeRate : 0;
        normalizedTrades.push({
          ...rawTrade,
          price,
          fee_rate: feeRate,
          fee_idr: buyFeeIdr,
        });
        continue;
      }


      // ── Sisi JUAL ──────────────────────────────────────────────────────────
      const tradeSellIdr = amount * price;
      totalSell += amount;
      totalSellIdr += tradeSellIdr;

      let tradeProfit = 0;
      let tradeFeeIdr = 0;
      // Transaksi manual tidak dikenakan fee jual (fee jual hanya untuk binance_sync)
      const netSellPerUsdt = isManual ? price : calcNetSell(price, feeRate);

      // Untuk binance_sync: USDT yang benar-benar keluar dari wallet = amount × (1 + fee)
      // Contoh: jual 10.000 USDT → fee = feeRate × 10.000
      // Untuk manual: jumlah penuh tanpa modifikasi fee
      const isBinanceSyncSell = rawTrade.source === "binance_sync";
      const actualSellAmount = isBinanceSyncSell
        ? amount * (1 + feeRate)  // USDT yang benar-benar keluar dari wallet
        : amount;

      // Porsi yang bisa di-match dengan inventaris yang ada (berdasar USDT aktual keluar)
      const matched = Math.min(actualSellAmount, Math.max(0, inventory));
      const unmatched = actualSellAmount - matched;
      const effectiveHpp = avgHpp > 0 ? avgHpp : (lastBuyHpp > 0 ? lastBuyHpp : 0);

      if (matched > 1e-8 && avgHpp > 0) {
        // Cost basis = avgHpp saat ini (AVCO: rata-rata tertimbang semua stok)
        // Profit dihitung berdasarkan amount nominal (bukan actualSellAmount)
        // karena fee sudah tercermin di netSellPerUsdt dan fee hanya "memakan" stok ekstra
        const profitableAmount = Math.min(amount, matched);
        const rawBuyForMatched = avgHpp / (1 + feeRate); // balik ke harga beli mentah
        const buyFeeMatched = profitableAmount * rawBuyForMatched * feeRate;
        // Fee jual hanya dihitung untuk transaksi Binance Sync
        const sellFeeMatched = isManual ? 0 : profitableAmount * price * feeRate;
        tradeFeeIdr += buyFeeMatched + sellFeeMatched;
        tradeProfit += (netSellPerUsdt - avgHpp) * profitableAmount;
        inventory -= matched;
        if (inventory < 1e-8) {
          // Stok habis → reset modal ke 0 agar tampilan bersih
          inventory = 0;
          avgHpp = 0;
        }
      }

      // Sisa USDT nominal yang belum ter-match untuk profit
      const nominalMatched = Math.min(amount, matched);
      const nominalUnmatched = amount - nominalMatched;

      if (unmatched > 1e-8) {
        // Jual melebihi stok tercatat: gunakan HPP terakhir yang diketahui
        unmatchedSell += unmatched;

        if (effectiveHpp > 0 && nominalUnmatched > 1e-8) {
          const rawBuyFallback = effectiveHpp / (1 + feeRate);
          const buyFeeUnmatched = nominalUnmatched * rawBuyFallback * feeRate;
          // Fee jual hanya dihitung untuk transaksi Binance Sync
          const sellFeeUnmatched = isManual ? 0 : nominalUnmatched * price * feeRate;
          tradeFeeIdr += buyFeeUnmatched + sellFeeUnmatched;
          tradeProfit += (netSellPerUsdt - effectiveHpp) * nominalUnmatched;
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
      // Jual: push dengan profit_idr, avg_cost_at_sell, dan fee info ter-inject
      normalizedTrades.push({
        ...rawTrade,
        price,
        profit_idr: tradeProfit,
        avg_cost_at_sell: effectiveHpp,
        fee_rate: feeRate,
        fee_idr: tradeFeeIdr,
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

    // ── Ambil Custom Saldo Stok & Custom Harga Modal dari user_settings ─────
    let customStockCostIdr = 0;
    let customStockAmountUsdt = 0;

    const { data: settingsRows } = await db
      .from("user_settings")
      .select("key, value")
      .in("key", [CUSTOM_STOCK_COST_KEY, CUSTOM_STOCK_AMOUNT_KEY]);

    if (Array.isArray(settingsRows)) {
      for (const row of settingsRows) {
        if (row.key === CUSTOM_STOCK_COST_KEY) {
          const val = parseFlexibleNumber(row.value);
          if (val > 0) customStockCostIdr = val;
        } else if (row.key === CUSTOM_STOCK_AMOUNT_KEY) {
          const val = parseFlexibleNumber(row.value);
          if (val > 0) customStockAmountUsdt = val;
        }
      }
    }

    // ── Sisa Stok & Modal (Open Position) dari AVCO / Override ─────────────────
    const autoAmount = Math.max(0, inventory);
    const isCustomAmount = customStockAmountUsdt > 0;
    const openAmount = isCustomAmount ? customStockAmountUsdt : autoAmount;

    const autoAvgHpp = avgHpp > 0 ? avgHpp : (lastBuyHpp > 0 ? lastBuyHpp : 0);
    const isCustomCost = customStockCostIdr > 0;
    const openAvgHpp = isCustomCost ? customStockCostIdr : autoAvgHpp;
    const openTotalCostIdr = openAmount * openAvgHpp;
    const avgBuyPrice = totalBuy > 0 ? totalBuyIdr / totalBuy : 0;
    const avgSellPrice = totalSell > 0 ? totalSellIdr / totalSell : 0;
    const avgProfitPerUsdt = totalMatchedSellUsdt > 0 ? allTimeProfit / totalMatchedSellUsdt : 0;

    // ── Ambil Modal Awal Pengguna dari user_settings ──────────────────────────
    let initialCapitalIdr = 0;
    const { data: capRow } = await db
      .from("user_settings")
      .select("value")
      .eq("key", INITIAL_CAPITAL_KEY)
      .maybeSingle();
    const parsedCap = parseFlexibleNumber((capRow as any)?.value);
    if (parsedCap > 0) initialCapitalIdr = parsedCap;

    // ── Kalkulasi Ekuitas Modal, Sisa Kas Bebas, & Pertumbuhan ────────────────
    // Sisa Kas Bebas = Modal Awal - Modal Terikat di Stok + Total Keuntungan
    // Total Ekuitas = Modal Awal + Total Keuntungan
    const freeCashIdr = initialCapitalIdr > 0
      ? Math.max(0, initialCapitalIdr - openTotalCostIdr + allTimeProfit)
      : 0;
    const totalEquityIdr = initialCapitalIdr > 0
      ? initialCapitalIdr + allTimeProfit
      : (openTotalCostIdr + allTimeProfit);
    const capitalUtilizationPct = initialCapitalIdr > 0
      ? Math.min(100, Math.round((openTotalCostIdr / initialCapitalIdr) * 10000) / 100)
      : 0;
    const roiPct = initialCapitalIdr > 0
      ? Math.round((allTimeProfit / initialCapitalIdr) * 10000) / 100
      : 0;

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
      open_position_avg_cost_idr: openAvgHpp,        // HPP per USDT aktif (manual / auto)
      open_position_total_cost_idr: openTotalCostIdr, // Nilai IDR total stok aktif
      auto_stock_amount_usdt: autoAmount,           // Jumlah stok dari transaksi AVCO
      custom_stock_amount_usdt: customStockAmountUsdt, // Saldo stok yang diinput manual
      is_custom_stock_amount: isCustomAmount,       // Flag apakah stok manual aktif
      auto_stock_avg_cost_idr: autoAvgHpp,          // HPP per USDT dari AVCO otomatis
      custom_stock_cost_idr: customStockCostIdr,    // Nilai override harga modal jika ada
      is_custom_stock_cost: isCustomCost,           // Flag apakah harga modal manual
      initial_capital_idr: initialCapitalIdr,
      free_cash_idr: freeCashIdr,
      total_equity_idr: totalEquityIdr,
      capital_utilization_pct: capitalUtilizationPct,
      roi_pct: roiPct,
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

