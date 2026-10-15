/**
 * Modul Integrasi Khusus Binance C2C Merchant API.
 *
 * Endpoint Resmi Binance SAPI C2C:
 *   - GET  /sapi/v1/c2c/ads/list           -> Daftar iklan merchant
 *   - GET  /sapi/v1/c2c/ads/detail         -> Detail spesifik iklan
 *   - POST /sapi/v1/c2c/ads/update         -> Ubah harga, stok USDT, & limit transaksi iklan
 *   - POST /sapi/v1/c2c/ads/updateStatus   -> Nyalakan (Online) atau Jeda (Offline) iklan
 *   - POST /sapi/v1/c2c/ads/post           -> Terbitkan iklan baru
 *
 * Autentikasi: HMAC-SHA256 (USER_DATA) menggunakan BINANCE_API_KEY & BINANCE_API_SECRET
 * dengan permission "Enable C2C" / "Merchant Trading".
 */

import { createServerFn } from "@tanstack/react-start";
import { createHmac } from "crypto";
import { z } from "zod";

import { requireSession } from "./auth";

const DEFAULT_BINANCE_API_URL = "https://api.binance.com";

// ── Tipe Data Iklan Merchant ────────────────────────────────────────────────

export type BinanceMerchantAd = {
  advNo: string;
  tradeType: "BUY" | "SELL" | string;
  asset: string;
  fiatUnit: string;
  price: number | string;
  priceType?: number; // 1 = Fixed, 2 = Floating
  initAmount?: number | string;
  surplusAmount?: number | string;
  amount?: number | string;
  minSingleTransAmount?: number | string;
  maxSingleTransAmount?: number | string;
  advStatus?: number | string; // 1 = ONLINE, 2 = OFFLINE, 3 = CLOSED
  status?: string;
  payMethods?: Array<{
    identifier?: string;
    payMethodId?: string;
    payType?: string;
    tradeMethodName?: string;
  }> | string[];
  createTime?: number | string;
};

export type MerchantApiResponse<T = unknown> = {
  ok: boolean;
  code?: string | number;
  message?: string;
  data?: T;
  error?: string;
  timestamp?: number;
};

// ── Rem Darurat Rate Limit Binance ───────────────────────────────────────────
// HTTP 429 / kode -1003 = terlalu banyak request; HTTP 418 = IP sudah di-ban sementara.
// Setelah sinyal itu, SEMUA request signed ditahan sampai jeda selesai agar ban tidak diperpanjang.
let binanceRateLimitedUntil = 0;

function rateLimitedResponse<T>(): MerchantApiResponse<T> | null {
  const waitMs = binanceRateLimitedUntil - Date.now();
  if (waitMs <= 0) return null;
  return {
    ok: false,
    code: "RATE_LIMITED",
    error: "Binance rate limit aktif",
    message: `Binance membatasi request (rate limit). Bot menjeda semua request ${Math.ceil(waitMs / 1000)} detik agar IP tidak di-ban.`,
  };
}

function noteRateLimit(resp: Response, json: Record<string, unknown>): boolean {
  const code = String(json["code"] ?? "");
  if (resp.status !== 429 && resp.status !== 418 && code !== "-1003") return false;
  const retryAfterSec = Number(resp.headers.get("retry-after"));
  const pauseMs =
    Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : resp.status === 418 ? 120_000 : 60_000;
  binanceRateLimitedUntil = Math.max(binanceRateLimitedUntil, Date.now() + pauseMs);
  console.warn(`[BinanceMerchant] Rate limit (HTTP ${resp.status}, code ${code}). Request ditahan ${pauseMs / 1000}s.`);
  return true;
}

/** Error yang membuat percobaan endpoint lain sia-sia (dan hanya menambah beban rate limit). */
function isFatalBinanceError(res: MerchantApiResponse): boolean {
  return res.code === "RATE_LIMITED" || res.code === "NO_CREDENTIALS" || res.code === "NETWORK_ERROR";
}

// ── Helper Eksekusi Request HMAC Signed ke Binance SAPI ─────────────────────

