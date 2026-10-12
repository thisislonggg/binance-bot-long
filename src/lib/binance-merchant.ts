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

    // Kode sukses Binance adalah "000000", "0", atau HTTP 200 dengan status sukses
    const code = String(json["code"] ?? (resp.ok ? "000000" : resp.status));
    const isSuccess = resp.ok && (code === "000000" || code === "0" || json["success"] === true);

    if (!isSuccess) {
      const errMsg =
        String(json["message"] || json["msg"] || json["error"] || "Gagal memproses request C2C Binance");

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
      } else if (code === "-1000" || errMsg.toLowerCase().includes("unknown error")) {
        friendlyMsg =
          "Binance C2C menolak update via API (Error -1000). Umumnya terjadi karena akun belum memiliki hak Binance P2Pro Merchant API atau nomor iklan tidak valid. Anda dapat menggunakan tombol 'Terapkan ke Form Beli' untuk memasukkan harga & stok secara instan 1-klik ke form!";
      }

      return {
        ok: false,
        code,
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
    const isSuccess =
      resp.ok &&
      (code === "000000" ||
        code === "0" ||
        json["success"] === true ||
        json["status"] === true);

    if (!isSuccess) {
      const errMsg = String(
        json["message"] || json["msg"] || json["error"] || "Gagal memproses request C2C Agent SAPI"
      );
      let friendlyMsg = errMsg;
      if (code === "-1002") {
        friendlyMsg = "Iklan tidak ditemukan atau bukan milik akun API Key Anda (-1002).";
      } else if (code === "-2015" || errMsg.includes("API-key")) {
        friendlyMsg = "API Key tidak valid, IP belum terdaftar di whitelist, atau izin C2C belum aktif (-2015).";
      } else if (code === "-1022") {
        friendlyMsg = "Signature verification failed (-1022). Pastikan Secret Key benar dan jam tersinkron.";
      } else if (code === "-9000") {
        friendlyMsg = "Parameter iklan tidak valid (-9000). Binance mengharuskan update objek lengkap (full-object).";
      }

      return {
        ok: false,
        code,
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

    const advNo = data.advNo.trim();
    const newPrice = Math.round(data.price);

    // =========================================================================
    // PROTOKOL UTAMA: Binance P2P Skill Agent SAPI (Full-Object Update)
    // Sesuai dokumentasi https://www.binance.com/en/skills/detail/binance/p2p
    // Step 1: POST /sapi/v1/c2c/agent/ads/getDetailByNo?advNo={advNo}
    // Step 2: Merge perubahan (harga, stok, max limit) ke objek iklan utuh
    // Step 3: POST /sapi/v1/c2c/agent/ads/update dengan full object JSON
    // =========================================================================

    const detailRes = await binanceAgentRequest<Record<string, unknown>>({
      endpoint: "/sapi/v1/c2c/agent/ads/getDetailByNo",
      method: "POST",
      queryParams: { advNo },
      body: { advNo },
    });

    if (detailRes.ok && detailRes.data && typeof detailRes.data === "object" && !Array.isArray(detailRes.data)) {
      const existingAd = detailRes.data;

      // Merge perubahan ke objek utuh yang dikembalikan Binance
      const mergedPayload: Record<string, unknown> = {
        ...existingAd,
        advNo,
        price: newPrice,
      };

      if (data.amount && data.amount > 0) {
        mergedPayload["initAmount"] = Math.floor(data.amount * 100) / 100;
      }
      if (data.minSingleTransAmount && data.minSingleTransAmount > 0) {
        mergedPayload["minSingleTransAmount"] = Math.round(data.minSingleTransAmount);
      }
      if (data.maxSingleTransAmount && data.maxSingleTransAmount > 0) {
        mergedPayload["maxSingleTransAmount"] = Math.round(data.maxSingleTransAmount);
      }

      // Step 3: Kirim full-object update ke Agent SAPI
      const agentUpdateRes = await binanceAgentRequest({
        endpoint: "/sapi/v1/c2c/agent/ads/update",
        method: "POST",
        body: mergedPayload,
      });

      if (agentUpdateRes.ok) {
        return {
          ok: true,
          code: "000000",
          message: `Iklan #${advNo} berhasil diupdate via Binance Agent SAPI ke Rp ${newPrice.toLocaleString("id-ID")}`,
          data: agentUpdateRes.data,
          timestamp: Date.now(),
        };
      }

      // Jika format tradeType (misal "BUY" vs 0) ditolak downstream, coba normalisasi tradeType
      if (mergedPayload["tradeType"] === "BUY" || mergedPayload["tradeType"] === "SELL") {
        const retryPayload = {
          ...mergedPayload,
          tradeType: mergedPayload["tradeType"] === "BUY" ? 0 : 1,
        };
        const retryRes = await binanceAgentRequest({
          endpoint: "/sapi/v1/c2c/agent/ads/update",
          method: "POST",
          body: retryPayload,
        });
        if (retryRes.ok) {
          return {
            ok: true,
            code: "000000",
            message: `Iklan #${advNo} berhasil diupdate via Binance Agent SAPI ke Rp ${newPrice.toLocaleString("id-ID")}`,
            data: retryRes.data,
            timestamp: Date.now(),
          };
        }
      }

      // Coba juga payload terfilter hanya field valid update (membersihkan field read-only seperti surplusAmount)
      const allowedUpdateKeys = [
        "advNo", "tradeType", "asset", "fiatUnit", "priceType",
        "priceFloatingRatio", "rateFloatingRatio", "price", "initAmount",
        "maxSingleTransAmount", "minSingleTransAmount", "buyerKycLimit",
        "buyerRegDaysLimit", "buyerBtcPositionLimit", "remarks", "autoReplyMsg",
        "payTimeLimit", "tradeMethods", "advStatus", "takerAdditionalKycRequired",
        "launchCountry"
      ];
      const cleanUpdatePayload: Record<string, unknown> = {};
      for (const key of allowedUpdateKeys) {
        if (mergedPayload[key] !== undefined) {
          cleanUpdatePayload[key] = mergedPayload[key];
        }
      }
      const cleanRes = await binanceAgentRequest({
        endpoint: "/sapi/v1/c2c/agent/ads/update",
        method: "POST",
        body: cleanUpdatePayload,
      });
      if (cleanRes.ok) {
        return {
          ok: true,
          code: "000000",
          message: `Iklan #${advNo} berhasil diupdate via Binance Agent SAPI ke Rp ${newPrice.toLocaleString("id-ID")}`,
          data: cleanRes.data,
          timestamp: Date.now(),
        };
      }
    }

    // =========================================================================
    // FALLBACK 1: Direct JSON update ke /sapi/v1/c2c/agent/ads/update
    // =========================================================================
    const directAgentPayload: Record<string, unknown> = {
      advNo,
      price: newPrice,
      priceType: data.priceType ?? 1,
    };
    if (data.amount && data.amount > 0) {
      directAgentPayload["initAmount"] = Math.floor(data.amount * 100) / 100;
    }
    if (data.minSingleTransAmount && data.minSingleTransAmount > 0) {
      directAgentPayload["minSingleTransAmount"] = Math.round(data.minSingleTransAmount);
    }
    if (data.maxSingleTransAmount && data.maxSingleTransAmount > 0) {
      directAgentPayload["maxSingleTransAmount"] = Math.round(data.maxSingleTransAmount);
    }

    const directAgentRes = await binanceAgentRequest({
      endpoint: "/sapi/v1/c2c/agent/ads/update",
      method: "POST",
      body: directAgentPayload,
    });

    if (directAgentRes.ok) {
      return {
        ok: true,
        code: "000000",
        message: `Iklan #${advNo} berhasil diupdate via Binance Agent SAPI ke Rp ${newPrice.toLocaleString("id-ID")}`,
        data: directAgentRes.data,
        timestamp: Date.now(),
      };
    }

    // =========================================================================
    // FALLBACK 2: Standard Binance Merchant API (/sapi/v1/c2c/ads/update)
    // =========================================================================
    const fullParams: Record<string, string | number> = {
      advNo,
      price: newPrice,
      priceType: data.priceType ?? 1,
    };

    if (data.amount && data.amount > 0) {
      fullParams["initAmount"] = Math.floor(data.amount * 100) / 100;
      fullParams["amount"] = Math.floor(data.amount * 100) / 100;
    }

    if (data.minSingleTransAmount && data.minSingleTransAmount > 0) {
      fullParams["minSingleTransAmount"] = Math.round(data.minSingleTransAmount);
    }

    if (data.maxSingleTransAmount && data.maxSingleTransAmount > 0) {
      fullParams["maxSingleTransAmount"] = Math.round(data.maxSingleTransAmount);
    }

    if (data.payMethods && data.payMethods.length > 0) {
      fullParams["payMethods"] = JSON.stringify(data.payMethods);
    }

    const legacyRes = await binanceMerchantRequest({
      endpoint: "/sapi/v1/c2c/ads/update",
      method: "POST",
      params: fullParams,
    });

    if (legacyRes.ok) {
      return legacyRes;
    }

    // Fallback harga saja pada legacy
    if (data.amount || data.maxSingleTransAmount) {
      const priceOnlyRes = await binanceMerchantRequest({
        endpoint: "/sapi/v1/c2c/ads/update",
        method: "POST",
        params: {
          advNo,
          price: newPrice,
        },
      });
      if (priceOnlyRes.ok) {
        return {
          ...priceOnlyRes,
          message: `Harga iklan #${advNo} berhasil diupdate ke Rp ${newPrice.toLocaleString("id-ID")}. (Catatan: Stok & limit disesuaikan via Binance Web/App).`,
        };
      }
    }

    // Jika semua cara gagal, kembalikan pesan error yang paling informatif
    const primaryError = detailRes.ok ? directAgentRes : detailRes;
    return {
      ok: false,
      code: primaryError.code || legacyRes.code || "-1000",
      error: primaryError.error || legacyRes.error,
      message:
        primaryError.message ||
        legacyRes.message ||
        "Gagal mengupdate iklan Binance. Pastikan nomor advNo benar dan izin API Key mencukupi.",
      data: primaryError.data || legacyRes.data,
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
