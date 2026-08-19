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
import { normalizeTradePrice, parseFlexibleNumber } from "./pnl";
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

    // Filter transaksi: COMPLETED USDT/IDR (case-insensitive & toleran variasi status Binance)
    const allOrders = [...buyOrders, ...sellOrders].filter((o) => {
      const statusStr = String(o.orderStatus ?? "").toUpperCase();
      const assetStr = String(o.asset ?? "").toUpperCase();
      const fiatStr = String(o.fiat ?? "").toUpperCase();

      const isCompleted =
        !statusStr ||
        statusStr.includes("COMPLET") ||
        statusStr.includes("SUCCESS") ||
        statusStr.includes("FINISH") ||
        statusStr.includes("SELESAI") ||
        statusStr === "4";
      const isUsdt = !assetStr || assetStr.includes("USDT") || assetStr.includes("USD");
      const isIdr = !fiatStr || fiatStr.includes("IDR") || fiatStr.includes("RP");
      return isCompleted && isUsdt && isIdr;
    });

    for (const order of allOrders) {
      const orderNo = String(order.orderNumber || order.advNo || "");
      if (!orderNo) continue;

      const amountUsdt = parseFlexibleNumber(order.amount ?? order.cryptoAmount ?? order.quantity);
      const totalPrice = parseFlexibleNumber(order.totalPrice ?? order.fiatAmount ?? order.amountIdr);
      let unitPrice = parseFlexibleNumber(order.unitPrice ?? order.price);
      if ((!Number.isFinite(unitPrice) || unitPrice <= 0) && totalPrice > 0 && amountUsdt > 0) {
        unitPrice = totalPrice / amountUsdt;
      }
      unitPrice = normalizeTradePrice(unitPrice);

      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        continue;
      }

      const createTime = Number(order.createTime) || Date.now();
      const ts = new Date(createTime).toISOString();
      const side = String(order.tradeType).toUpperCase().includes("BUY") ? "buy" : "sell";
      const noteParts = [
        order.counterPartNickName ? `@${order.counterPartNickName}` : null,
        order.payMethodName ?? null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      // Gunakan upsert agar order terupdate/tercatat secara presisi
      const { error } = await db.from("trades").upsert(
        {
          ts,
          side,
          price: unitPrice,
          amount_usdt: amountUsdt,
          note,
          source: "binance_sync",
          binance_order_no: orderNo,
        },
        { onConflict: "binance_order_no" },
      );

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

/**
 * Parser tanggal fleksibel untuk format Binance Indonesia/Global (DD/MM/YYYY, YYYY-MM-DD, epoch, dll).
 */
function parseFlexibleDate(str: string): string {
  if (!str) return new Date().toISOString();

  const trimmed = str.trim();

  // 1. Epoch timestamps
  if (/^\d{10,13}$/.test(trimmed)) {
    const num = Number(trimmed);
    return new Date(num > 1e11 ? num : num * 1000).toISOString();
  }

  // 2. Format DD/MM/YYYY atau DD-MM-YYYY (contoh: 03/08/2026 atau 03-08-2026 14:30:00)
  const dmyMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (dmyMatch) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = dmyMatch;
    const day = parseInt(d!, 10);
    const month = parseInt(m!, 10) - 1; // 0-indexed month
    const year = parseInt(y!, 10);
    const date = new Date(Date.UTC(year, month, day, parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10)));
    if (!isNaN(date.getTime())) return date.toISOString();
  }

  // 3. Format YYYY-MM-DD atau YYYY/MM/DD (contoh: 2026-08-03 14:30:00)
  const ymdMatch = trimmed.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ymdMatch) {
    const [, y, m, d, hh = "0", mm = "0", ss = "0"] = ymdMatch;
    const date = new Date(Date.UTC(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(d!, 10), parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10)));
    if (!isNaN(date.getTime())) return date.toISOString();
  }

  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

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
      if (status && !status.includes("COMPLET") && !status.includes("SELESAI") && !status.includes("SUCCESS") && status !== "4") {
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

      const rawAmount = findVal(row, [
        "amount",
        "cryptoamount",
        "quantity",
        "jumlahkripto",
        "jumlah",
        "totalquantity",
      ]);
      const amountUsdt = parseFlexibleNumber(rawAmount);

      const rawTotal = findVal(row, [
        "totalprice",
        "fiatamount",
        "totalharga",
        "totalfiat",
        "fiat",
        "amountidr",
      ]);
      const totalPrice = parseFlexibleNumber(rawTotal);

      const rawPrice = findVal(row, [
        "unitprice",
        "price",
        "hargasatuan",
        "harga",
        "rate",
      ]);
      let unitPrice = parseFlexibleNumber(rawPrice);

      if ((!Number.isFinite(unitPrice) || unitPrice <= 0) && totalPrice > 0 && amountUsdt > 0) {
        unitPrice = totalPrice / amountUsdt;
      }
      unitPrice = normalizeTradePrice(unitPrice);

      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        skipped++;
        continue;
      }

      const timeStr = findVal(row, ["createdtime", "date", "dateutc", "time", "waktudibuat", "tanggal", "createdat"]);
      const ts = parseFlexibleDate(timeStr);

      const counterparty = findVal(row, ["counterparty", "counterpartynickname", "lawantransaksi", "partner"]);
      const payMethod = findVal(row, ["paymethod", "paymethodname", "metodepembayaran", "payment"]);
      const noteParts = [
        counterparty ? `@${counterparty}` : null,
        payMethod ?? null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      const { error } = await db.from("trades").upsert(
        {
          ts,
          side,
          price: unitPrice,
          amount_usdt: amountUsdt,
          note,
          source: "binance_sync",
          binance_order_no: orderNo || null,
        },
        orderNo ? { onConflict: "binance_order_no" } : undefined,
      );

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

// ── Funding Wallet Balance (Sisa Stok Real-time) ────────────────────────────

/**
 * Ambil saldo USDT di Funding Wallet Binance secara real-time.
 *
 * Endpoint: POST /sapi/v1/asset/get-funding-asset
 * Izin API: "Enable Reading" sudah cukup.
 *
 * Funding Wallet adalah dompet yang digunakan untuk P2P:
 *   - BELI USDT P2P → USDT masuk ke Funding Wallet
 *   - JUAL USDT P2P → USDT keluar dari Funding Wallet
 *
 * Dengan membaca saldo ini, "Sisa Stok" di dashboard menjadi 100% akurat
 * tanpa perlu mengandalkan kalkulasi LIFO dari riwayat transaksi.
 */

const BINANCE_FUNDING_URL = "https://api.binance.com/sapi/v1/asset/get-funding-asset";

type FundingAsset = {
  asset: string;
  free: string;
  locked: string;
  freeze: string;
  withdrawing: string;
  btcValuation?: string;
};


export type FundingBalance = {
  /** Saldo USDT di Funding Wallet. null jika API tidak dikonfigurasi atau error. */
  usdt: number | null;
  /**
   * Rincian: USDT bebas digunakan, USDT terkunci di order P2P aktif,
   * total = free + locked + freeze
   */
  free: number | null;
  locked: number | null;
  error?: string;
  not_configured?: boolean;
};

const fundingBalanceInputSchema = z.object({ sessionToken: z.string().optional() });

export const getBinanceFundingBalance = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fundingBalanceInputSchema.parse(data))
  .handler(async ({ data }): Promise<FundingBalance> => {
    await requireSession(data.sessionToken);

    const apiKey = process.env["BINANCE_API_KEY"]?.trim();
    const apiSecret = process.env["BINANCE_API_SECRET"]?.trim();

    if (
      !apiKey ||
      !apiSecret ||
      apiKey === "your_binance_api_key_here" ||
      apiSecret === "your_binance_api_secret_here"
    ) {
      return { usdt: null, free: null, locked: null, not_configured: true };
    }

    try {
      const timestamp = Date.now();
      const params = `asset=USDT&timestamp=${timestamp}&recvWindow=10000`;
      const signature = createHmac("sha256", apiSecret).update(params).digest("hex");
      const url = `${BINANCE_FUNDING_URL}?${params}&signature=${signature}`;

      const resp = await fetch(url, {
        method: "POST",
        headers: { "X-MBX-APIKEY": apiKey },
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return {
          usdt: null,
          free: null,
          locked: null,
          error: `HTTP ${resp.status}: ${body.slice(0, 200)}`,
        };
      }

      const json = await resp.json() as FundingAsset[];
      if (!Array.isArray(json)) {
        return { usdt: null, free: null, locked: null, error: "Respons API tidak diharapkan" };
      }

      const usdtAsset = json.find((a) => a.asset === "USDT");
      if (!usdtAsset) {
        // Tidak ada USDT di Funding Wallet (saldo 0)
        return { usdt: 0, free: 0, locked: 0 };
      }

      const free = parseFloat(usdtAsset.free) || 0;
      const locked = parseFloat(usdtAsset.locked) || 0;
      const freeze = parseFloat(usdtAsset.freeze) || 0;
      return {
        usdt: free + locked + freeze,
        free,
        locked,
      };
    } catch (err) {
      return {
        usdt: null,
        free: null,
        locked: null,
        error: String(err),
      };
    }
  });