async function binanceMerchantRequest<T = unknown>(options: {
  endpoint: string;
  method: "GET" | "POST";
  params?: Record<string, string | number | boolean | undefined>;
  apiKeyOverride?: string;
  apiSecretOverride?: string;
}): Promise<MerchantApiResponse<T>> {
  const apiKey = (options.apiKeyOverride || process.env["BINANCE_API_KEY"])?.trim();
  const apiSecret = (options.apiSecretOverride || process.env["BINANCE_API_SECRET"])?.trim();

  if (!apiKey || !apiSecret || apiKey === "your_binance_api_key_here" || apiSecret === "your_binance_api_secret_here") {
    return {
      ok: false,
      code: "NO_CREDENTIALS",
      error: "BINANCE_API_KEY dan BINANCE_API_SECRET belum diisi di file .env atau hosting!",
      message: "Harap konfigurasikan API Key & Secret Binance Anda terlebih dahulu.",
    };
  }

  const limited = rateLimitedResponse<T>();
  if (limited) return limited;

  const baseUrl =
    process.env["BINANCE_C2C_BASE_URL"] ||
    process.env["BINANCE_API_BASE_URL"] ||
    process.env["BINANCE_PROXY_URL"] ||
    DEFAULT_BINANCE_API_URL;

  const timestamp = Date.now();
  const queryEntries: [string, string][] = [];
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null && v !== "") {
        queryEntries.push([k, typeof v === "boolean" ? String(v) : String(v)]);
      }
    }
  }
  queryEntries.push(["recvWindow", "60000"]);
  queryEntries.push(["timestamp", String(timestamp)]);

  // Buat query string dan HMAC-SHA256 signature
  const qs = queryEntries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

  const signature = createHmac("sha256", apiSecret).update(qs).digest("hex");
  const fullQs = `${qs}&signature=${signature}`;

  // Sesuai spesifikasi Binance API:
  // Untuk POST, payload harus dikirim di request body jika Content-Type adalah form-urlencoded.
  // Untuk GET, parameter dikirim di query string URL.
  const isPost = options.method === "POST";
  let url = isPost
    ? `${baseUrl.replace(/\/$/, "")}${options.endpoint}`
    : `${baseUrl.replace(/\/$/, "")}${options.endpoint}?${fullQs}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let resp = await fetch(url, {
      method: options.method,
      headers: {
        "X-MBX-APIKEY": apiKey,
        ...(isPost ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        "User-Agent": "Binance-Merchant-Bot/2.0",
      },
      body: isPost ? fullQs : undefined,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    let rawText = await resp.text();
    let json: Record<string, unknown> = {};

    try {
      json = JSON.parse(rawText);
    } catch {
      // Abaikan jika bukan JSON
    }

    if (noteRateLimit(resp, json)) {
      return rateLimitedResponse<T>() ?? { ok: false, code: "RATE_LIMITED", message: "Binance rate limit aktif." };
    }

    // Jika POST via body ditolak (kode -1000 atau 4xx), coba sekali lagi dengan query string di URL.
    // JANGAN ulangi untuk 5xx: server Binance sedang bermasalah, mengulang hanya menambah beban.
    if (
      isPost &&
      ((!resp.ok && resp.status < 500) || json["code"] === "-1000" || json["code"] === -1000)
    ) {
      try {
        const fallbackUrl = `${baseUrl.replace(/\/$/, "")}${options.endpoint}?${fullQs}`;
        const fbController = new AbortController();
        const fbTimeout = setTimeout(() => fbController.abort(), 15_000);
        const fbResp = await fetch(fallbackUrl, {
          method: "POST",
          headers: {
            "X-MBX-APIKEY": apiKey,
            "User-Agent": "Binance-Merchant-Bot/2.0",
          },
          signal: fbController.signal,
        }).finally(() => clearTimeout(fbTimeout));

        const fbText = await fbResp.text();
        const fbJson = JSON.parse(fbText);
        if (noteRateLimit(fbResp, fbJson)) {
          return rateLimitedResponse<T>() ?? { ok: false, code: "RATE_LIMITED", message: "Binance rate limit aktif." };
        }
        if (fbResp.ok && (fbJson["code"] === "000000" || fbJson["code"] === "0" || fbJson["success"] === true)) {
          resp = fbResp;
          rawText = fbText;
          json = fbJson;
        }
      } catch {
        // Abaikan jika fallback gagal
      }
    }

    const code = String(json["code"] ?? (resp.ok ? "000000" : resp.status));
    const dataVal = json["data"];
    const isDataFalse =
      dataVal === false ||
      (typeof dataVal === "object" && dataVal !== null && (dataVal as Record<string, unknown>)["status"] === false);

    const isSuccess = resp.ok && (code === "000000" || code === "0" || json["success"] === true) && !isDataFalse;

    if (!isSuccess) {
      const errMsg =
        String(json["message"] || json["msg"] || json["error"] || (isDataFalse ? "Server Binance menolak pembaruan (data: false)" : "Gagal memproses request C2C Binance"));

      // Terjemahan pesan error umum Binance ke bahasa Indonesia
      let friendlyMsg = errMsg;
      if (code === "-1002" || code === "-2014" || errMsg.includes("API-key")) {
        friendlyMsg = "API Key tidak valid atau tidak memiliki izin C2C Merchant.";
      } else if (code === "-1021" || errMsg.includes("Timestamp")) {
        friendlyMsg = "Waktu jam lokal tidak sinkron dengan server Binance (Timestamp drift).";
      } else if (errMsg.includes("IP")) {
        friendlyMsg = "Alamat IP server belum terdaftar di whitelist IP API Key Binance.";
      } else if (errMsg.includes("permission") || errMsg.includes("merchant")) {
        friendlyMsg = "Akun belum memiliki izin C2C Merchant API. Pastikan akun sudah berstatus P2P Merchant.";
      } else if (isDataFalse) {
        friendlyMsg = "Server Binance menolak pembaruan iklan (data: false). Iklan mungkin sedang offline, terkunci pesanan, atau parameter limit tidak diizinkan.";
      } else if (code === "-1000" || errMsg.toLowerCase().includes("unknown error")) {
        friendlyMsg =
          "Binance C2C menolak update via API (Error -1000). Umumnya terjadi karena akun belum memiliki hak Binance P2Pro Merchant API atau nomor iklan tidak valid. Anda dapat menggunakan tombol 'Terapkan ke Form Beli' untuk memasukkan harga & stok secara instan 1-klik ke form!";
      }

      return {
        ok: false,
        code: isDataFalse ? "UPDATE_REJECTED" : code,
        error: errMsg,
        message: friendlyMsg,
        data: json["data"] as T,
        timestamp,
      };
    }

    return {
      ok: true,
      code: "000000",
      data: (json["data"] !== undefined ? json["data"] : json) as T,
      message: "Sukses",
      timestamp,
    };
  } catch (err: unknown) {
    const errorStr = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "NETWORK_ERROR",
      error: errorStr,
      message: errorStr.includes("aborted")
        ? "Koneksi ke Binance timeout (15 detik). Periksa koneksi atau gunakan proxy."
        : `Gagal menghubungi Binance: ${errorStr}`,
    };
  }
}

// ── Helper Eksekusi Request ke Binance C2C Agent SAPI (Protokol Binance Skill Hub) ─
/**
 * Helper Eksekusi Request ke Binance C2C Agent SAPI (Protokol Resmi Binance P2P Skill Hub).
 * Sesuai spesifikasi resmi: https://www.binance.com/en/skills/detail/binance/p2p
 *
 * Aturan krusial SAPI:
 *  1. JANGAN urutkan parameter (preserve original insertion order)! SAPI menolak query string yang disortir.
 *  2. Header wajib: User-Agent: binance-wallet/1.0.0 (Skill) dan X-MBX-APIKEY.
 *  3. Default recvWindow = 60000ms.
 *  4. Body JSON dikirim via method POST dengan header Content-Type: application/json.
 *  5. Menolak jika respon Binance mengembalikan "data": false.
 */
export async function binanceAgentRequest<T = unknown>(options: {
  endpoint: string;
  method?: "GET" | "POST";
  queryParams?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  apiKeyOverride?: string;
  apiSecretOverride?: string;
}): Promise<MerchantApiResponse<T>> {
  const apiKey = (options.apiKeyOverride || process.env["BINANCE_API_KEY"])?.trim();
  const apiSecret = (options.apiSecretOverride || process.env["BINANCE_API_SECRET"])?.trim();

  if (!apiKey || !apiSecret || apiKey === "your_binance_api_key_here" || apiSecret === "your_binance_api_secret_here") {
    return {
      ok: false,
      code: "NO_CREDENTIALS",
      error: "BINANCE_API_KEY dan BINANCE_API_SECRET belum diisi di file .env atau hosting!",
      message: "Harap konfigurasikan API Key & Secret Binance Anda terlebih dahulu.",
    };
  }

  const baseUrl =
    process.env["BINANCE_C2C_BASE_URL"] ||
    process.env["BINANCE_API_BASE_URL"] ||
    process.env["BINANCE_PROXY_URL"] ||
    DEFAULT_BINANCE_API_URL;

  const limited = rateLimitedResponse<T>();
  if (limited) return limited;

  const method = options.method || "POST";
  const timestamp = Date.now();

  // Mempertahankan original insertion order parameter untuk SAPI (CRITICAL!)
  const queryEntries: [string, string][] = [];
  if (options.queryParams) {
    for (const [k, v] of Object.entries(options.queryParams)) {
      if (v !== undefined && v !== null && v !== "") {
        queryEntries.push([k, String(v)]);
      }
    }
  }
  queryEntries.push(["recvWindow", "60000"]);
  queryEntries.push(["timestamp", String(timestamp)]);

  const qs = queryEntries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const signature = createHmac("sha256", apiSecret).update(qs).digest("hex");
  const fullQs = `${qs}&signature=${signature}`;
  const url = `${baseUrl.replace(/\/$/, "")}${options.endpoint}?${fullQs}`;

  const headers: Record<string, string> = {
    "X-MBX-APIKEY": apiKey,
    "User-Agent": "binance-wallet/1.0.0 (Skill)",
  };

  let bodyStr: string | undefined = undefined;
  if (options.body !== undefined && options.body !== null) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(options.body);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, {
      method,
      headers,
      body: bodyStr,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const rawText = await resp.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(rawText);
    } catch {
      // Abaikan jika bukan JSON
    }

    if (noteRateLimit(resp, json)) {
      return rateLimitedResponse<T>() ?? { ok: false, code: "RATE_LIMITED", message: "Binance rate limit aktif." };
    }

    const code = String(json["code"] ?? (resp.ok ? "000000" : resp.status));
    const dataVal = json["data"];
    const isDataFalse =
      dataVal === false ||
      (typeof dataVal === "object" && dataVal !== null && (dataVal as Record<string, unknown>)["status"] === false);

    const isSuccess =
      resp.ok &&
      (code === "000000" ||
        code === "0" ||
        json["success"] === true ||
        json["status"] === true) &&
      !isDataFalse;

    if (!isSuccess) {
      const errMsg = String(
        json["message"] || json["msg"] || json["error"] || (isDataFalse ? "Server Binance menolak update (data: false)" : "Gagal memproses request C2C Agent SAPI")
      );
      let friendlyMsg = errMsg;
      if (code === "-1002") {
        friendlyMsg = `Iklan tidak ditemukan atau bukan milik akun API Key Anda (-1002): ${errMsg}`;
      } else if (code === "-2015" || errMsg.includes("API-key")) {
        friendlyMsg = `API Key tidak valid, IP belum terdaftar di whitelist, atau izin C2C belum aktif (-2015): ${errMsg}`;
      } else if (code === "-1022") {
        friendlyMsg = `Signature verification failed (-1022). Pastikan Secret Key benar dan jam tersinkron: ${errMsg}`;
      } else if (isDataFalse) {
        friendlyMsg = `Server Binance menolak pembaruan iklan (data: false). Iklan mungkin sedang offline, terkunci pesanan, atau parameter limit ditolak.`;
      } else if (code === "-9000") {
        friendlyMsg = `Parameter iklan tidak valid (-9000): ${errMsg}`;
      }

      return {
        ok: false,
        code: isDataFalse ? "UPDATE_REJECTED" : code,
        error: errMsg,
        message: friendlyMsg,
        data: json["data"] as T,
        timestamp,
      };
    }

    return {
      ok: true,
      code: "000000",
      data: (json["data"] !== undefined ? json["data"] : json) as T,
      message: "Sukses",
      timestamp,
    };
  } catch (err: unknown) {
    const errorStr = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "NETWORK_ERROR",
      error: errorStr,
      message: errorStr.includes("aborted")
        ? "Koneksi ke Binance timeout (15 detik). Periksa koneksi atau proxy."
        : `Gagal menghubungi Binance SAPI: ${errorStr}`,
    };
  }
}

// ── 1. Ambil Daftar Iklan Merchant ──────────────────────────────────────────

const listAdsInputSchema = z.object({
  sessionToken: z.string().optional(),
  page: z.number().optional().default(1),
  rows: z.number().optional().default(20),
  tradeType: z.enum(["BUY", "SELL"]).optional(),
  asset: z.string().optional().default("USDT"),
  fiatUnit: z.string().optional().default("IDR"),
  advStatus: z.number().optional(), // 1: ONLINE, 2: OFFLINE
});

export const getMerchantAdsList = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => listAdsInputSchema.parse(data))
  .handler(async ({ data }): Promise<MerchantApiResponse<BinanceMerchantAd[]>> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Sesi dashboard tidak terverifikasi.",
        message: "Sesi dashboard kedaluwarsa atau belum terautentikasi.",
      };
    }

    // 1. Coba Agent SAPI listWithPagination (Protokol Resmi Binance Skill)
    const agentListRes = await binanceAgentRequest<{
      total?: number;
      data?: BinanceMerchantAd[];
    } | BinanceMerchantAd[]>({
      endpoint: "/sapi/v1/c2c/agent/ads/listWithPagination",
      method: "POST",
      body: {
        page: data.page,
        rows: data.rows,
      },
    });

    if (agentListRes.ok && agentListRes.data) {
      const list = Array.isArray(agentListRes.data)
        ? agentListRes.data
        : Array.isArray((agentListRes.data as Record<string, unknown>)["data"])
        ? ((agentListRes.data as Record<string, unknown>)["data"] as BinanceMerchantAd[])
        : [];
      if (list.length > 0) {
        return {
          ok: true,
          code: "000000",
          data: list,
          message: "Sukses",
        };
      }
    }

    // 2. Coba endpoint standar C2C ads list
    const res = await binanceMerchantRequest<BinanceMerchantAd[]>({
      endpoint: "/sapi/v1/c2c/ads/list",
      method: "GET",
      params: {
        page: data.page,
        rows: data.rows,
        tradeType: data.tradeType,
        asset: data.asset,
        fiatUnit: data.fiatUnit,
        advStatus: data.advStatus,
      },
    });

    // 3. Jika endpoint /ads/list tidak ditemukan, fallback ke /orderMatch/getUserAdvList
    if (!res.ok && (res.code === 404 || String(res.code) === "-1002")) {
      return binanceMerchantRequest<BinanceMerchantAd[]>({
        endpoint: "/sapi/v1/c2c/orderMatch/getUserAdvList",
        method: "GET",
        params: {
          page: data.page,
          rows: data.rows,
        },
      });
    }

    return res;
  });

// ── Helper Pengambilan Objek Iklan Multi-Tier ────────────────────────────────

/**
 * Mengambil objek iklan lengkap dari Binance melalui beberapa jalur endpoint resmi.
 * Jika nomor iklan spesifik tidak cocok, otomatis mencari iklan aktif sesuai side (BUY/SELL).
 */
// Jalur pengambilan detail iklan yang terakhir berhasil (per instance server). Dicoba duluan pada
// panggilan berikutnya, sehingga satu fetch detail biasanya cukup 1 request alih-alih sampai 6.
let preferredAdDetailPath: number | null = null;

async function fetchAdDetailRobustly(
  advNo: string,
  targetSide?: "buy" | "sell",
  credentials?: { apiKeyOverride?: string; apiSecretOverride?: string }
): Promise<Record<string, unknown> | null> {
  const cleanAdvNo = advNo.trim().replace(/^#/, "");
  const isObj = (d: unknown): d is Record<string, unknown> => !!d && typeof d === "object" && !Array.isArray(d);
  const matchAdvNo = (item: unknown) =>
    isObj(item) && String(item["advNo"] || "").trim().replace(/^#/, "") === cleanAdvNo;

  type PathResult = { ad: Record<string, unknown> | null; res: MerchantApiResponse<unknown> };

  const paths: Array<() => Promise<PathResult>> = [
    // Jalur 0: POST /sapi/v1/c2c/agent/ads/getDetailByNo dengan query param advNo
    async () => {
      const res = await binanceAgentRequest<Record<string, unknown>>({
        endpoint: "/sapi/v1/c2c/agent/ads/getDetailByNo",
        method: "POST",
        queryParams: { advNo: cleanAdvNo },
        body: {},
        ...credentials,
      });
      return { ad: res.ok && isObj(res.data) ? res.data : null, res };
    },
    // Jalur 1: POST /sapi/v1/c2c/agent/ads/getDetailByNo dengan JSON body { advNo }
    async () => {
      const res = await binanceAgentRequest<Record<string, unknown>>({
        endpoint: "/sapi/v1/c2c/agent/ads/getDetailByNo",
        method: "POST",
        body: { advNo: cleanAdvNo },
        ...credentials,
      });
      return { ad: res.ok && isObj(res.data) ? res.data : null, res };
    },
    // Jalur 2: GET /sapi/v1/c2c/agent/ads/getDetailByNo?advNo=...
    async () => {
      const res = await binanceAgentRequest<Record<string, unknown>>({
        endpoint: "/sapi/v1/c2c/agent/ads/getDetailByNo",
        method: "GET",
        queryParams: { advNo: cleanAdvNo },
        ...credentials,
      });
      return { ad: res.ok && isObj(res.data) ? res.data : null, res };
    },
    // Jalur 3: POST /sapi/v1/c2c/agent/ads/listWithPagination (cari iklan di daftar akun)
    async () => {
      const res = await binanceAgentRequest<{ data?: unknown[]; total?: number } | unknown[]>({
        endpoint: "/sapi/v1/c2c/agent/ads/listWithPagination",
        method: "POST",
        body: { page: 1, rows: 50 },
        ...credentials,
      });
      if (!res.ok || !res.data) return { ad: null, res };
      const list = Array.isArray(res.data)
        ? res.data
        : Array.isArray((res.data as Record<string, unknown>)["data"])
        ? ((res.data as Record<string, unknown>)["data"] as unknown[])
        : [];
      const found = list.find(matchAdvNo);
      if (found) return { ad: found as Record<string, unknown>, res };
      // Jika advNo tidak cocok persis, auto-detect iklan aktif berdasarkan side (BUY / SELL)
      if (targetSide) {
        const sideMatched = list.find((item: unknown) => {
          if (!isObj(item)) return false;
          const tt = String(item["tradeType"] || "").toUpperCase();
          return targetSide === "buy"
            ? tt === "BUY" || item["tradeType"] === 0 || item["tradeType"] === "0"
            : tt === "SELL" || item["tradeType"] === 1 || item["tradeType"] === "1";
        });
        if (sideMatched) return { ad: sideMatched as Record<string, unknown>, res };
      }
      return { ad: null, res };
    },
    // Jalur 4: GET /sapi/v1/c2c/ads/list
    async () => {
      const res = await binanceMerchantRequest<Record<string, unknown>[]>({
        endpoint: "/sapi/v1/c2c/ads/list",
        method: "GET",
        params: { page: 1, rows: 50 },
        ...credentials,
      });
      if (!res.ok || !Array.isArray(res.data)) return { ad: null, res };
      const found = res.data.find(matchAdvNo);
      if (found) return { ad: found, res };
      if (targetSide) {
        const sideMatched = res.data.find((item) => {
          if (!isObj(item)) return false;
          const tt = String(item["tradeType"] || "").toUpperCase();
          return targetSide === "buy" ? tt === "BUY" || item["tradeType"] === 0 : tt === "SELL" || item["tradeType"] === 1;
        });
        if (sideMatched) return { ad: sideMatched, res };
      }
      return { ad: null, res };
    },
    // Jalur 5: GET /sapi/v1/c2c/orderMatch/getUserAdvList
    async () => {
      const res = await binanceMerchantRequest<Record<string, unknown>[]>({
        endpoint: "/sapi/v1/c2c/orderMatch/getUserAdvList",
        method: "GET",
        params: { page: 1, rows: 50 },
        ...credentials,
      });
      const found = res.ok && Array.isArray(res.data) ? res.data.find(matchAdvNo) : undefined;
      return { ad: found ?? null, res };
    },
  ];

  const order =
    preferredAdDetailPath !== null
      ? [preferredAdDetailPath, ...paths.map((_, i) => i).filter((i) => i !== preferredAdDetailPath)]
      : paths.map((_, i) => i);

  for (const i of order) {
    try {
      const { ad, res } = await paths[i]!();
      if (ad) {
        preferredAdDetailPath = i;
        return ad;
      }
      if (isFatalBinanceError(res)) return null; // rate limit / jaringan: jangan bombardir jalur lain
    } catch {
      // Lanjut ke jalur berikutnya
    }
  }

  return null;
}

// ── 2. Update Harga, Stok, & Limit Iklan (Protokol Binance Skill 2-Step) ─────

const updateAdInputSchema = z.object({
  sessionToken: z.string().optional(),
  advNo: z.string().min(1, "Nomor iklan (advNo) wajib diisi"),
  price: z.number().positive("Harga wajib lebih besar dari 0"),
  priceType: z.number().optional().default(1), // 1 = Fixed
  amount: z.number().optional(),               // Stok USDT
  minSingleTransAmount: z.number().optional(), // Min limit IDR
  maxSingleTransAmount: z.number().optional(), // Max limit IDR (dari saldo bank)
  side: z.enum(["buy", "sell", "BUY", "SELL"]).optional(),
  payMethods: z.array(z.string()).optional(),
  floorPrice: z.number().optional(),
  ceilingPrice: z.number().optional(),
  hasActiveOrders: z.boolean().optional(),
  priceOnly: z.boolean().optional(),
});

export type UpdateAdInternalParams = {
  advNo: string;
  price: number;
  amount?: number;
  minSingleTransAmount?: number;
  maxSingleTransAmount?: number;
  side?: "buy" | "sell" | "BUY" | "SELL";
  payMethods?: string[];
  floorPrice?: number;
  ceilingPrice?: number;
  hasActiveOrders?: boolean;
  priceOnly?: boolean;
};

export async function toggleMerchantAdStatusInternal(
  advNo: string,
  advStatus: "ONLINE" | "OFFLINE"
): Promise<MerchantApiResponse> {
  const cleanAdvNo = advNo.trim().replace(/^#/, "");

  // 1. Coba Agent SAPI updateStatus (1=Online, 3=Offline)
  const agentRes = await binanceAgentRequest({
    endpoint: "/sapi/v1/c2c/agent/ads/updateStatus",
    method: "POST",
    body: {
      advNos: [cleanAdvNo],
      advStatus: advStatus === "ONLINE" ? 1 : 3,
    },
  });

  if (agentRes.ok) {
    return agentRes;
  }

  // 2. Fallback ke legacy
  return binanceMerchantRequest({
    endpoint: "/sapi/v1/c2c/ads/updateStatus",
    method: "POST",
    params: {
      advNo: cleanAdvNo,
      advStatus: advStatus === "ONLINE" ? 1 : 2,
      status: advStatus,
    },
  });
}

// Rute endpoint update yang terakhir berhasil (per instance server), dicoba duluan pada push berikutnya
// agar satu push biasanya cukup 1 request update, bukan menyisir 6 endpoint setiap kali.
type UpdateRoute = "std" | "singular" | "agent";
const ALL_UPDATE_ROUTES: UpdateRoute[] = ["std", "singular", "agent"];
const preferredUpdateRoute: { full?: UpdateRoute; priceOnly?: UpdateRoute } = {};

export async function updateMerchantAdInternal(data: UpdateAdInternalParams): Promise<MerchantApiResponse> {
  const cleanAdvNo = data.advNo.trim().replace(/^#/, "");
    let newPrice = Math.round(data.price);

    // =========================================================================
    // PROTOKOL UTAMA: Binance P2P Skill Agent SAPI (Full-Object Update)
    // Sesuai dokumentasi https://www.binance.com/en/skills/detail/binance/p2p
    // Step 1: Ambil data iklan utuh via fetchAdDetailRobustly
    // Step 2: Merge perubahan ke objek utuh (direct response merge)
    // Step 3: Kirim update via POST /sapi/v1/c2c/agent/ads/update (JSON body)
    // Step 4: Verifikasi live status langsung di Binance
    // =========================================================================

    const targetSide = data.side ? (data.side.toLowerCase() as "buy" | "sell") : undefined;
    const existingAd = await fetchAdDetailRobustly(cleanAdvNo, targetSide);

    // Jika iklan tidak ditemukan di akun Binance sama sekali:
    if (!existingAd) {
      return {
        ok: false,
        code: "ADV_NOT_FOUND",
        error: `Iklan #${cleanAdvNo} tidak ditemukan pada akun Binance API Key Anda.`,
        message: `Iklan #${cleanAdvNo} tidak ditemukan di akun Binance Anda. Pastikan API Key benar dan Anda memiliki iklan P2P aktif.`,
        timestamp: Date.now(),
      };
    }

    const targetAdvNo = String(existingAd["advNo"] || cleanAdvNo);

    // Tentukan tradeType: Jual (SELL) = maker jual USDT (isBuy = false), Beli (BUY) = maker beli USDT (isBuy = true)
    // PRIORITAS UTAMA: targetSide eksplisit ("sell" | "buy") yang dikirim oleh bot/pemanggil!
    // JANGAN PERNAH biarkan existingAd["tradeType"] membalikkan targetSide ("sell" -> isBuy = true),
    // karena di sebagian API Binance P2P publik, tradeType merujuk ke aksi taker/pembeli.
    let isBuy = false;
    if (targetSide === "sell") {
      isBuy = false;
    } else if (targetSide === "buy") {
      isBuy = true;
    } else {
      const tt = existingAd["tradeType"];
      if (tt === "SELL" || tt === 1 || tt === "1") {
        isBuy = false;
      } else if (tt === "BUY" || tt === 0 || tt === "0") {
        isBuy = true;
      } else {
        isBuy = false;
      }
    }

    // ── DEFENSE-IN-DEPTH: Proteksi Batas Bawah Iklan Jual & Batas Iklan Beli (Hard Floor/Ceiling Clamp) ──
    try {
      const { getBotConfigServer } = await import("./background-bot-engine");
      const botCfg = await getBotConfigServer();

      if (!isBuy || targetSide === "sell") {
        // Proteksi JUAL (SELL) - HARD FLOOR MUTLAK
        // HARGA JUAL TIDAK BOLEH PERNAH DI BAWAH BATAS BAWAH AMAN / MODAL!
        const hardMinSell = Math.max(
          data.floorPrice || 0,
          botCfg.manualSellFloorRp || 0,
          botCfg.minPriceBoundRp || 0
        );
        if (hardMinSell > 0 && newPrice < hardMinSell) {
          console.warn(`[BinanceMerchant] Hard floor triggered for SELL ad #${cleanAdvNo}: Rp ${newPrice} < Rp ${hardMinSell}. Clamped to Rp ${hardMinSell}.`);
          newPrice = hardMinSell;
        }
        if (botCfg.maxPriceBoundRp && botCfg.maxPriceBoundRp > 0 && newPrice > botCfg.maxPriceBoundRp) {
          newPrice = hardMinSell > 0 && botCfg.maxPriceBoundRp < hardMinSell ? hardMinSell : botCfg.maxPriceBoundRp;
        }
      } else {
        // Proteksi BELI (BUY) - FLOOR dulu, lalu CEILING (ceiling selalu menang agar tidak membeli kemahalan).
        // minPriceBoundRp sengaja TIDAK dipakai di sini: engine hanya menerapkannya ke sisi beli bila di
        // bawah sell floor, dan nilai itu sudah ikut terkirim lewat data.floorPrice.
        const hardMinBuy = Math.max(data.floorPrice || 0, botCfg.manualBuyFloorRp || 0);
        if (hardMinBuy > 0 && newPrice < hardMinBuy) {
          newPrice = hardMinBuy;
        }
        const hardMaxBuy = Math.min(
          data.ceilingPrice && data.ceilingPrice > 0 ? data.ceilingPrice : 999_999,
          botCfg.manualBuyCeilingRp && botCfg.manualBuyCeilingRp > 0 && botCfg.manualBuyCeilingRp < 999_999
            ? botCfg.manualBuyCeilingRp
            : 999_999,
          botCfg.maxPriceBoundRp && botCfg.maxPriceBoundRp > 0 ? botCfg.maxPriceBoundRp : 999_999
        );
        if (hardMaxBuy < 999_999 && newPrice > hardMaxBuy) {
          console.warn(`[BinanceMerchant] Hard ceiling triggered for BUY ad #${cleanAdvNo}: Rp ${newPrice} > Rp ${hardMaxBuy}. Clamped to Rp ${hardMaxBuy}.`);
          newPrice = hardMaxBuy;
        }
      }
    } catch {
      // Fallback lokal jika import config gagal
      if ((!isBuy || targetSide === "sell") && data.floorPrice && data.floorPrice > 0 && newPrice < data.floorPrice) {
        newPrice = data.floorPrice;
      } else if (isBuy && targetSide !== "sell") {
        if (data.floorPrice && data.floorPrice > 0 && newPrice < data.floorPrice) {
          newPrice = data.floorPrice;
        }
        if (data.ceilingPrice && data.ceilingPrice > 0 && newPrice > data.ceilingPrice) {
          newPrice = data.ceilingPrice;
        }
      }
    }

    // ── Gembok Terakhir (Ultimate Floor Lock): Untuk iklan SELL, newPrice MUTLAK TIDAK BOLEH kurang dari floorPrice ──
    if ((!isBuy || targetSide === "sell") && data.floorPrice && data.floorPrice > 0) {
      if (newPrice < data.floorPrice) {
        console.error(`[BinanceMerchant] CRITICAL FLOOR VIOLATION PREVENTED: Ad #${cleanAdvNo} SELL price Rp ${newPrice} was below floorPrice Rp ${data.floorPrice}. Clamped to Rp ${data.floorPrice}!`);
        newPrice = data.floorPrice;
      }
    }
    newPrice = Math.round(newPrice);

    // Hitung status jumlah/stok:
    const origInit = Number(existingAd["initAmount"] ?? existingAd["amount"] ?? 0);
    const origSurplus = Number(existingAd["surplusAmount"] ?? existingAd["tradableQuantity"] ?? 0);
    const executedAmount = Math.max(0, origInit - origSurplus);

    // 1. Jika data.amount secara eksplisit bernilai <= 0 (kas habis atau stok 0):
    // JANGAN PERNAH pasang di Binance atau fallback ke origInit (modal awal).
    // Otomatis OFFLINE-kan iklan di Binance untuk mencegah over-budget!
    if (typeof data.amount === "number" && data.amount <= 0) {
      await toggleMerchantAdStatusInternal(cleanAdvNo, "OFFLINE");
      return {
        ok: true,
        code: "AUTO_OFFLINED_ZERO_STOCK",
        message: `Saldo kas/stok bernilai 0. Iklan #${cleanAdvNo} (${isBuy ? "Beli" : "Jual"}) otomatis di-OFFLINE-kan di Binance untuk proteksi modal.`,
        timestamp: Date.now(),
      };
    }

    // 2. Jika data.amount tidak diberikan (undefined):
    // Cek sisa kuota live di Binance (origSurplus).
    // Jika sisa kuota sudah 0 (misal terisi habis oleh order), JANGAN fallback ke origInit!
    if (typeof data.amount === "undefined" && origSurplus <= 0) {
      await toggleMerchantAdStatusInternal(cleanAdvNo, "OFFLINE");
      return {
        ok: true,
        code: "AUTO_OFFLINED_DEPLETED",
        message: `Sisa kuota iklan #${cleanAdvNo} di Binance telah habis (0 USDT). Iklan otomatis di-OFFLINE-kan agar tidak terjadi order di luar kapasitas modal.`,
        timestamp: Date.now(),
      };
    }

    // Target stock yang ingin dipasang:
    // HANYA gunakan data.amount jika valid > 0, atau pertahankan sisa kuota berjalan (origSurplus).
    // TIDAK BOLEH PERNAH menggunakan origInit (modal awal saat iklan pertama kali dibuat)!
    const isStockUpdateRequested = typeof data.amount === "number" && data.amount > 0;
    let targetStock = isStockUpdateRequested
      ? Math.floor(data.amount! * 100) / 100
      : Math.floor(Math.max(0, origSurplus) * 100) / 100;

    if (targetStock <= 0) {
      await toggleMerchantAdStatusInternal(cleanAdvNo, "OFFLINE");
      return {
        ok: true,
        code: "AUTO_OFFLINED_NO_STOCK",
        message: `Target stok iklan #${cleanAdvNo} bernilai 0 USDT. Iklan otomatis di-OFFLINE-kan di Binance.`,
        timestamp: Date.now(),
      };
    }

    // Untuk iklan JUAL (SELL):
    // Binance memotong maker reserved fee (~0.05%) saat memasang stok.
    // Jika targetStock dikirim mentah dari total saldo funding, potong reserved fee persis sesuai "Max. available: ... USDT All" di Binance
    if (!isBuy && isStockUpdateRequested && targetStock > 0) {
      const maxAvailableDeducted = Math.floor((targetStock / 1.0005) * 100) / 100;
      if (targetStock > origSurplus && maxAvailableDeducted > 0) {
        targetStock = maxAvailableDeducted;
      }
    }

    // Kapasitas fiat penuh dari target stok pada harga baru:
    const fiatCap = Math.floor(targetStock * newPrice);

    // Total init amount yang harus dialokasikan ke Binance:
    // Jika iklan sudah memiliki riwayat order yang dieksekusi (executedAmount > 0),
    // Binance menghitung surplus baru = initAmount - executedAmount.
    // Oleh karena itu, initAmount = executedAmount + targetStock agar sisa tradable kuota persis sesuai targetStock!
    const totalInitAmount =
      executedAmount > 0 ? Math.floor((executedAmount + targetStock) * 100) / 100 : targetStock;

    // Hitung maxLimit IDR:
    let maxLimit = data.maxSingleTransAmount && data.maxSingleTransAmount > 0
      ? Math.round(data.maxSingleTransAmount)
      : isBuy
      ? 500_000_000
      : existingAd["maxSingleTransAmount"]
      ? Math.round(Number(existingAd["maxSingleTransAmount"]))
      : fiatCap;

    // Di Binance C2C: maxSingleTransAmount TIDAK BOLEH melebihi total kapasitas fiat iklan (fiatCap)
    // jika kuota stok iklan lebih kecil daripada nominal limit yang diminta.
    if (fiatCap > 0 && maxLimit > fiatCap) {
      maxLimit = fiatCap;
    }
    if (maxLimit <= 0) {
      maxLimit = fiatCap > 0 ? fiatCap : 500_000_000;
    }

    // Hitung minLimit IDR:
    let minLimit = data.minSingleTransAmount && data.minSingleTransAmount > 0
      ? Math.round(data.minSingleTransAmount)
      : isBuy
      ? 50_000_000
      : existingAd["minSingleTransAmount"]
      ? Math.round(Number(existingAd["minSingleTransAmount"]))
      : 50000;

    // ATURAN MUTLAK BINANCE C2C IDR:
    // 1. Batas transaksi minimum IDR resmi Binance C2C adalah Rp 50.000 (tidak boleh < 50.000).
    // 2. minSingleTransAmount HARUS selalu lebih kecil (<) dari maxSingleTransAmount!
    // 3. minSingleTransAmount TIDAK BOLEH lebih besar dari total kapasitas fiat iklan (fiatCap)!
    const BINANCE_IDR_MIN_TX = 50_000;
    if (fiatCap > 0 && minLimit >= fiatCap) {
      minLimit = Math.max(BINANCE_IDR_MIN_TX, Math.floor(fiatCap * 0.2));
    }
    if (minLimit < BINANCE_IDR_MIN_TX) {
      minLimit = BINANCE_IDR_MIN_TX;
    }
    if (minLimit >= maxLimit) {
      maxLimit = Math.max(minLimit + 10_000, fiatCap);
    }

    let lastError: MerchantApiResponse | null = null;
    let updateSucceeded = false;
    let usedStockPreservedFallback = false;

    // Sanitasi tradeMethods sesuai spesifikasi resmi Binance:
    // - Untuk BUY ads: boleh kirim identifier (sistem method, e.g. BCA, BANK).
    // - Untuk SELL ads: HANYA boleh jika memiliki payId (numeric ID akun terdaftar merchant).
    // JANGAN PERNAH mengirim identifier string tanpa payId untuk SELL ads karena Binance menolak update!
    const sanitizedTradeMethods = Array.isArray(existingAd["tradeMethods"])
      ? existingAd["tradeMethods"]
          .map((m: any) => {
            if (isBuy) {
              const id = m?.identifier || m?.tradeMethodName;
              return id ? { identifier: String(id) } : null;
            } else {
              const payId = m?.payId ?? m?.payMethodId ?? m?.userPayMethodId ?? m?.id;
              return payId && !isNaN(Number(payId)) ? { payId: Number(payId) } : null;
            }
          })
          .filter(Boolean)
      : undefined;

    const effectiveTradeMethods =
      sanitizedTradeMethods && sanitizedTradeMethods.length > 0
        ? sanitizedTradeMethods
        : undefined;

    // Helper membuat payload bersih standar Agent SAPI DTO
    const buildCleanPayload = (stockVal: number, tradeTypeVal: string | number) => {
      const p: Record<string, any> = {
        advNo: targetAdvNo,
        tradeType: tradeTypeVal,
        asset: String(existingAd["asset"] || "USDT"),
        fiatUnit: String(existingAd["fiatUnit"] || "IDR"),
        priceType: Number(existingAd["priceType"] || 1),
        price: newPrice,
        initAmount: stockVal,
        amount: isStockUpdateRequested ? targetStock : stockVal,
        minSingleTransAmount: minLimit,
        maxSingleTransAmount: maxLimit,
      };
      if (effectiveTradeMethods && effectiveTradeMethods.length > 0) {
        p.tradeMethods = effectiveTradeMethods;
      }
      if (existingAd["payTimeLimit"]) p.payTimeLimit = Number(existingAd["payTimeLimit"]);
      if (existingAd["remarks"]) p.remarks = String(existingAd["remarks"]);
      if (existingAd["autoReplyMsg"]) p.autoReplyMsg = String(existingAd["autoReplyMsg"]);
      if (existingAd["advStatus"] !== undefined) p.advStatus = Number(existingAd["advStatus"]);
      if (existingAd["buyerKycLimit"] !== undefined) p.buyerKycLimit = Number(existingAd["buyerKycLimit"]);
      if (existingAd["takerAdditionalKycRequired"] !== undefined) {
        p.takerAdditionalKycRequired = Number(existingAd["takerAdditionalKycRequired"]);
      }
      return p;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // PENGECEKAN JALUR HARGA SAJA (PRICE-ONLY / ONGOING SELL ORDERS):
    // Jalur cepat Price-Only HANYA aktif jika:
    // 1. Permintaan eksplisit priceOnly (tanpa request update stok), ATAU
    // 2. Iklan JUAL (SELL) yang sedang memiliki pesanan aktif (hasActiveOrders: true),
    //    karena pada iklan JUAL Binance mengunci saldo kripto merchant di escrow sehingga
    //    perubahan stok/limit ditolak Binance saat ada order berlangsung.
    //
    // CATATAN KRUSIAL: Untuk iklan BELI (BUY), Binance TIDAK mengunci kuota kripto merchant,
    // sehingga stok USDT beli dan limit IDR WAJIB selalu diperbarui otomatis mengikuti kas!
    // ─────────────────────────────────────────────────────────────────────────
    const isPriceOnlyMode =
      (Boolean(data.priceOnly) && !isStockUpdateRequested) ||
      (!isBuy && Boolean(data.hasActiveOrders));

    // Jalankan satu rute update. withStock = kirim stok & limit sekaligus.
    const runUpdateRoute = (route: UpdateRoute, withStock: boolean): Promise<MerchantApiResponse> => {
      const stockFields = withStock
        ? {
            initAmount: totalInitAmount,
            amount: targetStock,
            minSingleTransAmount: minLimit,
            maxSingleTransAmount: maxLimit,
          }
        : {};
      if (route === "agent") {
        const body: Record<string, unknown> = { advNo: targetAdvNo, price: newPrice, priceType: 1, ...stockFields };
        if (withStock && effectiveTradeMethods && effectiveTradeMethods.length > 0) {
          body["tradeMethods"] = effectiveTradeMethods;
        }
        return binanceAgentRequest({ endpoint: "/sapi/v1/c2c/agent/ads/update", method: "POST", body });
      }
      return binanceMerchantRequest({
        endpoint: route === "std" ? "/sapi/v1/c2c/ads/update" : "/sapi/v1/c2c/ad/update",
        method: "POST",
        params: { advNo: targetAdvNo, adNo: targetAdvNo, price: newPrice, priceType: 1, ...stockFields },
      });
    };

    // Coba rute yang terakhir berhasil dulu, lalu sisanya. Berhenti total pada rate limit / jaringan putus.
    const tryUpdateRoutes = async (
      withStock: boolean,
    ): Promise<{ ok: boolean; lastError: MerchantApiResponse | null; aborted: boolean }> => {
      const key = withStock ? "full" : "priceOnly";
      const pref = preferredUpdateRoute[key];
      const routes = pref ? [pref, ...ALL_UPDATE_ROUTES.filter((r) => r !== pref)] : ALL_UPDATE_ROUTES;
      let err: MerchantApiResponse | null = null;
      for (const route of routes) {
        const res = await runUpdateRoute(route, withStock);
        if (res.ok && res.data !== false) {
          preferredUpdateRoute[key] = route;
          return { ok: true, lastError: null, aborted: false };
        }
        err = res;
        if (isFatalBinanceError(res)) return { ok: false, lastError: err, aborted: true };
      }
      return { ok: false, lastError: err, aborted: false };
    };

    if (isPriceOnlyMode) {
      const attempt = await tryUpdateRoutes(false);
      updateSucceeded = attempt.ok;
      lastError = attempt.lastError;
      if (updateSucceeded) usedStockPreservedFallback = true;
    } else {
      // MODE NORMAL: UPDATE HARGA & STOK, lalu fallback ke Price-Only agar bot tidak telat update harga di pasar.
      let aborted = false;
      if (isStockUpdateRequested) {
        const attempt = await tryUpdateRoutes(true);
        updateSucceeded = attempt.ok;
        lastError = attempt.lastError;
        aborted = attempt.aborted;
      }
      if (!updateSucceeded && !aborted) {
        const attempt = await tryUpdateRoutes(false);
        updateSucceeded = attempt.ok;
        lastError = attempt.lastError ?? lastError;
        if (updateSucceeded && isStockUpdateRequested) usedStockPreservedFallback = true;
      }
    }

    // =========================================================================
    // POST-UPDATE VERIFIKASI LANGSUNG KE BINANCE (HARGA & STOK)
    // Polling cepat (cek ±0,5s, ±1,2s, ±2,2s) dan berhenti begitu harga live cocok, menggantikan
    // jeda tetap 1,2s + 1,5s. Saat update gagal: cukup 1 kali baca tanpa jeda untuk pesan error.
    // =========================================================================
    let isLivePriceVerified = false;
    let isLiveStockVerified = false;
    let livePriceAfter: number | null = null;
    let liveStockAfter: number | null = null;

    const readLiveAd = async (): Promise<{ price: number | null; stock: number | null } | null> => {
      const verifyAd = await fetchAdDetailRobustly(targetAdvNo);
      if (!verifyAd) return null;
      const price =
        verifyAd["price"] !== undefined && verifyAd["price"] !== null ? Math.round(Number(verifyAd["price"])) : null;
      const currentSurplus = Number(
        verifyAd["surplusAmount"] ??
        verifyAd["tradableQuantity"] ??
        verifyAd["amount"] ??
        verifyAd["initAmount"] ??
        0
      );
      return { price, stock: currentSurplus > 0 ? Math.floor(currentSurplus * 100) / 100 : null };
    };
    const fatalStop = lastError !== null && isFatalBinanceError(lastError);
    const verifyDelaysMs = updateSucceeded ? [500, 700, 1000] : fatalStop ? [] : [0];
    for (const delayMs of verifyDelaysMs) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      let live: Awaited<ReturnType<typeof readLiveAd>> = null;
      try {
        live = await readLiveAd();
      } catch {
        // Abaikan error verifikasi
      }
      if (live?.price != null) {
        livePriceAfter = live.price;
        isLivePriceVerified = live.price === newPrice;
      }
      if (live?.stock != null) {
        liveStockAfter = live.stock;
        isLiveStockVerified = isStockUpdateRequested && Math.abs(live.stock - targetStock) <= 0.05;
      }
      if (isLivePriceVerified && (!isStockUpdateRequested || usedStockPreservedFallback || isLiveStockVerified)) break;
      if (binanceRateLimitedUntil > Date.now()) break;
    }

    // KASUS A: Binance berhasil menerima request (updateSucceeded === true)
    if (updateSucceeded) {
      if (isLivePriceVerified) {
        if (isLiveStockVerified || (!isStockUpdateRequested && !usedStockPreservedFallback)) {
          return {
            ok: true,
            code: "000000",
            message: `Iklan #${targetAdvNo} BERHASIL & TERVERIFIKASI berubah di Binance ke Rp ${newPrice.toLocaleString("id-ID")}${isStockUpdateRequested ? ` | Stok: ${liveStockAfter ?? targetStock} USDT` : ""}!`,
            data: { livePrice: newPrice, targetPrice: newPrice, liveStock: liveStockAfter, targetStock },
            timestamp: Date.now(),
          };
        } else if (usedStockPreservedFallback) {
          return {
            ok: true,
            code: "000000",
            message: `Harga iklan #${targetAdvNo} BERHASIL terupdate ke Rp ${newPrice.toLocaleString("id-ID")}! (Stok di Binance dipertahankan: ${liveStockAfter !== null ? `${liveStockAfter} USDT` : "asli"} karena pesanan aktif mengunci kuota stok).`,
            data: { livePrice: newPrice, targetPrice: newPrice, liveStock: liveStockAfter, targetStock },
            timestamp: Date.now(),
          };
        } else {
          return {
            ok: true,
            code: "000000",
            message: `Iklan #${targetAdvNo} BERHASIL terupdate di Binance ke Rp ${newPrice.toLocaleString("id-ID")}${isStockUpdateRequested ? ` | Stok: ${targetStock} USDT` : ""}!`,
            data: { livePrice: newPrice, targetPrice: newPrice, liveStock: liveStockAfter ?? targetStock, targetStock },
            timestamp: Date.now(),
          };
        }
      }

      // Tetap kembalikan ok: true karena server Binance sudah membalas status success (000000)
      return {
        ok: true,
        code: "000000",
        message: `Pembaruan harga ke Rp ${newPrice.toLocaleString("id-ID")} berhasil diterima server Binance untuk iklan #${targetAdvNo}. (Sinkronisasi live Binance sedang berlangsung).`,
        data: { livePrice: livePriceAfter ?? newPrice, targetPrice: newPrice, liveStock: liveStockAfter, targetStock },
        timestamp: Date.now(),
      };
    }

    // KASUS B: Semua percobaan ditolak oleh Binance (updateSucceeded === false)
    const binanceDetail =
      lastError?.message ||
      lastError?.error ||
      (lastError?.code ? `Kode error Binance: ${lastError.code}` : "Server Binance menolak pembaruan (data: false)");

    return {
      ok: false,
      code: lastError?.code || "UPDATE_REJECTED",
      error: `Pembaruan iklan #${targetAdvNo} ditolak Binance: ${binanceDetail}`,
      message: `Gagal memperbarui iklan #${targetAdvNo} ke Rp ${newPrice.toLocaleString("id-ID")}: ${binanceDetail}. (Harga live saat ini di Binance: Rp ${(livePriceAfter ?? existingAd["price"] ?? 0).toLocaleString("id-ID")}).`,
      data: { livePrice: livePriceAfter, targetPrice: newPrice, liveStock: liveStockAfter, targetStock, lastError },
      timestamp: Date.now(),
    };
}

