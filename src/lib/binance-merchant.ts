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

  const baseUrl =
    process.env["BINANCE_C2C_BASE_URL"] ||
    process.env["BINANCE_API_BASE_URL"] ||
    process.env["BINANCE_PROXY_URL"] ||
    DEFAULT_BINANCE_API_URL;

  const timestamp = Date.now();
  const cleanParams: Record<string, string | number> = {
    timestamp,
    recvWindow: 10_000,
  };

  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null && v !== "") {
        cleanParams[k] = typeof v === "boolean" ? String(v) : v;
      }
    }
  }

  // Buat query string dan HMAC-SHA256 signature
  const qs = Object.entries(cleanParams)
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

    // Jika POST via body gagal dengan code -1000 atau respons non-OK, coba fallback dengan query string di URL
    if (isPost && (!resp.ok || json["code"] === "-1000" || json["code"] === -1000)) {
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
async function fetchAdDetailRobustly(
  advNo: string,
  targetSide?: "buy" | "sell",
  credentials?: { apiKeyOverride?: string; apiSecretOverride?: string }
): Promise<Record<string, unknown> | null> {
  const cleanAdvNo = advNo.trim().replace(/^#/, "");

  // Jalur 1: POST /sapi/v1/c2c/agent/ads/getDetailByNo dengan query param advNo
  try {
    const res1 = await binanceAgentRequest<Record<string, unknown>>({
      endpoint: "/sapi/v1/c2c/agent/ads/getDetailByNo",
      method: "POST",
      queryParams: { advNo: cleanAdvNo },
      body: {},
      ...credentials,
    });
    if (res1.ok && res1.data && typeof res1.data === "object" && !Array.isArray(res1.data)) {
      return res1.data;
    }
  } catch {
    // Lanjut ke jalur berikutnya
  }

  // Jalur 2: POST /sapi/v1/c2c/agent/ads/getDetailByNo dengan JSON body { advNo }
  try {
    const res2 = await binanceAgentRequest<Record<string, unknown>>({
      endpoint: "/sapi/v1/c2c/agent/ads/getDetailByNo",
      method: "POST",
      body: { advNo: cleanAdvNo },
      ...credentials,
    });
    if (res2.ok && res2.data && typeof res2.data === "object" && !Array.isArray(res2.data)) {
      return res2.data;
    }
  } catch {
    // Lanjut ke jalur berikutnya
  }

  // Jalur 3: GET /sapi/v1/c2c/agent/ads/getDetailByNo?advNo=...
  try {
    const res3 = await binanceAgentRequest<Record<string, unknown>>({
      endpoint: "/sapi/v1/c2c/agent/ads/getDetailByNo",
      method: "GET",
      queryParams: { advNo: cleanAdvNo },
      ...credentials,
    });
    if (res3.ok && res3.data && typeof res3.data === "object" && !Array.isArray(res3.data)) {
      return res3.data;
    }
  } catch {
    // Lanjut ke jalur berikutnya
  }

  // Jalur 4: POST /sapi/v1/c2c/agent/ads/listWithPagination (cari iklan di daftar akun)
  try {
    const res4 = await binanceAgentRequest<{ data?: unknown[]; total?: number } | unknown[]>({
      endpoint: "/sapi/v1/c2c/agent/ads/listWithPagination",
      method: "POST",
      body: { page: 1, rows: 50 },
      ...credentials,
    });
    if (res4.ok && res4.data) {
      const list = Array.isArray(res4.data)
        ? res4.data
        : Array.isArray((res4.data as Record<string, unknown>)["data"])
        ? ((res4.data as Record<string, unknown>)["data"] as unknown[])
        : [];

      // Cari berdasarkan advNo yang cocok
      const found = list.find(
        (item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          String((item as Record<string, unknown>)["advNo"] || "").trim().replace(/^#/, "") === cleanAdvNo
      );
      if (found) return found as Record<string, unknown>;

      // Jika advNo tidak cocok persis, auto-detect iklan aktif berdasarkan side (BUY / SELL)
      if (targetSide) {
        const sideMatched = list.find((item: unknown) => {
          if (!item || typeof item !== "object") return false;
          const raw = item as Record<string, unknown>;
          const tt = String(raw["tradeType"] || "").toUpperCase();
          if (targetSide === "buy") {
            return tt === "BUY" || raw["tradeType"] === 0 || raw["tradeType"] === "0";
          } else {
            return tt === "SELL" || raw["tradeType"] === 1 || raw["tradeType"] === "1";
          }
        });
        if (sideMatched) return sideMatched as Record<string, unknown>;
      }
    }
  } catch {
    // Lanjut ke jalur berikutnya
  }

  // Jalur 5: GET /sapi/v1/c2c/ads/list
  try {
    const res5 = await binanceMerchantRequest<Record<string, unknown>[]>({
      endpoint: "/sapi/v1/c2c/ads/list",
      method: "GET",
      params: { page: 1, rows: 50 },
      ...credentials,
    });
    if (res5.ok && Array.isArray(res5.data)) {
      const found = res5.data.find(
        (item) => item && typeof item === "object" && String(item["advNo"] || "").trim().replace(/^#/, "") === cleanAdvNo
      );
      if (found) return found;

      if (targetSide) {
        const sideMatched = res5.data.find((item) => {
          if (!item || typeof item !== "object") return false;
          const tt = String(item["tradeType"] || "").toUpperCase();
          return targetSide === "buy" ? (tt === "BUY" || item["tradeType"] === 0) : (tt === "SELL" || item["tradeType"] === 1);
        });
        if (sideMatched) return sideMatched;
      }
    }
  } catch {
    // Lanjut ke jalur berikutnya
  }

  // Jalur 6: GET /sapi/v1/c2c/orderMatch/getUserAdvList
  try {
    const res6 = await binanceMerchantRequest<Record<string, unknown>[]>({
      endpoint: "/sapi/v1/c2c/orderMatch/getUserAdvList",
      method: "GET",
      params: { page: 1, rows: 50 },
      ...credentials,
    });
    if (res6.ok && Array.isArray(res6.data)) {
      const found = res6.data.find(
        (item) => item && typeof item === "object" && String(item["advNo"] || "").trim().replace(/^#/, "") === cleanAdvNo
      );
      if (found) return found;
    }
  } catch {
    // Selesai
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
  payMethods: z.array(z.string()).optional(),
});

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

    const cleanAdvNo = data.advNo.trim().replace(/^#/, "");
    const newPrice = Math.round(data.price);

    // =========================================================================
    // PROTOKOL UTAMA: Binance P2P Skill Agent SAPI (Full-Object Update)
    // Sesuai dokumentasi https://www.binance.com/en/skills/detail/binance/p2p
    // Step 1: Ambil data iklan utuh via fetchAdDetailRobustly
    // Step 2: Merge perubahan ke objek utuh (direct response merge)
    // Step 3: Kirim update via POST /sapi/v1/c2c/agent/ads/update (JSON body)
    // Step 4: Verifikasi live status langsung di Binance
    // =========================================================================

    const existingAd = await fetchAdDetailRobustly(cleanAdvNo, "buy");

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

    // Tentukan tradeType: 0 = BUY, 1 = SELL
    let isBuy = true;
    const tt = existingAd["tradeType"];
    if (tt === "SELL" || tt === 1 || tt === "1") {
      isBuy = false;
    }

    // Hitung initAmount (stok USDT)
    let initAmount: number = Math.floor(Number(existingAd["initAmount"] ?? existingAd["amount"] ?? existingAd["surplusAmount"] ?? 100) * 100) / 100;
    if (data.amount && data.amount > 0) {
      initAmount = Math.floor(data.amount * 100) / 100;
    }

    // Hitung limit transaksi min & max IDR
    let minLimit = data.minSingleTransAmount && data.minSingleTransAmount > 0
      ? Math.round(data.minSingleTransAmount)
      : existingAd["minSingleTransAmount"]
      ? Math.round(Number(existingAd["minSingleTransAmount"]))
      : 50000;

    let maxLimit = data.maxSingleTransAmount && data.maxSingleTransAmount > 0
      ? Math.round(data.maxSingleTransAmount)
      : existingAd["maxSingleTransAmount"]
      ? Math.round(Number(existingAd["maxSingleTransAmount"]))
      : Math.floor(initAmount * newPrice);

    // VALIDASI KRUSIAL BINANCE:
    // maxSingleTransAmount TIDAK BOLEH melebihi total kapasitas fiat iklan (initAmount * price)!
    const fiatCap = Math.floor(initAmount * newPrice);
    if (maxLimit > fiatCap) {
      maxLimit = fiatCap;
    }
    if (minLimit > maxLimit) {
      minLimit = Math.min(minLimit, maxLimit);
    }

    let lastError: MerchantApiResponse | null = null;
    let updateSucceeded = false;

    // Sanitasi tradeMethods sesuai spesifikasi resmi Binance Agent SAPI:
    // "For BUY ads, use identifier from system trade methods."
    // "For SELL ads, use payId in tradeMethods."
    const sanitizedTradeMethods = Array.isArray(existingAd["tradeMethods"])
      ? existingAd["tradeMethods"]
          .map((m: any) => {
            if (isBuy) {
              const id = m?.identifier || m?.tradeMethodName;
              return id ? { identifier: String(id) } : null;
            } else {
              return m?.payId
                ? { payId: Number(m.payId) }
                : m?.identifier
                ? { identifier: String(m.identifier) }
                : null;
            }
          })
          .filter(Boolean)
      : undefined;

    // Payload bersih standar Agent SAPI DTO (tanpa field read-only tak dikenal seperti surplusAmount, createTime)
    const basePayload: Record<string, any> = {
      advNo: targetAdvNo,
      tradeType: isBuy ? "0" : "1",
      asset: String(existingAd["asset"] || "USDT"),
      fiatUnit: String(existingAd["fiatUnit"] || "IDR"),
      priceType: Number(existingAd["priceType"] || 1),
      price: newPrice,
      initAmount,
      minSingleTransAmount: minLimit,
      maxSingleTransAmount: maxLimit,
    };
    if (sanitizedTradeMethods && sanitizedTradeMethods.length > 0) {
      basePayload.tradeMethods = sanitizedTradeMethods;
    }
    if (existingAd["payTimeLimit"]) basePayload.payTimeLimit = Number(existingAd["payTimeLimit"]);
    if (existingAd["remarks"]) basePayload.remarks = String(existingAd["remarks"]);
    if (existingAd["autoReplyMsg"]) basePayload.autoReplyMsg = String(existingAd["autoReplyMsg"]);
    if (existingAd["advStatus"] !== undefined) basePayload.advStatus = Number(existingAd["advStatus"]);
    if (existingAd["buyerKycLimit"] !== undefined) basePayload.buyerKycLimit = Number(existingAd["buyerKycLimit"]);
    if (existingAd["takerAdditionalKycRequired"] !== undefined) {
      basePayload.takerAdditionalKycRequired = Number(existingAd["takerAdditionalKycRequired"]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERCOBAAN 1: Standar Agent SAPI DTO (tradeType: "0" / "1" String)
    // Sesuai dokumentasi resmi: https://www.binance.com/en/skills/detail/binance/p2p
    // ─────────────────────────────────────────────────────────────────────────
    const res1 = await binanceAgentRequest({
      endpoint: "/sapi/v1/c2c/agent/ads/update",
      method: "POST",
      body: basePayload,
    });

    if (res1.ok && res1.data !== false) {
      updateSucceeded = true;
    } else {
      lastError = res1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERCOBAAN 2: SAMA TAPI DENGAN tradeType NUMERIK (0 / 1)
    // ─────────────────────────────────────────────────────────────────────────
    if (!updateSucceeded) {
      const res2 = await binanceAgentRequest({
        endpoint: "/sapi/v1/c2c/agent/ads/update",
        method: "POST",
        body: { ...basePayload, tradeType: isBuy ? 0 : 1 },
      });
      if (res2.ok && res2.data !== false) {
        updateSucceeded = true;
      } else {
        lastError = res2;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERCOBAAN 3: MEMPERTAHANKAN LIMIT & STOK ASLI DARI IKLAN (HANYA UBAH HARGA)
    // Seringkali Binance menolak modifikasi initAmount atau maxLimit jika ada pesanan aktif atau saldo terkunci.
    // Mempertahankan amount & limit asli iklan membiarkan perubahan harga berhasil!
    // ─────────────────────────────────────────────────────────────────────────
    if (!updateSucceeded) {
      const origAmount = Number(existingAd["initAmount"] ?? existingAd["amount"] ?? existingAd["surplusAmount"] ?? 100);
      const origMin = existingAd["minSingleTransAmount"] ? Number(existingAd["minSingleTransAmount"]) : 50000;
      const origMax = existingAd["maxSingleTransAmount"] ? Number(existingAd["maxSingleTransAmount"]) : Math.floor(origAmount * newPrice);

      const pricePreservedPayload = {
        ...basePayload,
        initAmount: origAmount,
        minSingleTransAmount: origMin,
        maxSingleTransAmount: Math.min(origMax, Math.floor(origAmount * newPrice)),
      };

      const res3 = await binanceAgentRequest({
        endpoint: "/sapi/v1/c2c/agent/ads/update",
        method: "POST",
        body: pricePreservedPayload,
      });
      if (res3.ok && res3.data !== false) {
        updateSucceeded = true;
      } else {
        lastError = res3;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERCOBAAN 4: DIRECT RESPONSE MERGE (Rekomendasi Resmi Binance Skill Hub)
    // ─────────────────────────────────────────────────────────────────────────
    if (!updateSucceeded) {
      const directMerged = {
        ...existingAd,
        advNo: targetAdvNo,
        price: newPrice,
        initAmount,
        minSingleTransAmount: minLimit,
        maxSingleTransAmount: maxLimit,
      };

      const res4 = await binanceAgentRequest({
        endpoint: "/sapi/v1/c2c/agent/ads/update",
        method: "POST",
        body: directMerged,
      });
      if (res4.ok && res4.data !== false) {
        updateSucceeded = true;
      } else {
        lastError = res4;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERCOBAAN 5: STANDARD SAPI (/sapi/v1/c2c/ads/update) - URL-Encoded Params
    // ─────────────────────────────────────────────────────────────────────────
    if (!updateSucceeded) {
      const legacyRes = await binanceMerchantRequest({
        endpoint: "/sapi/v1/c2c/ads/update",
        method: "POST",
        params: {
          advNo: targetAdvNo,
          price: newPrice,
          priceType: 1,
        },
      });
      if (legacyRes.ok && legacyRes.data !== false) {
        updateSucceeded = true;
      } else {
        lastError = legacyRes;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PERCOBAAN 6: STANDARD SAPI (/sapi/v1/c2c/ad/update - Singular)
    // ─────────────────────────────────────────────────────────────────────────
    if (!updateSucceeded) {
      const singularRes = await binanceMerchantRequest({
        endpoint: "/sapi/v1/c2c/ad/update",
        method: "POST",
        params: {
          advNo: targetAdvNo,
          price: newPrice,
        },
      });
      if (singularRes.ok && singularRes.data !== false) {
        updateSucceeded = true;
      } else {
        lastError = singularRes;
      }
    }

    // =========================================================================
    // POST-UPDATE VERIFIKASI LANGSUNG KE BINANCE
    // =========================================================================
    let isLivePriceVerified = false;
    let livePriceAfter: number | null = null;
    try {
      await new Promise((r) => setTimeout(r, 1000)); // Beri jeda 1000ms agar database Binance sinkron
      const verifyAd = await fetchAdDetailRobustly(targetAdvNo);
      if (verifyAd && verifyAd["price"] !== undefined && verifyAd["price"] !== null) {
        livePriceAfter = Math.round(Number(verifyAd["price"]));
        if (livePriceAfter === newPrice) {
          isLivePriceVerified = true;
        }
      }
    } catch {
      // Abaikan error verifikasi
    }

    // Jika live price terverifikasi 100% sama dengan target price di Binance:
    if (isLivePriceVerified) {
      return {
        ok: true,
        code: "000000",
        message: `Iklan #${targetAdvNo} BERHASIL & TERVERIFIKASI berubah di Binance ke Rp ${newPrice.toLocaleString("id-ID")}!`,
        data: { livePrice: livePriceAfter, targetPrice: newPrice },
        timestamp: Date.now(),
      };
    }

    // Jika live price dicek tetapi BELUM berubah di Binance (masih harga lama):
    if (livePriceAfter !== null && livePriceAfter !== newPrice) {
      return {
        ok: false,
        code: "PRICE_NOT_REFLECTED",
        error: `Live price di Binance saat ini: Rp ${livePriceAfter.toLocaleString("id-ID")} (belum berubah ke Rp ${newPrice.toLocaleString("id-ID")}).`,
        message: `Peringatan: Server Binance merespons request, namun harga live iklan di Binance belum berubah (Harga saat ini masih Rp ${livePriceAfter.toLocaleString("id-ID")}). Kemungkinan iklan terkunci oleh pesanan aktif di Binance atau akun memerlukan status merchant verified.`,
        data: { livePrice: livePriceAfter, targetPrice: newPrice },
        timestamp: Date.now(),
      };
    }

    // Jika updateSucceeded true tetapi re-fetch getDetail gagal/timeout:
    if (updateSucceeded) {
      return {
        ok: true,
        code: "000000",
        message: `Update harga ke Rp ${newPrice.toLocaleString("id-ID")} berhasil dikirim ke Binance untuk iklan #${targetAdvNo}. Silakan periksa atau refresh aplikasi Binance Anda.`,
        data: { livePrice: livePriceAfter, targetPrice: newPrice },
        timestamp: Date.now(),
      };
    }

    // Jika semua percobaan gagal:
    return {
      ok: false,
      code: lastError?.code || "UPDATE_REJECTED",
      error: lastError?.error,
      message:
        lastError?.message ||
        `Gagal memperbarui iklan #${targetAdvNo} di Binance: server Binance menolak update (data: false). Pastikan nomor advNo benar, status iklan Online di Binance, dan izin API Key mencukupi.`,
      data: lastError?.data,
      timestamp: Date.now(),
    };
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

    const advNo = data.advNo.trim();

    // 1. Coba Agent SAPI updateStatus (1=Online, 3=Offline)
    const agentRes = await binanceAgentRequest({
      endpoint: "/sapi/v1/c2c/agent/ads/updateStatus",
      method: "POST",
      body: {
        advNos: [advNo],
        advStatus: data.advStatus === "ONLINE" ? 1 : 3,
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
        advNo,
        advStatus: data.advStatus === "ONLINE" ? 1 : 2,
        status: data.advStatus,
      },
    });
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
});

export type PushPriceResult = {
  ok: boolean;
  advNo: string;
  side: "buy" | "sell";
  price: number;
  amountUsdt?: number;
  maxLimitIdr?: number;
  message: string;
  error?: string;
  binanceCode?: string | number;
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

    const res = await updateMerchantAd({
      data: {
        sessionToken: data.sessionToken,
        advNo: data.advNo,
        price: data.price,
        amount: data.amountUsdt,
        minSingleTransAmount: data.minLimitIdr,
        maxSingleTransAmount: data.maxLimitIdr,
      },
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
        binanceCode: res.code,
        timestamp: now,
      };
    }

    const sideLabel = data.side === "buy" ? "Beli" : "Jual";
    const amountStr = data.amountUsdt ? ` | Stok: ${data.amountUsdt} USDT` : "";
    const limitStr = data.maxLimitIdr ? ` | Max Limit: Rp ${data.maxLimitIdr.toLocaleString("id-ID")}` : "";

    return {
      ok: true,
      advNo: data.advNo,
      side: data.side,
      price: data.price,
      amountUsdt: data.amountUsdt,
      maxLimitIdr: data.maxLimitIdr,
      message: `Iklan ${sideLabel} (#${data.advNo}) berhasil diupdate: Rp ${Math.round(data.price).toLocaleString("id-ID")}${amountStr}${limitStr}`,
      timestamp: now,
    };
  });
