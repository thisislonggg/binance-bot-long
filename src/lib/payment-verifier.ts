/**
 * Modul Pemantau Pembayaran Saldo Bank & Notifikasi WhatsApp untuk Binance P2P
 *
 * Fitur:
 * 1. Pelacakan order P2P Binance yang sedang berstatus menunggu pembayaran (TO_RELEASE / PAID).
 * 2. Pencocokan kenaikan saldo bank (Delta Balance) dengan nominal tagihan IDR order.
 * 3. Algoritma Subset-Sum untuk menangani transfer serentak pada beberapa order (double order).
 * 4. Proteksi khusus untuk order dengan nominal kembar.
 * 5. Notifikasi otomatis ke WhatsApp pengguna begitu dana masuk terverifikasi cocok.
 */

import { createServerFn } from "@tanstack/react-start";
import { createHmac } from "crypto";
import { z } from "zod";

import { requireSession } from "./auth";
import { parseFlexibleNumber } from "./pnl";
import { getSupabase } from "./supabase";

// ── Keys di user_settings Supabase ──────────────────────────────────────────
const VERIFIER_SETTINGS_KEY = "verifier_settings";
const VERIFIER_BASELINE_KEY = "verifier_baseline_balance";
const VERIFIER_LOGS_KEY = "verifier_alert_logs";

export type VerifierSettings = {
  /** Nomor WhatsApp tujuan (format Indonesia: 08xxx atau 628xxx) */
  wa_phone: string;
  /** Gateway WhatsApp yang digunakan: 'fonnte' | 'wablas' | 'local_gateway' | 'custom_webhook' */
  wa_provider: "fonnte" | "wablas" | "local_gateway" | "custom_webhook";
  /** API Key / Token untuk gateway WhatsApp */
  wa_api_token?: string;
  /** URL custom webhook jika menggunakan gateway mandiri (misal: http://localhost:3001/send-message) */
  wa_custom_url?: string;
  /** Apakah alarm audio di komputer aktif */
  sound_enabled: boolean;
  /** Apakah notifikasi Telegram cadangan diaktifkan */
  telegram_enabled: boolean;
  /** Bot Token Telegram opsional */
  telegram_bot_token?: string;
  /** Chat ID Telegram penerima */
  telegram_chat_id?: string;
};

export const DEFAULT_VERIFIER_SETTINGS: VerifierSettings = {
  wa_phone: "",
  wa_provider: "fonnte",
  wa_api_token: "",
  wa_custom_url: "",
  sound_enabled: true,
  telegram_enabled: false,
  telegram_bot_token: "",
  telegram_chat_id: "",
};

export type ActiveP2pOrder = {
  orderNumber: string;
  tradeType: "BUY" | "SELL" | string;
  asset: string;
  fiat: string;
  amountUsdt: number;
  totalPriceIdr: number;
  unitPriceIdr: number;
  orderStatus: string;
  createTime: number;
  counterPartNickName: string;
  payMethodName?: string;
};

export type AlertLog = {
  id: string;
  ts: string;
  type: "single_match" | "simultaneous_match" | "identical_alert" | "underpaid_alert" | "info";
  deltaIdr: number;
  newBalanceIdr: number;
  matchedOrders: {
    orderNumber: string;
    totalPriceIdr: number;
    counterPartNickName: string;
  }[];
  message: string;
  waSent: boolean;
  waError?: string;
};

export type VerifierState = {
  configured: boolean;
  settings: VerifierSettings;
  baselineBalanceIdr: number;
  activeOrders: ActiveP2pOrder[];
  recentLogs: AlertLog[];
};

// ── Helper: Format Angka Rupiah ─────────────────────────────────────────────
function fmtIdr(num: number): string {
  return "Rp " + Math.round(num).toLocaleString("id-ID");
}

// ── Ambil Data Pengaturan & State Verifier ────────────────────────────────────
const getVerifierStateSchema = z.object({ sessionToken: z.string().optional() });

