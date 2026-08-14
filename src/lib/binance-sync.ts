/**
 * Sinkronisasi riwayat transaksi C2C dari Binance ke tabel `trades`.
 *
 * Endpoint resmi Binance:
 *   GET https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory
 *
 * Autentikasi: HMAC-SHA256 signed (USER_DATA). Butuh API Key dengan
 * permission "Enable Reading" — TIDAK butuh trading/withdrawal.
 *
 * Constraint:
 *   - Max window per request: 30 hari
 *   - Data tersedia: 6 bulan ke belakang (180 hari)
 *   - tradeType BUY dan SELL di-fetch terpisah
 *   - Pagination: page (1-indexed) & rows (maks 100)
 */

import { createServerFn } from "@tanstack/react-start";
import { createHmac } from "crypto";
import { z } from "zod";

import { requireSession } from "./auth";
import { getSupabase } from "./supabase";

const BINANCE_C2C_URL = "https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory";
const SYNC_TS_KEY = "binance_last_sync_ts";

// ── Tipe respons Binance C2C ────────────────────────────────────────────────

export type BinanceC2cOrder = {
  orderNumber: string;
  advNo?: string;
  tradeType: "BUY" | "SELL" | string;
  asset?: string;
  fiat?: string;
  amount: string | number;      // jumlah crypto (USDT)
  totalPrice?: string | number; // total IDR
  unitPrice?: string | number;  // harga per USDT dalam IDR
  price?: string | number;
  orderStatus?: string;
  createTime?: number | string; // epoch ms
  counterPartNickName?: string;
  payMethodName?: string;
  commission?: string;
};

// ── Fetch halaman dari Binance C2C API dengan Paginasi Penuh ─────────────────

