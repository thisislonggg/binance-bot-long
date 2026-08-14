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
 *   - Data tersedia: 6 bulan ke belakang
 *   - tradeType BUY dan SELL harus di-fetch terpisah
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
  advNo: string;
  tradeType: "BUY" | "SELL";
  asset: string;
  fiat: string;
  amount: string;      // jumlah crypto (USDT)
  totalPrice: string;  // total IDR
  unitPrice: string;   // harga per USDT dalam IDR
  orderStatus: string;
  createTime: number;  // epoch ms
  counterPartNickName: string;
  payMethodName?: string;
  commission?: string;
};

// ── Signature builder ────────────────────────────────────────────────────────

/**
 * Buat HMAC-SHA256 signature standar untuk Binance signed endpoint.
 */
function buildSignature(queryParams: Record<string, string | number>, secret: string): string {
  const raw = Object.entries(queryParams)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return createHmac("sha256", secret).update(raw).digest("hex");
}

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
      startTimestamp: startMs,
      endTimestamp: endMs,
      page,
      rows,
      timestamp,
      recvWindow: 10_000,
    };

    const signature = buildSignature(params, apiSecret);
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");

    const url = `${BINANCE_C2C_URL}?${qs}&signature=${signature}`;

    const resp = await fetch(url, {
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Binance API error ${resp.status}: ${body}`);
    }

    const json = await resp.json();
    if (!json.success) {
      throw new Error(`Binance C2C error: ${json.message ?? JSON.stringify(json)}`);
    }

    const list = (json.data ?? []) as BinanceC2cOrder[];
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
  const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

  // Tentukan window waktu
  // Binance mengizinkan data maksimal 6 bulan (180 hari = 6 chunk x 30 hari)
  type Window = { start: number; end: number };
  const windows: Window[] = [];

  if (!lastSync || forceFullHistory) {
    // Tarik 6 chunk x 30 hari = 180 hari (6 bulan penuh batas maksimal Binance)
    for (let i = 6; i >= 1; i--) {
      windows.push({
        start: now - i * MS_30_DAYS,
        end: now - (i - 1) * MS_30_DAYS,
      });
    }
  } else {
    // Overlap 10 menit untuk memastikan order yang baru saja diselesaikan tercatat
    let curStart = lastSync - 10 * 60 * 1000;
    while (curStart < now) {
      const curEnd = Math.min(curStart + MS_30_DAYS, now);
      windows.push({ start: curStart, end: curEnd });
      if (curEnd >= now) break;
      curStart = curEnd;
    }
  }

  let totalAdded = 0;
  let totalSkipped = 0;

  for (const win of windows) {
    let buyOrders: BinanceC2cOrder[] = [];
    let sellOrders: BinanceC2cOrder[] = [];

    try {
      [buyOrders, sellOrders] = await Promise.all([
        fetchC2cOrdersForWindow(apiKey, apiSecret, "BUY", win.start, win.end),
        fetchC2cOrdersForWindow(apiKey, apiSecret, "SELL", win.start, win.end),
      ]);
    } catch (err) {
      return {
        ok: totalAdded > 0,
        added: totalAdded,
        skipped: totalSkipped,
        error: String(err),
      };
    }

    const allOrders = [...buyOrders, ...sellOrders].filter(
      (o) =>
        o.orderStatus === "COMPLETED" &&
        o.asset === "USDT" &&
        o.fiat === "IDR",
    );

    for (const order of allOrders) {
      const unitPrice = Number(order.unitPrice);
      const amountUsdt = Number(order.amount);
      const ts = new Date(order.createTime).toISOString();
      const side = order.tradeType === "BUY" ? "buy" : "sell";
      const noteParts = [
        order.counterPartNickName ? `@${order.counterPartNickName}` : null,
        order.payMethodName ?? null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      // Cek duplikat berdasarkan binance_order_no
      const { data: existing } = await db
        .from("trades")
        .select("id")
        .eq("binance_order_no", order.orderNumber)
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
        binance_order_no: order.orderNumber,
      });

      if (!error) {
        totalAdded++;
      } else {
        totalSkipped++;
      }
    }
  }

  await saveLastSyncTs(now);
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