export const updateMerchantAd = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateAdInputSchema.parse(data))
  .handler(async ({ data }): Promise<MerchantApiResponse> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Sesi dashboard tidak terverifikasi.",
        message: "Sesi dashboard kedaluwarsa atau belum terautentikasi.",
      };
    }
    return updateMerchantAdInternal(data);
  });

// ── 3. Update Status Iklan (Nyalakan / Jeda) ─────────────────────────────────

const updateAdStatusInputSchema = z.object({
  sessionToken: z.string().optional(),
  advNo: z.string().min(1, "Nomor iklan (advNo) wajib diisi"),
  advStatus: z.enum(["ONLINE", "OFFLINE"]),
});

export const toggleMerchantAdStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateAdStatusInputSchema.parse(data))
  .handler(async ({ data }): Promise<MerchantApiResponse> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Sesi dashboard tidak terverifikasi.",
        message: "Sesi dashboard kedaluwarsa atau belum terautentikasi.",
      };
    }

    return toggleMerchantAdStatusInternal(data.advNo, data.advStatus);
  });

// ── 4. Buat Iklan Baru (POST /sapi/v1/c2c/ads/post) ──────────────────────────

const postAdInputSchema = z.object({
  sessionToken: z.string().optional(),
  tradeType: z.enum(["BUY", "SELL"]),
  asset: z.string().default("USDT"),
  fiatUnit: z.string().default("IDR"),
  price: z.number().positive(),
  priceType: z.number().default(1), // 1 = Fixed
  amount: z.number().positive(),
  minSingleTransAmount: z.number().positive(),
  maxSingleTransAmount: z.number().positive(),
  payMethods: z.array(z.string()).min(1, "Minimal 1 metode pembayaran"),
  remarks: z.string().optional(),
  autoReplyMsg: z.string().optional(),
});