export const getVerifierState = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getVerifierStateSchema.parse(data))
  .handler(async ({ data }): Promise<VerifierState> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();

    let settings = { ...DEFAULT_VERIFIER_SETTINGS };
    let baselineBalanceIdr = 0;
    let recentLogs: AlertLog[] = [];

    if (db) {
      const { data: rows } = await db
        .from("user_settings")
        .select("key, value")
        .in("key", [VERIFIER_SETTINGS_KEY, VERIFIER_BASELINE_KEY, VERIFIER_LOGS_KEY]);

      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r.key === VERIFIER_SETTINGS_KEY) {
            try {
              settings = { ...DEFAULT_VERIFIER_SETTINGS, ...JSON.parse(r.value) };
            } catch {
              // abaikan parse error
            }
          } else if (r.key === VERIFIER_BASELINE_KEY) {
            baselineBalanceIdr = parseFlexibleNumber(r.value);
          } else if (r.key === VERIFIER_LOGS_KEY) {
            try {
              recentLogs = JSON.parse(r.value);
            } catch {
              recentLogs = [];
            }
          }
        }
      }
    }

    // Ambil order aktif langsung dari Binance SAPI
    const activeOrders = await fetchActiveP2pSellOrdersInternal();

    return {
      configured: Boolean(settings.wa_phone || settings.telegram_chat_id),
      settings,
      baselineBalanceIdr,
      activeOrders,
      recentLogs: recentLogs.slice(0, 30),
    };
  });

// ── Simpan Pengaturan Verifier ────────────────────────────────────────────────
const saveVerifierSettingsSchema = z.object({
  sessionToken: z.string().optional(),
  settings: z.object({
    wa_phone: z.string(),
    wa_provider: z.enum(["fonnte", "wablas", "local_gateway", "custom_webhook"]),
    wa_api_token: z.string().optional(),
    wa_custom_url: z.string().optional(),
    sound_enabled: z.boolean(),
    telegram_enabled: z.boolean(),
    telegram_bot_token: z.string().optional(),
    telegram_chat_id: z.string().optional(),
  }),
});

export const saveVerifierSettings = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => saveVerifierSettingsSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { ok: false };

    const { error } = await db.from("user_settings").upsert(
      {
        key: VERIFIER_SETTINGS_KEY,
        value: JSON.stringify(data.settings),
      } as any,
      { onConflict: "key" },
    );

    return { ok: !error };
  });

// ── Update Saldo Baseline ─────────────────────────────────────────────────────
const updateBaselineSchema = z.object({
  sessionToken: z.string().optional(),
  baselineIdr: z.number().nonnegative(),
});

export const updateBaselineBalance = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateBaselineSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; baselineIdr: number }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { ok: false, baselineIdr: data.baselineIdr };

    const { error } = await db.from("user_settings").upsert(
      {
        key: VERIFIER_BASELINE_KEY,
        value: String(data.baselineIdr),
      } as any,
      { onConflict: "key" },
    );

    return { ok: !error, baselineIdr: data.baselineIdr };
  });

