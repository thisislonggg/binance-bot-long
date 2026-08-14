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

const DEFAULT_BINANCE_URL = "https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory";
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

  // Dukungan proxy atau custom base URL jika server hosting berada di region terblokir (US)
  const baseUrl =
    process.env["BINANCE_PROXY_URL"] ||
    process.env["BINANCE_API_BASE_URL"] ||
    DEFAULT_BINANCE_URL;

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
    const url = baseUrl.includes("?")
      ? `${baseUrl}&${qs}&signature=${signature}`
      : `${baseUrl}?${qs}&signature=${signature}`;

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

    const apiKey = process.env["BINANCE_API_KEY"]?.trim();
    const apiSecret = process.env["BINANCE_API_SECRET"]?.trim();
    if (
      !apiKey ||
      !apiSecret ||
      apiKey === "your_binance_api_key_here" ||
      apiSecret === "your_binance_api_secret_here"
    ) {
      return {
        ok: false,
        added: 0,
        skipped: 0,
        not_configured: true,
        error: "BINANCE_API_KEY & BINANCE_API_SECRET belum diisi di file .env atau hosting!",
      };
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
    const apiKey = process.env["BINANCE_API_KEY"]?.trim();
    const apiSecret = process.env["BINANCE_API_SECRET"]?.trim();
    const available = Boolean(
      apiKey &&
      apiSecret &&
      apiKey !== "your_binance_api_key_here" &&
      apiSecret !== "your_binance_api_secret_here",
    );
    const lastSyncTs = available ? await getLastSyncTs() : null;
    return { available, last_sync_ts: lastSyncTs };
  });

// ── Impor Riwayat Transaksi dari File CSV Binance C2C ───────────────────────

export type ImportCsvResult = {
  ok: boolean;
  added: number;
  skipped: number;
  totalParsed: number;
  error?: string;
};

function parseCsvRows(csvText: string): Array<Record<string, string>> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const headerLine = lines[0]!;
  let delimiter = ",";
  if (headerLine.includes(";") && headerLine.split(";").length > headerLine.split(",").length) {
    delimiter = ";";
  } else if (headerLine.includes("\t") && headerLine.split("\t").length > headerLine.split(",").length) {
    delimiter = "\t";
  }

  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delimiter && !inQuotes) {
        result.push(cur.trim().replace(/^"|"$/g, ""));
        cur = "";
      } else {
        cur += c;
      }
    }
    result.push(cur.trim().replace(/^"|"$/g, ""));
    return result;
  };

  const headers = splitLine(headerLine).map((h) => h.toLowerCase().replace(/[\s_\-()]/g, ""));
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]!);
    if (cols.length === 0) continue;
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = cols[idx] ?? "";
    });
    rows.push(rowObj);
  }

  return rows;
}

function findVal(row: Record<string, string>, possibleKeys: string[]): string {
  for (const k of possibleKeys) {
    const normalized = k.toLowerCase().replace(/[\s_\-()]/g, "");
    if (row[normalized] !== undefined && row[normalized] !== "") {
      return row[normalized]!;
    }
  }
  return "";
}

const importCsvInputSchema = z.object({
  sessionToken: z.string().optional(),
  csvText: z.string().min(1, "Konten CSV tidak boleh kosong"),
});

export const importBinanceCsvTrades = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => importCsvInputSchema.parse(data))
  .handler(async ({ data }): Promise<ImportCsvResult> => {
    await requireSession(data.sessionToken);

    const db = getSupabase();
    if (!db) {
      return { ok: false, added: 0, skipped: 0, totalParsed: 0, error: "Supabase belum dikonfigurasi" };
    }

    const rows = parseCsvRows(data.csvText);
    if (rows.length === 0) {
      return { ok: false, added: 0, skipped: 0, totalParsed: 0, error: "Format file CSV tidak valid atau kosong" };
    }

    let added = 0;
    let skipped = 0;

    for (const row of rows) {
      const orderNo = findVal(row, [
        "ordernumber",
        "orderno",
        "orderid",
        "nopesanan",
        "idpesanan",
        "tradeid",
        "transid",
      ]);

      const status = findVal(row, ["status", "orderstatus", "statuspesanan"]).toUpperCase();
      if (status && !status.includes("COMPLET") && !status.includes("SELESAI") && status !== "4") {
        skipped++;
        continue;
      }

      const typeStr = findVal(row, ["type", "ordertype", "tradetype", "tipe", "jenis", "side"]).toUpperCase();
      let side: "buy" | "sell" = "buy";
      if (typeStr.includes("SELL") || typeStr.includes("JUAL")) {
        side = "sell";
      } else if (typeStr.includes("BUY") || typeStr.includes("BELI")) {
        side = "buy";
      } else {
        skipped++;
        continue;
      }

      const amountStr = findVal(row, [
        "amount",
        "cryptoamount",
        "quantity",
        "jumlahkripto",
        "jumlah",
        "totalquantity",
      ]).replace(/,/g, "");
      const amountUsdt = parseFloat(amountStr);

      const totalStr = findVal(row, [
        "totalprice",
        "fiatamount",
        "totalharga",
        "totalfiat",
        "fiat",
        "amountidr",
      ]).replace(/,/g, "");
      const totalPrice = parseFloat(totalStr);

      const priceStr = findVal(row, [
        "unitprice",
        "price",
        "hargasatuan",
        "harga",
        "rate",
      ]).replace(/,/g, "");
      let unitPrice = parseFloat(priceStr);

      if ((!Number.isFinite(unitPrice) || unitPrice <= 0) && totalPrice > 0 && amountUsdt > 0) {
        unitPrice = totalPrice / amountUsdt;
      }

      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        skipped++;
        continue;
      }

      const timeStr = findVal(row, ["createdtime", "date", "dateutc", "time", "waktudibuat", "tanggal", "createdat"]);
      let ts = new Date().toISOString();
      if (timeStr) {
        const parsedTime = new Date(timeStr);
        if (!isNaN(parsedTime.getTime())) {
          ts = parsedTime.toISOString();
        }
      }

      const counterparty = findVal(row, ["counterparty", "counterpartynickname", "lawantransaksi", "partner"]);
      const payMethod = findVal(row, ["paymethod", "paymethodname", "metodepembayaran", "payment"]);
      const noteParts = [
        counterparty ? `@${counterparty}` : null,
        payMethod ?? null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      if (orderNo) {
        const { data: existing } = await db
          .from("trades")
          .select("id")
          .eq("binance_order_no", orderNo)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }
      }

      const { error } = await db.from("trades").insert({
        ts,
        side,
        price: unitPrice,
        amount_usdt: amountUsdt,
        note,
        source: "binance_sync",
        binance_order_no: orderNo || null,
      });

      if (!error) {
        added++;
      } else {
        skipped++;
      }
    }

    return {
      ok: true,
      added,
      skipped,
      totalParsed: rows.length,
    };
  });