async function fetchC2cOrdersForWindow(
  apiKey: string,
  apiSecret: string,
  tradeType: "BUY" | "SELL",
  startMs: number,
  endMs: number,
): Promise<BinanceC2cOrder[]> {
  const allOrders: BinanceC2cOrder[] = [];
  let page = 1;
  const rows = 100;
  const maxPages = 20; // safety limit hingga 2000 order per sisi per window

  while (page <= maxPages) {
    const timestamp = Date.now();
    const params: Record<string, string | number> = {
      tradeType,
      startTimestamp: Math.floor(startMs),
      endTimestamp: Math.floor(endMs),
      page,
      rows,
      timestamp,
      recvWindow: 10_000,
    };

    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const signature = createHmac("sha256", apiSecret).update(qs).digest("hex");
    const url = `${BINANCE_C2C_URL}?${qs}&signature=${signature}`;

    const resp = await fetch(url, {
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Binance API HTTP ${resp.status}: ${body}`);
    }

    const json = await resp.json();

    // Respons Binance SAPI mengembalikan code: "000000" atau 0 saat sukses
    if (json.code && json.code !== "000000" && json.code !== 0 && json.code !== "0") {
      throw new Error(`Binance C2C API error: ${json.code} - ${json.message ?? JSON.stringify(json)}`);
    }

    const list = (Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : []) as BinanceC2cOrder[];
    allOrders.push(...list);

    if (list.length < rows) {
      break; // Halaman terakhir tercapai
    }
    page++;
  }

  return allOrders;
}

// ── Ambil/simpan timestamp sync terakhir ────────────────────────────────────

async function getLastSyncTs(): Promise<number | null> {
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db
    .from("user_settings")
    .select("value")
    .eq("key", SYNC_TS_KEY)
    .maybeSingle();
  const v = Number(data?.value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function saveLastSyncTs(ts: number): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db
    .from("user_settings")
    .upsert({ key: SYNC_TS_KEY, value: String(ts) }, { onConflict: "key" });
}

// ── Eksekusi Core Sync ───────────────────────────────────────────────────────

export async function executeBinanceSync(
  apiKey: string,
  apiSecret: string,
  forceFullHistory = false,
): Promise<SyncResult> {
  const db = getSupabase();
  if (!db) return { ok: false, added: 0, skipped: 0, error: "Supabase belum dikonfigurasi" };

  const lastSync = await getLastSyncTs();
  const now = Date.now();
  const MS_DAY = 24 * 60 * 60 * 1000;

  // Tentukan window waktu (Binance membatasi query maksimal interval 30 hari, data s.d 180 hari)
  type Window = { start: number; end: number };
  const windows: Window[] = [];

  if (!lastSync || forceFullHistory) {
    // 7 chunk x 25 hari = 175 hari ke belakang
    for (let dayOffset = 175; dayOffset >= 0; dayOffset -= 25) {
      const winStart = now - (dayOffset + 25) * MS_DAY;
      const winEnd = now - dayOffset * MS_DAY;
      windows.push({
        start: Math.max(winStart, now - 179 * MS_DAY),
        end: Math.min(winEnd, now),
      });
    }
  } else {
    // Overlap 15 menit untuk memastikan order yang baru saja settled tercatat
    let curStart = lastSync - 15 * 60 * 1000;
    while (curStart < now) {
      const curEnd = Math.min(curStart + 25 * MS_DAY, now);
      windows.push({ start: curStart, end: curEnd });
      if (curEnd >= now) break;
      curStart = curEnd;
    }
  }

  let totalAdded = 0;
  let totalSkipped = 0;
  let lastError: string | null = null;

  for (const win of windows) {
    let buyOrders: BinanceC2cOrder[] = [];
    let sellOrders: BinanceC2cOrder[] = [];

    try {
      const [resBuy, resSell] = await Promise.all([
        fetchC2cOrdersForWindow(apiKey, apiSecret, "BUY", win.start, win.end).catch((e) => {
          lastError = e?.message || String(e);
          console.warn("Fetch BUY window error:", e);
          return [] as BinanceC2cOrder[];
        }),
        fetchC2cOrdersForWindow(apiKey, apiSecret, "SELL", win.start, win.end).catch((e) => {
          lastError = e?.message || String(e);
          console.warn("Fetch SELL window error:", e);
          return [] as BinanceC2cOrder[];
        }),
      ]);
      buyOrders = resBuy;
      sellOrders = resSell;
    } catch (err: any) {
      lastError = err?.message || String(err);
      console.warn("Window fetch skipped due to error:", err);
      continue;
    }

    // Filter transaksi: COMPLETED USDT/IDR (case-insensitive)
    const allOrders = [...buyOrders, ...sellOrders].filter((o) => {
      const statusStr = String(o.orderStatus ?? "").toUpperCase();
      const assetStr = String(o.asset ?? "").toUpperCase();
      const fiatStr = String(o.fiat ?? "").toUpperCase();

      const isCompleted = !statusStr || statusStr === "COMPLETED" || statusStr === "4";
      const isUsdt = !assetStr || assetStr === "USDT";
      const isIdr = !fiatStr || fiatStr === "IDR";
      return isCompleted && isUsdt && isIdr;
    });

    for (const order of allOrders) {
      const orderNo = String(order.orderNumber || order.advNo || "");
      if (!orderNo) continue;

      const amountUsdt = Number(order.amount);
      const totalPrice = Number(order.totalPrice);
      let unitPrice = Number(order.unitPrice || order.price);
      if ((!Number.isFinite(unitPrice) || unitPrice <= 0) && totalPrice > 0 && amountUsdt > 0) {
        unitPrice = totalPrice / amountUsdt;
      }

      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        continue;
      }

      const createTime = Number(order.createTime) || Date.now();
      const ts = new Date(createTime).toISOString();
      const side = String(order.tradeType).toUpperCase() === "BUY" ? "buy" : "sell";
      const noteParts = [
        order.counterPartNickName ? `@${order.counterPartNickName}` : null,
        order.payMethodName ?? null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      // Cek duplikat berdasarkan binance_order_no
      const { data: existing } = await db
        .from("trades")
        .select("id")
        .eq("binance_order_no", orderNo)
        .maybeSingle();

      if (existing) {
        totalSkipped++;
        continue;
      }

      const { error } = await db.from("trades").insert({
        ts,
        side,
        price: unitPrice,
        amount_usdt: amountUsdt,
        note,
        source: "binance_sync",
        binance_order_no: orderNo,
      });

      if (!error) {
        totalAdded++;
      } else {
        totalSkipped++;
      }
    }
  }

  await saveLastSyncTs(now);

  if (totalAdded === 0 && totalSkipped === 0 && lastError) {
    return { ok: false, added: 0, skipped: 0, error: lastError };
  }

  return { ok: true, added: totalAdded, skipped: totalSkipped, last_sync_ts: now };
}

// ── Server Functions ─────────────────────────────────────────────────────────

const syncInputSchema = z.object({
  sessionToken: z.string().optional(),
  fullHistory: z.boolean().optional(),
});

export type SyncResult = {
  ok: boolean;
  added: number;
  skipped: number;
  error?: string;
  not_configured?: boolean;
  last_sync_ts?: number;
};

export const syncBinanceTrades = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => syncInputSchema.parse(data))
  .handler(async ({ data }): Promise<SyncResult> => {
    await requireSession(data.sessionToken);

    const apiKey = process.env["BINANCE_API_KEY"];
    const apiSecret = process.env["BINANCE_API_SECRET"];
    if (!apiKey || !apiSecret) {
      return { ok: false, added: 0, skipped: 0, not_configured: true };
    }

    return executeBinanceSync(apiKey, apiSecret, data.fullHistory);
  });

// ── Status: apakah sync tersedia + kapan terakhir sync ──────────────────────

const statusInputSchema = z.object({ sessionToken: z.string().optional() });

export type SyncStatus = {
  available: boolean;
  last_sync_ts: number | null;
};

export const getBinanceSyncStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => statusInputSchema.parse(data))
  .handler(async ({ data }): Promise<SyncStatus> => {
    await requireSession(data.sessionToken);
    const available = Boolean(process.env["BINANCE_API_KEY"] && process.env["BINANCE_API_SECRET"]);
    const lastSyncTs = available ? await getLastSyncTs() : null;
    return { available, last_sync_ts: lastSyncTs };
  });