// ── Fungsi Internal Ambil Order Aktif Binance C2C ────────────────────────────
export async function fetchActiveP2pSellOrdersInternal(): Promise<ActiveP2pOrder[]> {
  const apiKey = process.env["BINANCE_API_KEY"]?.trim();
  const apiSecret = process.env["BINANCE_API_SECRET"]?.trim();

  if (!apiKey || !apiSecret || apiKey === "your_binance_api_key_here") {
    return [];
  }

  const DEFAULT_BINANCE_URL = "https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory";
  const baseUrl =
    process.env["BINANCE_PROXY_URL"] ||
    process.env["BINANCE_API_BASE_URL"] ||
    DEFAULT_BINANCE_URL;

  try {
    const timestamp = Date.now();
    // Cari window 24 jam ke belakang
    const startTimestamp = timestamp - 24 * 60 * 60 * 1000;
    const params: Record<string, string | number> = {
      tradeType: "SELL", // Kita menjual USDT, menunggu pembeli membayar IDR
      startTimestamp,
      endTimestamp: timestamp,
      page: 1,
      rows: 50,
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

    if (!resp.ok) return [];
    const json = await resp.json();
    const list = (Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : []) as any[];

    // Saring order aktif: status belum selesai (sedang menunggu pembayaran atau siap dirilis)
    // Di Binance P2P status order:
    // "1" / "PAYING" / "TRADING": Pembeli sedang membayar
    // "2" / "BUYER_PAYED" / "PAID" / "TO_RELEASE": Pembeli sudah klik bayar, siap diverifikasi
    const activeOrders: ActiveP2pOrder[] = [];

    for (const o of list) {
      const statusStr = String(o.orderStatus ?? "").toUpperCase();
      const isCompleted =
        statusStr.includes("COMPLET") ||
        statusStr.includes("SUCCESS") ||
        statusStr.includes("FINISH") ||
        statusStr.includes("SELESAI") ||
        statusStr === "4";
      const isCancelled =
        statusStr.includes("CANCEL") ||
        statusStr.includes("BATAL") ||
        statusStr.includes("CLOSE") ||
        statusStr === "5";

      if (isCompleted || isCancelled) continue; // Lewati order yang sudah selesai/dibatalkan

      const amountUsdt = parseFlexibleNumber(o.amount ?? o.cryptoAmount);
      const totalPriceIdr = parseFlexibleNumber(o.totalPrice ?? o.fiatAmount);
      let unitPriceIdr = parseFlexibleNumber(o.unitPrice ?? o.price);
      if (unitPriceIdr <= 0 && totalPriceIdr > 0 && amountUsdt > 0) {
        unitPriceIdr = totalPriceIdr / amountUsdt;
      }

      activeOrders.push({
        orderNumber: String(o.orderNumber || o.advNo || ""),
        tradeType: "SELL",
        asset: String(o.asset || "USDT"),
        fiat: String(o.fiat || "IDR"),
        amountUsdt,
        totalPriceIdr,
        unitPriceIdr,
        orderStatus: statusStr,
        createTime: Number(o.createTime) || Date.now(),
        counterPartNickName: String(o.counterPartNickName || "Pembeli"),
        payMethodName: o.payMethodName,
      });
    }

    return activeOrders;
  } catch (err) {
    console.warn("Gagal mengambil active P2P orders:", err);
    return [];
  }
}

// ── Dispatcher Pengiriman Pesan WhatsApp & Telegram ──────────────────────────
export async function sendWhatsAppMessage(
  settings: VerifierSettings,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const phone = settings.wa_phone?.trim().replace(/[^0-9]/g, "");
  if (!phone) {
    return { ok: false, error: "Nomor WhatsApp belum diisi!" };
  }

  // Format nomor standar internasional jika dimulai dari 0
  const normalizedPhone = phone.startsWith("0") ? "62" + phone.slice(1) : phone;

  try {
    // 1. Gateway Fonnte (Paling populer & mudah di Indonesia)
    if (settings.wa_provider === "fonnte") {
      const token = settings.wa_api_token?.trim() || process.env["FONNTE_TOKEN"]?.trim();
      if (!token) {
        return { ok: false, error: "Token Fonnte belum diisi di pengaturan atau .env!" };
      }

      const resp = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: normalizedPhone,
          message,
          countryCode: "62",
        }),
      });

      const resJson = await resp.json().catch(() => ({}));
      if (!resp.ok || resJson.status === false) {
        return { ok: false, error: resJson.reason || `HTTP ${resp.status}` };
      }
      return { ok: true };
    }

    // 2. Gateway Wablas
    if (settings.wa_provider === "wablas") {
      const token = settings.wa_api_token?.trim() || process.env["WABLAS_TOKEN"]?.trim();
      const domain = settings.wa_custom_url?.trim() || "https://kudus.wablas.com";
      if (!token) {
        return { ok: false, error: "Token Wablas belum diisi!" };
      }

      const resp = await fetch(`${domain}/api/send-message`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: normalizedPhone,
          message,
        }),
      });

      const resJson = await resp.json().catch(() => ({}));
      if (!resp.ok || resJson.status === false) {
        return { ok: false, error: resJson.message || `HTTP ${resp.status}` };
      }
      return { ok: true };
    }

    // 3. Local Gateway (Self-hosted Baileys / Wppconnect di PC: http://localhost:3001)
    if (settings.wa_provider === "local_gateway" || settings.wa_provider === "custom_webhook") {
      const url = settings.wa_custom_url?.trim() || "http://127.0.0.1:3001/send-message";
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: normalizedPhone,
          message,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `Local gateway error ${resp.status}: ${body.slice(0, 100)}` };
      }
      return { ok: true };
    }

    return { ok: false, error: "Provider WhatsApp tidak dikenali" };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ── Dispatcher Telegram Opsional ─────────────────────────────────────────────