export const postMerchantAd = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => postAdInputSchema.parse(data))
  .handler(async ({ data }): Promise<MerchantApiResponse<{ advNo: string }>> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Sesi dashboard tidak terverifikasi.",
        message: "Sesi dashboard kedaluwarsa atau belum terautentikasi.",
      };
    }

    return binanceMerchantRequest<{ advNo: string }>({
      endpoint: "/sapi/v1/c2c/ads/post",
      method: "POST",
      params: {
        tradeType: data.tradeType,
        asset: data.asset,
        fiatUnit: data.fiatUnit,
        price: Math.round(data.price),
        priceType: data.priceType,
        initAmount: Math.floor(data.amount * 100) / 100,
        amount: Math.floor(data.amount * 100) / 100,
        minSingleTransAmount: Math.round(data.minSingleTransAmount),
        maxSingleTransAmount: Math.round(data.maxSingleTransAmount),
        payMethods: JSON.stringify(data.payMethods),
        remarks: data.remarks,
        autoReplyMsg: data.autoReplyMsg,
      },
    });
  });

// ── 5. Push Harga & Stok Bot Langsung ke Iklan Binance C2C ───────────────────

const pushPriceInputSchema = z.object({
  sessionToken: z.string().optional(),
  advNo: z.string().min(1, "Nomor iklan Binance (advNo) wajib diisi"),
  side: z.enum(["buy", "sell"]),
  price: z.number().positive(),
  amountUsdt: z.number().optional(),
  maxLimitIdr: z.number().optional(),
  minLimitIdr: z.number().optional(),
  floorPrice: z.number().optional(),
  ceilingPrice: z.number().optional(),
  hasActiveOrders: z.boolean().optional(),
  priceOnly: z.boolean().optional(),
  // Diisi HANYA oleh auto-push loop: push ditolak jika tab/perangkat lain memegang lease runner.
  runnerId: z.string().min(8).optional(),
});

export type PushPriceResult = {
  ok: boolean;
  advNo: string;
  side: "buy" | "sell";
  /** Harga yang benar-benar dikirim ke Binance (setelah clamp server), bukan harga yang diminta. */
  price: number;
  requestedPrice?: number | undefined;
  amountUsdt?: number | undefined;
  maxLimitIdr?: number | undefined;
  message: string;
  error?: string | undefined;
  /** Kode hasil, mis. "000000" atau "AUTO_OFFLINED_ZERO_STOCK" (iklan di-offline-kan, harga tidak diubah). */
  code?: string | number | undefined;
  binanceCode?: string | number | undefined;
  timestamp: number;
};

export const pushPriceToBinanceAd = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => pushPriceInputSchema.parse(data))
  .handler(async ({ data }): Promise<PushPriceResult> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return {
        ok: false,
        advNo: data.advNo,
        side: data.side,
        price: data.price,
        message: "Sesi dashboard kedaluwarsa atau belum login. Silakan refresh halaman.",
        error: "UNAUTHORIZED_SESSION",
        binanceCode: "401",
        timestamp: Date.now(),
      };
    }

    if (data.runnerId) {
      const { claimBotRunnerLease } = await import("./background-bot-engine");
      const lease = await claimBotRunnerLease(data.runnerId);
      if (!lease.isLeader) {
        return {
          ok: false,
          advNo: data.advNo,
          side: data.side,
          price: data.price,
          message: `Auto-push dibatalkan: bot sedang dijalankan oleh tab/perangkat lain${lease.holder?.label ? ` (${lease.holder.label})` : ""}.`,
          error: "NOT_RUNNER_LEADER",
          code: "NOT_RUNNER_LEADER",
          timestamp: Date.now(),
        };
      }
    }

    // Sesi sudah diverifikasi di atas: panggil fungsi internal langsung (bertipe penuh).
    const res = await updateMerchantAdInternal({
      advNo: data.advNo,
      side: data.side,
      price: data.price,
      ...(data.amountUsdt !== undefined ? { amount: data.amountUsdt } : {}),
      ...(data.minLimitIdr !== undefined ? { minSingleTransAmount: data.minLimitIdr } : {}),
      ...(data.maxLimitIdr !== undefined ? { maxSingleTransAmount: data.maxLimitIdr } : {}),
      ...(data.floorPrice !== undefined ? { floorPrice: data.floorPrice } : {}),
      ...(data.ceilingPrice !== undefined ? { ceilingPrice: data.ceilingPrice } : {}),
      ...(data.hasActiveOrders !== undefined ? { hasActiveOrders: data.hasActiveOrders } : {}),
      ...(data.priceOnly !== undefined ? { priceOnly: data.priceOnly } : {}),
    });

    const now = Date.now();
    if (!res.ok) {
      return {
        ok: false,
        advNo: data.advNo,
        side: data.side,
        price: data.price,
        amountUsdt: data.amountUsdt,
        maxLimitIdr: data.maxLimitIdr,
        message: res.message || "Gagal mengubah iklan di Binance C2C",
        error: res.error,
        code: res.code,
        binanceCode: res.code,
        timestamp: now,
      };
    }

    // Iklan di-offline-kan (stok/kas 0): harga TIDAK diubah, teruskan pesan server apa adanya.
    if (typeof res.code === "string" && res.code.startsWith("AUTO_OFFLINED")) {
      return {
        ok: true,
        advNo: data.advNo,
        side: data.side,
        price: data.price,
        message: res.message || `Iklan #${data.advNo} di-OFFLINE-kan.`,
        code: res.code,
        timestamp: now,
      };
    }

    // Server bisa mengubah harga lewat clamp floor/ceiling/bound: laporkan harga yang benar-benar dikirim.
    const resData = (res.data ?? {}) as { targetPrice?: number };
    const sentPrice =
      typeof resData.targetPrice === "number" && resData.targetPrice > 0 ? resData.targetPrice : Math.round(data.price);
    const clampedNote =
      sentPrice !== Math.round(data.price)
        ? ` (diminta Rp ${Math.round(data.price).toLocaleString("id-ID")}, disesuaikan batas pengaman server)`
        : "";

    return {
      ok: true,
      advNo: data.advNo,
      side: data.side,
      price: sentPrice,
      requestedPrice: data.price,
      amountUsdt: data.amountUsdt,
      maxLimitIdr: data.maxLimitIdr,
      message: `${res.message || `Iklan #${data.advNo} berhasil diupdate ke Rp ${sentPrice.toLocaleString("id-ID")}`}${clampedNote}`,
      code: res.code,
      timestamp: now,
    };
  });