export async function sendTelegramMessage(
  settings: VerifierSettings,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!settings.telegram_enabled) return { ok: true };
  const botToken = settings.telegram_bot_token?.trim() || process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  const chatId = settings.telegram_chat_id?.trim() || process.env["TELEGRAM_CHAT_ID"]?.trim();

  if (!botToken || !chatId) {
    return { ok: false, error: "Telegram Bot Token / Chat ID belum diisi" };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
    return { ok: resp.ok };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ── Tes Kirim Pesan WhatsApp ─────────────────────────────────────────────────
const testWhatsAppSchema = z.object({ sessionToken: z.string().optional() });

export const sendTestWhatsApp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => testWhatsAppSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) return { ok: false, error: "Database belum siap" };

    const { data: row } = await db
      .from("user_settings")
      .select("value")
      .eq("key", VERIFIER_SETTINGS_KEY)
      .maybeSingle();

    if (!row?.value) {
      return { ok: false, error: "Pengaturan WhatsApp belum disimpan!" };
    }

    let settings: VerifierSettings;
    try {
      settings = JSON.parse(row.value);
    } catch {
      return { ok: false, error: "Format pengaturan tidak valid" };
    }

    const testMsg = [
      "🔔 *TES NOTIFIKASI BOT BINANCE P2P*",
      "━━━━━━━━━━━━━━━━━━",
      "Koneksi notifikasi WhatsApp berhasil terhubung! ✅",
      `📅 Waktu: ${new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
      "",
      "Bot siap mengirimkan alarm otomatis begitu ada dana pembeli masuk ke rekening BRI Anda.",
    ].join("\n");

    const res = await sendWhatsAppMessage(settings, testMsg);
    if (settings.telegram_enabled) {
      await sendTelegramMessage(settings, testMsg);
    }
    return res;
  });

// ── Engine Utama: Pencocokan Delta Saldo & Subset-Sum ────────────────────────
const verifyBalanceSchema = z.object({
  sessionToken: z.string().optional(),
  newBalanceIdr: z.number().positive("Saldo baru harus lebih besar dari 0"),
});

export type VerifyBalanceResult = {
  ok: boolean;
  deltaIdr: number;
  matched: boolean;
  alertType?: AlertLog["type"];
  message: string;
  matchedOrders: ActiveP2pOrder[];
  waSent: boolean;
  waError?: string;
  newBaselineIdr: number;
};

export const checkBalanceDelta = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifyBalanceSchema.parse(data))
  .handler(async ({ data }): Promise<VerifyBalanceResult> => {
    await requireSession(data.sessionToken);
    const db = getSupabase();
    if (!db) {
      return {
        ok: false,
        deltaIdr: 0,
        matched: false,
        message: "Database belum siap",
        matchedOrders: [],
        waSent: false,
        newBaselineIdr: data.newBalanceIdr,
      };
    }

    // Ambil baseline saldo dan pengaturan
    const { data: rows } = await db
      .from("user_settings")
      .select("key, value")
      .in("key", [VERIFIER_SETTINGS_KEY, VERIFIER_BASELINE_KEY, VERIFIER_LOGS_KEY]);

    let settings = { ...DEFAULT_VERIFIER_SETTINGS };
    let currentBaseline = 0;
    let existingLogs: AlertLog[] = [];

    if (Array.isArray(rows)) {
      for (const r of rows) {
        if (r.key === VERIFIER_SETTINGS_KEY) {
          try {
            settings = JSON.parse(r.value);
          } catch {}
        } else if (r.key === VERIFIER_BASELINE_KEY) {
          currentBaseline = parseFlexibleNumber(r.value);
        } else if (r.key === VERIFIER_LOGS_KEY) {
          try {
            existingLogs = JSON.parse(r.value);
          } catch {}
        }
      }
    }

    const newBalance = data.newBalanceIdr;

    // Jika baseline belum disetel, setel ke saldo saat ini sebagai titik awal
    if (currentBaseline <= 0) {
      await db.from("user_settings").upsert(
        { key: VERIFIER_BASELINE_KEY, value: String(newBalance) } as any,
        { onConflict: "key" },
      );
      return {
        ok: true,
        deltaIdr: 0,
        matched: false,
        message: `Saldo baseline awal berhasil disetel: ${fmtIdr(newBalance)}. Siap memantau penambahan saldo.`,
        matchedOrders: [],
        waSent: false,
        newBaselineIdr: newBalance,
      };
    }

    const delta = Math.round(newBalance - currentBaseline);

    // Jika saldo tidak bertambah (berkurang atau tetap)
    if (delta <= 0) {
      // Jika saldo berkurang (misal user transfer keluar / tarik tunai), perbarui baseline
      if (delta < 0) {
        await db.from("user_settings").upsert(
          { key: VERIFIER_BASELINE_KEY, value: String(newBalance) } as any,
          { onConflict: "key" },
        );
      }
      return {
        ok: true,
        deltaIdr: delta,
        matched: false,
        message: delta < 0 ? `Saldo berkurang (${fmtIdr(delta)}). Baseline disesuaikan ke ${fmtIdr(newBalance)}.` : "Tidak ada kenaikan saldo.",
        matchedOrders: [],
        waSent: false,
        newBaselineIdr: newBalance,
      };
    }

    // Ambil order aktif yang sedang dinanti
    const activeOrders = await fetchActiveP2pSellOrdersInternal();

    // ── 1. Cek Pencocokan Tunggal (Single Match) ─────────────────────────────
    // Cari apakah ada order aktif yang totalPrice-nya sama persis (toleransi selisih <= Rp 100)
    const singleMatches = activeOrders.filter(
      (o) => Math.abs(o.totalPriceIdr - delta) <= 100,
    );

    let alertType: AlertLog["type"] = "info";
    let matchedOrders: ActiveP2pOrder[] = [];
    let messageBody = "";
    let waNotificationText = "";

    if (singleMatches.length === 1) {
      // ✅ Skenario Normal: 1 order cocok sempurna!
      const ord = singleMatches[0]!;
      alertType = "single_match";
      matchedOrders = [ord];
      messageBody = `✅ DANA MASUK VALID: Kenaikan saldo ${fmtIdr(delta)} cocok persis dengan Order #${ord.orderNumber.slice(-6)} (@${ord.counterPartNickName}).`;

      waNotificationText = [
        "✅ *DANA MASUK TERVERIFIKASI (BRI)*",
        "━━━━━━━━━━━━━━━━━━",
        `💰 *Nominal:* ${fmtIdr(delta)}`,
        `👤 *Pembeli:* @${ord.counterPartNickName}`,
        `📦 *Jumlah:* ${ord.amountUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT`,
        `🆔 *Order:* #${ord.orderNumber}`,
        `⏱️ *Waktu:* ${new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
        "━━━━━━━━━━━━━━━━━━",
        "💡 *Saldo rekening BRI sudah bertambah pas. Silakan release kripto di Binance!*",
      ].join("\n");
    } else if (singleMatches.length > 1) {
      // ⚠️ Skenario Khusus: Ada 2+ order bernilai kembar!
      alertType = "identical_alert";
      matchedOrders = singleMatches;
      const orderList = singleMatches.map((o) => `#${o.orderNumber.slice(-6)} (@${o.counterPartNickName})`).join(", ");
      messageBody = `⚠️ ORDER KEMBAR: Kenaikan ${fmtIdr(delta)} cocok dengan ${singleMatches.length} order kembar (${orderList}). Mohon verifikasi nama pengirim di BRImo sebelum release!`;

      waNotificationText = [
        "⚠️ *PERINGATAN ORDER KEMBAR (BRI)*",
        "━━━━━━━━━━━━━━━━━━",
        `💰 *Dana Masuk:* ${fmtIdr(delta)}`,
        `⚠️ Terdeteksi *${singleMatches.length} order aktif* dengan nominal yang sama:`,
        ...singleMatches.map((o) => `• Order #${o.orderNumber} - @${o.counterPartNickName} (${fmtIdr(o.totalPriceIdr)})`),
        "━━━━━━━━━━━━━━━━━━",
        "🚨 *PENTING:* Hanya 1 dana yang baru masuk. Silakan cek sekilas nama pengirim di mutasi BRImo agar tidak salah orang sebelum rilis!",
      ].join("\n");
    } else {
      // ── 2. Algoritma Subset-Sum untuk Transfer Serentak (Double Order) ──────
      // Cek apakah delta saldo merupakan penjumlahan dari kombinasi beberapa order aktif
      const combined = findSubsetSum(activeOrders, delta);

      if (combined.length > 0) {
        // ✅ Skenario Serentak: 2+ order masuk berbarengan di detik yang sama!
        alertType = "simultaneous_match";
        matchedOrders = combined;
        messageBody = `✅ DANA MASUK SERENTAK: Kenaikan ${fmtIdr(delta)} mencakup ${combined.length} order sekaligus (${combined.map((o) => `@${o.counterPartNickName}`).join(" + ")}).`;

        waNotificationText = [
          "✅ *DANA MASUK SERENTAK (DOUBLE ORDER)*",
          "━━━━━━━━━━━━━━━━━━",
          `💰 *Total Kenaikan:* ${fmtIdr(delta)}`,
          `📦 *Mencakup ${combined.length} Order:*`,
          ...combined.map((o) => `• #${o.orderNumber.slice(-6)}: ${fmtIdr(o.totalPriceIdr)} (@${o.counterPartNickName})`),
          "━━━━━━━━━━━━━━━━━━",
          "🎉 *Semua order di atas dananya sudah masuk lengkap ke BRI. Siap direlease!*",
        ].join("\n");
      } else {
        // ── 3. Tidak Ada Order yang Cocok Persis ──────────────────────────────
        // Cek apakah ada order aktif yang nilainya lebih besar (potensi transfer kurang)
        const possibleUnderpaid = activeOrders.find((o) => o.totalPriceIdr > delta && o.totalPriceIdr - delta < o.totalPriceIdr * 0.7);

        if (possibleUnderpaid) {
          alertType = "underpaid_alert";
          matchedOrders = [possibleUnderpaid];
          const kekurangannya = possibleUnderpaid.totalPriceIdr - delta;
          messageBody = `⚠️ DANA KURANG: Masuk ${fmtIdr(delta)}, tetapi Order #${possibleUnderpaid.orderNumber.slice(-6)} (@${possibleUnderpaid.counterPartNickName}) bertagihan ${fmtIdr(possibleUnderpaid.totalPriceIdr)} (Kurang ${fmtIdr(kekurangannya)}).`;

          waNotificationText = [
            "⚠️ *DANA MASUK KURANG / TIDAK PAS*",
            "━━━━━━━━━━━━━━━━━━",
            `💰 *Masuk ke Rekening:* ${fmtIdr(delta)}`,
            `📦 *Tagihan Order:* ${fmtIdr(possibleUnderpaid.totalPriceIdr)} (@${possibleUnderpaid.counterPartNickName})`,
            `❌ *Kurang:* ${fmtIdr(kekurangannya)}`,
            "━━━━━━━━━━━━━━━━━━",
            "🚨 *JANGAN RELEASE DULU!* Minta pembeli melunasi sisa kekurangan melalui chat Binance.",
          ].join("\n");
        } else {
          alertType = "info";
          messageBody = `ℹ️ Saldo bertambah ${fmtIdr(delta)}, namun tidak ada order Binance aktif yang cocok dengan nominal ini.`;
        }
      }
    }

    // Update saldo baseline ke saldo baru
    await db.from("user_settings").upsert(
      { key: VERIFIER_BASELINE_KEY, value: String(newBalance) } as any,
      { onConflict: "key" },
    );

    // Kirim notifikasi WhatsApp & Telegram jika ada kecocokan atau peringatan
    let waSent = false;
    let waError: string | undefined;

    if (alertType !== "info" && waNotificationText && (settings.wa_phone || settings.telegram_chat_id)) {
      const waRes = await sendWhatsAppMessage(settings, waNotificationText);
      waSent = waRes.ok;
      waError = waRes.error;

      if (settings.telegram_enabled) {
        await sendTelegramMessage(settings, waNotificationText);
      }
    }

    // Catat log riwayat
    const newLog: AlertLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: new Date().toISOString(),
      type: alertType,
      deltaIdr: delta,
      newBalanceIdr: newBalance,
      matchedOrders: matchedOrders.map((o) => ({
        orderNumber: o.orderNumber,
        totalPriceIdr: o.totalPriceIdr,
        counterPartNickName: o.counterPartNickName,
      })),
      message: messageBody,
      waSent,
      waError,
    };

    const updatedLogs = [newLog, ...existingLogs].slice(0, 50);
    await db.from("user_settings").upsert(
      { key: VERIFIER_LOGS_KEY, value: JSON.stringify(updatedLogs) } as any,
      { onConflict: "key" },
    );

    return {
      ok: true,
      deltaIdr: delta,
      matched: alertType !== "info",
      alertType,
      message: messageBody,
      matchedOrders,
      waSent,
      waError,
      newBaselineIdr: newBalance,
    };
  });