const adDetailInputSchema = z.object({
  sessionToken: z.string().optional(),
  advNo: z.string().min(1, "Nomor iklan (advNo) wajib diisi"),
});

export const getMerchantAdDetail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => adDetailInputSchema.parse(data))
  .handler(async ({ data }): Promise<MerchantApiResponse<Record<string, unknown>>> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Sesi dashboard tidak terverifikasi.",
        message: "Sesi dashboard kedaluwarsa atau belum login.",
      };
    }

    const cleanAdvNo = data.advNo.trim().replace(/^#/, "");
    const ad = await fetchAdDetailRobustly(cleanAdvNo);
    if (!ad) {
      return {
        ok: false,
        code: "ADV_NOT_FOUND",
        error: `Iklan #${cleanAdvNo} tidak ditemukan di akun Binance Anda.`,
        message: `Iklan #${cleanAdvNo} tidak ditemukan. Pastikan nomor advNo benar.`,
      };
    }

    return {
      ok: true,
      code: "000000",
      data: ad,
      message: "Sukses mengambil data iklan dari Binance",
    };
  });

// ── 5. Auto-Verify Additional KYC (Liveness) Khusus Order SELL ──────────────

/**
 * Deduplikasi state in-memory: menyimpan orderNumber yang sudah sukses di-verify
 * agar tidak mengirim request berulang ke Binance SAPI.
 */
// Di globalThis agar konsisten walau modul dimuat lebih dari sekali (chunk server function terpisah).
const kycGlobal = globalThis as typeof globalThis & {
  __p2pVerifiedKycOrders?: Set<string>;
  __p2pAutoVerifyStatus?: Map<string, AutoVerifyStatus>;
};
const verifiedKycOrdersSet: Set<string> = (kycGlobal.__p2pVerifiedKycOrders ??= new Set<string>());

export function isOrderKycVerified(orderNumber: string): boolean {
  return verifiedKycOrdersSet.has(orderNumber.trim());
}

export function markOrderKycVerified(orderNumber: string): void {
  if (orderNumber) verifiedKycOrdersSet.add(orderNumber.trim());
}

export function unmarkOrderKycVerified(orderNumber: string): void {
  if (!orderNumber) return;
  verifiedKycOrdersSet.delete(orderNumber.trim());
  autoVerifyStatusMap.delete(orderNumber.trim());
}

export function getVerifiedKycOrdersSet(): Set<string> {
  return new Set(verifiedKycOrdersSet);
}

/**
 * Mengambil detail satu pesanan spesifik via SAPI:
 * GET /sapi/v1/c2c/orderMatch/getUserOrderDetail?adOrderNo=<orderNumber>
 */
export async function getUserOrderDetail(
  orderNumber: string
): Promise<MerchantApiResponse<Record<string, unknown>>> {
  const cleanNo = orderNumber.trim();
  if (!cleanNo) {
    return { ok: false, code: "INVALID_PARAM", message: "Nomor order tidak boleh kosong" };
  }

  // 1. Coba POST ke /sapi/v1/c2c/orderMatch/getUserOrderDetail dengan orderNumber (Rekomendasi Utama SAPI)
  try {
    const resPost = await binanceMerchantRequest<Record<string, unknown>>({
      endpoint: "/sapi/v1/c2c/orderMatch/getUserOrderDetail",
      method: "POST",
      params: { orderNumber: cleanNo },
    });
    if (resPost.ok && resPost.data && (resPost.code === "000000" || resPost.code === "0" || !resPost.code)) {
      return resPost;
    }
  } catch {}

  // 2. Coba GET ke /sapi/v1/c2c/orderMatch/getUserOrderDetail dengan orderNumber
  try {
    const resGet = await binanceMerchantRequest<Record<string, unknown>>({
      endpoint: "/sapi/v1/c2c/orderMatch/getUserOrderDetail",
      method: "GET",
      params: { orderNumber: cleanNo },
    });
    if (resGet.ok && resGet.data && (resGet.code === "000000" || resGet.code === "0" || !resGet.code)) {
      return resGet;
    }
  } catch {}

  // 3. Fallback: Coba POST ke /sapi/v1/c2c/agent/orderMatch/getUserOrderDetail
  try {
    const resAgent = await binanceAgentRequest<Record<string, unknown>>({
      endpoint: "/sapi/v1/c2c/agent/orderMatch/getUserOrderDetail",
      method: "POST",
      queryParams: { orderNumber: cleanNo },
      body: { orderNumber: cleanNo },
    });
    if (resAgent.ok && resAgent.data) {
      return resAgent;
    }
  } catch {}

  // 4. Fallback dengan adOrderNo jika orderNumber adalah adOrderNo
  return await binanceMerchantRequest<Record<string, unknown>>({
    endpoint: "/sapi/v1/c2c/orderMatch/getUserOrderDetail",
    method: "GET",
    params: { adOrderNo: cleanNo },
  });
}

/**
 * Endpoint Wrapper: Menyetujui Additional KYC (Liveness) untuk membuka Payment Details.
 *
 * KRITIKAL:
 * - Fungsi ini MURNI HANYA memanggil verifiedAdditionalKyc untuk membuka detail rekening ke buyer.
 * - DILARANG KERAS memanggil releaseCoin (tidak ada rilis kripto di sini).
 *
 * Jalur SAPI:
 *   POST /sapi/v1/c2c/orderMatch/verifiedAdditionalKyc
 *   Query params signed: timestamp, recvWindow, signature
 *   JSON body: {"orderNumber": "<orderNumber>"}
 */
export async function verifiedAdditionalKyc(
  orderNumber: string
): Promise<MerchantApiResponse<{ success?: boolean }>> {
  const cleanOrderNo = orderNumber.trim();
  if (!cleanOrderNo) {
    return {
      ok: false,
      code: "INVALID_ORDER_NO",
      message: "Nomor order tidak valid",
    };
  }

  // 1. SAPI POST dengan JSON body {"orderNumber": cleanOrderNo} dan queryParams (Rekomendasi Resmi Binance SAPI)
  try {
    const res1 = await binanceAgentRequest<{ success?: boolean }>({
      endpoint: "/sapi/v1/c2c/orderMatch/verifiedAdditionalKyc",
      method: "POST",
      queryParams: { orderNumber: cleanOrderNo },
      body: { orderNumber: cleanOrderNo },
    });

    if (res1.ok && (res1.code === "000000" || res1.code === "0" || res1.data?.success !== false)) {
      return res1;
    }

    // 2. Fallback: SAPI POST dengan JSON body {"adOrderNo": cleanOrderNo, "orderNumber": cleanOrderNo}
    const res2 = await binanceAgentRequest<{ success?: boolean }>({
      endpoint: "/sapi/v1/c2c/orderMatch/verifiedAdditionalKyc",
      method: "POST",
      queryParams: { adOrderNo: cleanOrderNo, orderNumber: cleanOrderNo },
      body: { adOrderNo: cleanOrderNo, orderNumber: cleanOrderNo },
    });

    if (res2.ok && (res2.code === "000000" || res2.code === "0")) {
      return res2;
    }

    // 3. Fallback: SAPI POST dengan form urlencoded / query string
    const res3 = await binanceMerchantRequest<{ success?: boolean }>({
      endpoint: "/sapi/v1/c2c/orderMatch/verifiedAdditionalKyc",
      method: "POST",
      params: { orderNumber: cleanOrderNo, adOrderNo: cleanOrderNo },
    });

    if (res3.ok && (res3.code === "000000" || res3.code === "0")) {
      return res3;
    }

    // 4. Fallback: Web BAPI endpoint (jika proxy/BAPI digunakan)
    try {
      const res4 = await binanceMerchantRequest<{ success?: boolean }>({
        endpoint: "/bapi/c2c/v2/private/c2c/order-match/verified-additional-kyc",
        method: "POST",
        params: { orderNumber: cleanOrderNo },
      });
      if (res4.ok) return res4;
    } catch {
      // Abaikan fallback BAPI jika gagal
    }

    return res1.error ? res1 : res3;
  } catch (err) {
    return {
      ok: false,
      code: "EXCEPTION",
      error: String(err),
      message: `Gagal verifikasi additional KYC: ${String(err)}`,
    };
  }
}

/**
 * Status percobaan auto-verify per order (per instance server), ditampilkan di panel verifier
 * agar merchant bisa melihat kenapa sebuah order belum/sudah dibuka payment details-nya.
 */
export type AutoVerifyStatus = {
  state: "verified" | "waiting" | "failed" | "skipped";
  message: string;
  attempts: number;
  lastAt: number;
  nextRetryAt?: number;
};

const autoVerifyStatusMap: Map<string, AutoVerifyStatus> = (kycGlobal.__p2pAutoVerifyStatus ??= new Map());

export function getAutoVerifyStatus(orderNumber: string): AutoVerifyStatus | undefined {
  return autoVerifyStatusMap.get(orderNumber.trim());
}