// ── Algoritma Subset-Sum: Cari Kombinasi Order yang Jumlahnya Pas = Target ────
function findSubsetSum(orders: ActiveP2pOrder[], target: number, tolerance = 100): ActiveP2pOrder[] {
  if (orders.length === 0 || target <= 0) return [];

  // Jika jumlah order sedikit (<= 12), kita bisa evaluasi seluruh kombinasi secara cepat
  const n = Math.min(orders.length, 12);
  const subsetCount = 1 << n; // 2^n kombinasi

  for (let mask = 1; mask < subsetCount; mask++) {
    let sum = 0;
    const currentSubset: ActiveP2pOrder[] = [];

    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) {
        const ord = orders[i]!;
        sum += ord.totalPriceIdr;
        currentSubset.push(ord);
      }
    }

    // Jika lebih dari 1 order dan jumlahnya cocok persis dengan delta
    if (currentSubset.length >= 2 && Math.abs(sum - target) <= tolerance) {
      return currentSubset;
    }
  }

  return [];
}

/**
 * Parsing teks notifikasi push Android (BRImo / BCA / Mandiri / SMS)
 * Contoh: "Transfer masuk sebesar Rp 1.500.000 dari EKO PRASETYO"
 */
export function parseBankNotificationText(rawText: string): { amount: number; sender: string | null } {
  if (!rawText) return { amount: 0, sender: null };
  const clean = rawText.replace(/[\r\n]+/g, " ");

  // 1. Ekstrak nominal uang
  let amount = 0;
  const rpRegex = /(?:Rp\.?\s?|sebesar\s+Rp\.?\s?|masuk\s+Rp\.?\s?|^|\s)([0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{2})?|[0-9]{4,})/i;
  const match = clean.match(rpRegex);
  if (match && match[1]) {
    const rawDigits = match[1].replace(/\./g, "").replace(/,/g, ".");
    amount = parseFloat(rawDigits) || 0;
  }

  // 2. Ekstrak nama pengirim jika tertera
  let sender: string | null = null;
  const senderRegex = /(?:dari|from)\s*:?\s*([A-Za-z\s.,'-]+?)(?:\s+(?:ke|pada|via|rek|melalui|\.|\/|\d)|$)/i;
  const senderMatch = clean.match(senderRegex);
  if (senderMatch && senderMatch[1]) {
    const rawName = senderMatch[1].trim();
    if (rawName.length >= 2 && rawName.length <= 50) {
      sender = rawName;
    }
  }

  return { amount, sender };
}

/**
 * Handler Webhook untuk menerima notifikasi dari aplikasi Android (MacroDroid / Notification Forwarder)
 */
export async function handleIncomingBankNotificationWebhook(input: {
  text?: string;
  title?: string;
  sender?: string;
  amount?: number | string;
}) {
  const rawText = (input.text || input.title || "").trim();
  const parsed = parseBankNotificationText(rawText);

  const amount = typeof input.amount === "number" && input.amount > 0
    ? input.amount
    : (typeof input.amount === "string" ? parseFloat(input.amount.replace(/[^0-9.]/g, "")) : 0) || parsed.amount;

  const senderName = input.sender?.trim() || parsed.sender;

  if (amount <= 0) {
    return {
      ok: false,
      error: "Tidak dapat mengekstrak nominal rupiah dari teks notifikasi",
      rawText,
    };
  }

  const db = getSupabase();

  // 1. Ambil Pengaturan Verifier
  let settings = DEFAULT_VERIFIER_SETTINGS;
  const { data: setRow } = await db
    .from("user_settings")
    .select("value")
    .eq("key", VERIFIER_SETTINGS_KEY)
    .maybeSingle();

  if (setRow?.value) {
    try {
      settings = { ...DEFAULT_VERIFIER_SETTINGS, ...JSON.parse(setRow.value) };
    } catch {
      // Abaikan
    }
  }

  // 2. Ambil Order Aktif Binance P2P
  const activeOrders = await fetchActiveP2pSellOrdersInternal();

  // 3. Cocokkan dengan Order Aktif
  const singleMatches = activeOrders.filter(
    (o) => Math.abs(o.totalPriceIdr - amount) <= 100,
  );

  let alertType: AlertLog["type"] = "info";
  let matchedOrders: ActiveP2pOrder[] = [];
  let messageBody = "";
  let waNotificationText = "";

  if (singleMatches.length === 1) {
    const ord = singleMatches[0]!;
    alertType = "single_match";
    matchedOrders = [ord];
    messageBody = `✅ DANA MASUK OTOMATIS: Notifikasi bank ${fmtIdr(amount)}${senderName ? ` dari ${senderName}` : ""} cocok persis dengan Order #${ord.orderNumber.slice(-6)} (@${ord.counterPartNickName}).`;

    waNotificationText = [
      "✅ *DANA MASUK TERVERIFIKASI (NOTIFIKASI BANK)*",
      "━━━━━━━━━━━━━━━━━━",
      `💰 *Nominal:* ${fmtIdr(amount)}`,
      senderName ? `👤 *Pengirim:* ${senderName}` : "",
      `👤 *Pembeli Binance:* @${ord.counterPartNickName}`,
      `📦 *Jumlah:* ${ord.amountUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT`,
      `🆔 *Order:* #${ord.orderNumber}`,
      `⏱️ *Waktu:* ${new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
      "━━━━━━━━━━━━━━━━━━",
      "💡 *Dana sudah masuk ke rekening. Silakan release kripto di Binance!*",
    ].filter(Boolean).join("\n");
  } else if (singleMatches.length > 1) {
    alertType = "identical_alert";
    matchedOrders = singleMatches;
    messageBody = `⚠️ ORDER KEMBAR: Notifikasi bank ${fmtIdr(amount)}${senderName ? ` dari ${senderName}` : ""} cocok dengan ${singleMatches.length} order kembar.`;

    waNotificationText = [
      "⚠️ *PERINGATAN ORDER KEMBAR (NOTIFIKASI BANK)*",
      "━━━━━━━━━━━━━━━━━━",
      `💰 *Dana Masuk:* ${fmtIdr(amount)}`,
      senderName ? `👤 *Pengirim Tertera:* ${senderName}` : "",
      `⚠️ Terdeteksi *${singleMatches.length} order aktif* dengan nominal yang sama:`,
      ...singleMatches.map((o) => `• Order #${o.orderNumber} - @${o.counterPartNickName} (${fmtIdr(o.totalPriceIdr)})`),
      "━━━━━━━━━━━━━━━━━━",
      "🚨 *PENTING:* Hanya 1 dana yang baru masuk. Silakan cek sekilas mutasi rekening agar tidak salah rilis!",
    ].filter(Boolean).join("\n");
  } else {
    const combined = findSubsetSum(activeOrders, amount);
    if (combined.length > 0) {
      alertType = "simultaneous_match";
      matchedOrders = combined;
      messageBody = `✅ DANA MASUK SERENTAK: Notifikasi ${fmtIdr(amount)} mencakup ${combined.length} order sekaligus (${combined.map((o) => `@${o.counterPartNickName}`).join(" + ")}).`;

      waNotificationText = [
        "✅ *DANA MASUK SERENTAK (NOTIFIKASI BANK)*",
        "━━━━━━━━━━━━━━━━━━",
        `💰 *Total Nominal:* ${fmtIdr(amount)}`,
        `📦 *Mencakup ${combined.length} Order:*`,
        ...combined.map((o) => `• #${o.orderNumber.slice(-6)}: ${fmtIdr(o.totalPriceIdr)} (@${o.counterPartNickName})`),
        "━━━━━━━━━━━━━━━━━━",
        "🎉 *Semua order di atas dananya sudah masuk ke rekening!*",
      ].join("\n");
    } else {
      alertType = "info";
      messageBody = `ℹ️ DANA MASUK TIDAK TERDAFTAR: Notifikasi bank ${fmtIdr(amount)}${senderName ? ` dari ${senderName}` : ""} tidak cocok dengan order P2P aktif saat ini.`;
    }
  }

  // 4. Kirim Notifikasi WhatsApp jika ada nomor terdaftar
  let waSent = false;
  let waError: string | undefined;

  if (waNotificationText && settings.wa_phone?.trim()) {
    const waRes = await sendWhatsAppMessage(settings, waNotificationText);
    waSent = waRes.ok;
    waError = waRes.error;

    if (settings.telegram_enabled) {
      await sendTelegramMessage(settings, waNotificationText);
    }
  }

  // 5. Catat Log ke Supabase
  let existingLogs: AlertLog[] = [];
  const { data: logsRow } = await db
    .from("user_settings")
    .select("value")
    .eq("key", VERIFIER_LOGS_KEY)
    .maybeSingle();

  if (logsRow?.value) {
    try {
      existingLogs = JSON.parse(logsRow.value);
    } catch {
      // Abaikan
    }
  }

  const newLog: AlertLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    type: alertType,
    deltaIdr: amount,
    matchedOrders: matchedOrders.map((o) => ({
      orderNumber: o.orderNumber,
      amountUsdt: o.amountUsdt,
      totalPriceIdr: o.totalPriceIdr,
      counterPartNickName: o.counterPartNickName,
    })),
    message: messageBody,
    waSent,
    waError,
  };

  const updatedLogs = [newLog, ...existingLogs].slice(0, 50);
  await db.from("user_settings").upsert(
    { key: VERIFIER_LOGS_KEY, value: JSON.stringify(updatedLogs) } as any,
    { onConflict: "key" },
  );

  return {
    ok: true,
    amount,
    senderName,
    matched: alertType !== "info",
    alertType,
    message: messageBody,
    matchedOrders,
    waSent,
    waError,
  };
}