function setAutoVerifyStatus(orderNumber: string, patch: Omit<AutoVerifyStatus, "attempts" | "lastAt"> & { attempts?: number }) {
  const prev = autoVerifyStatusMap.get(orderNumber);
  autoVerifyStatusMap.set(orderNumber, {
    attempts: patch.attempts ?? prev?.attempts ?? 0,
    lastAt: Date.now(),
    state: patch.state,
    message: patch.message,
    ...(patch.nextRetryAt !== undefined ? { nextRetryAt: patch.nextRetryAt } : {}),
  });
}

/** Jeda retry setelah Binance menolak verifiedAdditionalKyc: 15s, 30s, 60s, lalu maks 120s. */
function autoVerifyRetryDelayMs(failedAttempts: number): number {
  return Math.min(120_000, 15_000 * 2 ** Math.max(0, failedAttempts - 1));
}

const AUTO_VERIFY_CANCELLED = (s: string) =>
  s.includes("CANCEL") || s.includes("BATAL") || s.includes("CLOSE") || s === "5" || s === "6";
const AUTO_VERIFY_COMPLETED = (s: string) =>
  s.includes("COMPLET") || s.includes("SUCCESS") || s.includes("FINISH") || s === "4";

/**
 * Logika Eksekusi Auto-Verify Khusus Order SELL.
 *
 * Endpoint verifiedAdditionalKyc adalah tombol "setujui" milik merchant: Binance TIDAK memeriksa
 * apakah buyer benar-benar sudah lolos liveness. Karena itu jalur otomatis WAJIB memenuhi semua:
 *  1. Order SELL milik merchant, masih aktif (bukan batal/selesai).
 *  2. Binance menandai order butuh verifikasi tambahan & belum diverifikasi (additionalKycVerify === 1).
 *     Nilai resmi: 0 = tidak wajib, 1 = belum diverifikasi, 2 = sudah diverifikasi.
 *  3. Ada bukti liveness selesai dari sumber tepercaya (kartu sistem chat Binance / webhook ber-secret),
 *     ditandai pemanggil dengan livenessCompleted === true.
 *  4. Tidak dalam jeda retry setelah penolakan Binance (backoff 15s → 120s).
 * Jalur manual (manual === true, tombol merchant) melewati syarat 2–4 tetapi tetap menolak order
 * yang jelas bukan SELL atau sudah tidak aktif.
 * DILARANG KERAS memanggil releaseCoin di sini.
 */
export async function executeAutoVerifyForSellOrder(params: {
  orderNumber: string;
  tradeType?: string;
  orderStatus?: string | number;
  additionalKycVerify?: number | boolean | undefined;
  livenessCompleted?: boolean;
  /** Aksi eksplisit merchant (tombol). */
  manual?: boolean;
  /** @deprecated alias lama untuk `manual`. */
  force?: boolean;
}): Promise<{ ok: boolean; message: string; skipped?: boolean; verified?: boolean }> {
  const cleanOrderNo = params.orderNumber.trim();
  if (!cleanOrderNo) {
    return { ok: false, message: "Nomor order kosong." };
  }
  const manual = params.manual === true || params.force === true;

  // 1. Deduplikasi: sudah sukses diverifikasi sebelumnya
  if (verifiedKycOrdersSet.has(cleanOrderNo)) {
    return {
      ok: true,
      skipped: true,
      verified: true,
      message: `Order SELL #${cleanOrderNo} sudah diverifikasi sebelumnya.`,
    };
  }

  // 2. Jeda retry setelah penolakan Binance (hanya jalur otomatis)
  const prevStatus = autoVerifyStatusMap.get(cleanOrderNo);
  if (!manual && prevStatus?.nextRetryAt && Date.now() < prevStatus.nextRetryAt) {
    return {
      ok: false,
      skipped: true,
      verified: false,
      message: `Order SELL #${cleanOrderNo} menunggu jeda retry (${Math.ceil((prevStatus.nextRetryAt - Date.now()) / 1000)}s).`,
    };
  }

  // 3. Lengkapi data order dari Binance bila belum diketahui
  let tradeType = (params.tradeType || "").toUpperCase();
  let statusStr = String(params.orderStatus ?? "").toUpperCase();
  let additionalKyc: number | undefined =
    params.additionalKycVerify === undefined ? undefined : Number(params.additionalKycVerify);

  if (!tradeType || !statusStr || additionalKyc === undefined || Number.isNaN(additionalKyc)) {
    try {
      const detailRes = await getUserOrderDetail(cleanOrderNo);
      if (detailRes.ok && detailRes.data) {
        const d = (detailRes.data["data"] || detailRes.data) as Record<string, unknown>;
        if (!tradeType && d["tradeType"]) tradeType = String(d["tradeType"]).toUpperCase();
        if (!statusStr && d["orderStatus"] !== undefined) statusStr = String(d["orderStatus"]).toUpperCase();
        if ((additionalKyc === undefined || Number.isNaN(additionalKyc)) && d["additionalKycVerify"] !== undefined) {
          additionalKyc = Number(d["additionalKycVerify"]);
        }
      }
    } catch {
      // Lanjutkan dengan data yang ada
    }
  }

  // 4. Binance sudah menandai terverifikasi: tidak perlu memanggil API lagi
  if (additionalKyc === 2) {
    verifiedKycOrdersSet.add(cleanOrderNo);
    setAutoVerifyStatus(cleanOrderNo, { state: "verified", message: "Binance: additional KYC sudah terverifikasi." });
    return { ok: true, skipped: true, verified: true, message: `Order #${cleanOrderNo} sudah terverifikasi di Binance.` };
  }

  const hold = (message: string) => {
    setAutoVerifyStatus(cleanOrderNo, { state: "waiting", message });
    return { ok: false, skipped: true, verified: false, message };
  };
  const reject = (message: string) => {
    setAutoVerifyStatus(cleanOrderNo, { state: "skipped", message });
    return { ok: false, skipped: true, verified: false, message };
  };

  // KEAMANAN 1: HANYA order SELL (jalur otomatis menolak jika jenis order tidak diketahui)
  if (tradeType && tradeType !== "SELL") {
    return reject(`[KEAMANAN] Order #${cleanOrderNo} bukan order SELL (${tradeType}).`);
  }
  if (!tradeType && !manual) {
    return hold(`Jenis order #${cleanOrderNo} belum bisa dipastikan dari Binance. Auto-verify ditahan.`);
  }

  // KEAMANAN 2: order masih aktif
  if (AUTO_VERIFY_CANCELLED(statusStr) || AUTO_VERIFY_COMPLETED(statusStr)) {
    return reject(`[KEAMANAN] Order #${cleanOrderNo} berstatus ${statusStr}. Auto-verify dibatalkan karena order sudah tidak aktif.`);
  }

  if (!manual) {
    // KEAMANAN 3: Binance harus menandai order butuh verifikasi tambahan yang belum disetujui
    if (additionalKyc === 0) {
      return reject(`Order #${cleanOrderNo} tidak membutuhkan verifikasi tambahan (additionalKycVerify = 0).`);
    }
    if (additionalKyc !== 1) {
      return hold(`Status additional KYC order #${cleanOrderNo} belum diketahui dari Binance. Auto-verify ditahan.`);
    }

    // KEAMANAN 4 (CRITICAL): bukti liveness selesai dari sumber tepercaya
    if (params.livenessCompleted !== true) {
      return hold(`Menunggu buyer menyelesaikan liveness check (kartu "Completed" dari Binance).`);
    }
  }

  // 5. Eksekusi verifiedAdditionalKyc (TIDAK ADA RELEASE COIN!)
  try {
    const res = await verifiedAdditionalKyc(cleanOrderNo);

    if (res.ok && (res.code === "000000" || res.code === "0" || res.data?.success !== false)) {
      verifiedKycOrdersSet.add(cleanOrderNo);
      setAutoVerifyStatus(cleanOrderNo, {
        state: "verified",
        message: "Payment details berhasil dibuka ke buyer.",
        attempts: (prevStatus?.attempts ?? 0) + 1,
      });
      console.log(`[AUTO-VERIFY] Order SELL ${cleanOrderNo} berhasil diverifikasi. Payment details telah dibuka ke buyer.`);
      return {
        ok: true,
        verified: true,
        message: `[AUTO-VERIFY] Order SELL ${cleanOrderNo} berhasil diverifikasi. Payment details telah dibuka ke buyer.`,
      };
    }

    const attempts = (prevStatus?.attempts ?? 0) + 1;
    const errMsg = res.message || res.error || "Binance menolak verifikasi";
    const nextRetryAt = Date.now() + autoVerifyRetryDelayMs(attempts);
    setAutoVerifyStatus(cleanOrderNo, {
      state: "failed",
      message: `Binance menolak (kode ${res.code ?? "?"}): ${errMsg}`,
      attempts,
      nextRetryAt,
    });
    console.warn(`[AUTO-VERIFY] Order SELL ${cleanOrderNo} ditolak Binance (percobaan ${attempts}): ${errMsg} (code: ${res.code})`);
    return { ok: false, verified: false, message: errMsg };
  } catch (err) {
    const attempts = (prevStatus?.attempts ?? 0) + 1;
    setAutoVerifyStatus(cleanOrderNo, {
      state: "failed",
      message: `Exception: ${String(err)}`,
      attempts,
      nextRetryAt: Date.now() + autoVerifyRetryDelayMs(attempts),
    });
    return { ok: false, verified: false, message: `Exception: ${String(err)}` };
  }
}

// ── Server Function: Auto-Verify Additional KYC dari Frontend Dashboard ────
const verifyAdditionalKycInputSchema = z.object({
  sessionToken: z.string().optional(),
  orderNumber: z.string().min(1, "Nomor order wajib diisi"),
  force: z.boolean().optional(),
});

export const verifyAdditionalKycOrder = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifyAdditionalKycInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; message: string; orderNumber: string }> => {
    try {
      await requireSession(data.sessionToken);
    } catch {
      return {
        ok: false,
        orderNumber: data.orderNumber,
        message: "Sesi dashboard kedaluwarsa atau belum login.",
      };
    }

    // Tombol merchant: aksi manual eksplisit
    const res = await executeAutoVerifyForSellOrder({
      orderNumber: data.orderNumber,
      manual: data.force ?? true,
    });

    return {
      ok: res.ok,
      orderNumber: data.orderNumber,
      message: res.message,
    };
  });


