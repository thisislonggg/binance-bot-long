/**
 * Modul Auto-Verifikasi Wajah / Liveness Check untuk Binance P2P.
 *
 * Fitur:
 * 1. Parser pesan resmi verifikasi wajah dari Binance Chat:
 *    "Verifikasi wajah
 *     SINARMAS_EXCHANGE requested to conduct liveness check
 *     Order number:
 *     22941387807730757632
 *     Last verification time:
 *     2026-10-08 12:58
 *     Status:
 *     Completed"
 * 2. Koneksi ke Binance P2P Chat WebSocket via `/sapi/v1/c2c/chat/retrieveChatCredential`.
 * 3. Penyimpanan status verifikasi order (Completed / Pending) di Supabase `user_settings`.
 * 4. Pengiriman notifikasi otomatis ke WhatsApp & Telegram saat pembeli selesai verifikasi liveness.
 * 5. Proteksi: Rilis kripto tetap dilakukan secara MANUAL di Binance untuk keamanan aset merchant.
 */

import { createServerFn } from "@tanstack/react-start";
import { createHmac } from "crypto";
import { z } from "zod";

import { requireSession } from "./auth";
import { getSupabase } from "./supabase";
import {
  sendWhatsAppMessage,
  sendTelegramMessage,
  type VerifierSettings,
  DEFAULT_VERIFIER_SETTINGS,
} from "./payment-verifier";

export const LIVENESS_RECORDS_KEY = "verifier_liveness_records";
const VERIFIER_SETTINGS_KEY = "verifier_settings";

export type OrderLivenessRecord = {
  orderNumber: string;
  status: "COMPLETED" | "FAILED" | "PENDING";
  verifiedAt: string; // ISO string
  verificationTimeText?: string;
  requester?: string;
  counterPartNickName?: string;
  source: "binance_chat_ws" | "chat_paste" | "manual_click" | "webhook";
  rawSnippet?: string;
};

export type ParsedLivenessMessage = {
  isLivenessMessage: boolean;
  isCompleted: boolean;
  orderNumber?: string;
  verificationTime?: string;
  requester?: string;
  status?: string;
  rawText: string;
};

// ── Parser Pesan Verifikasi Wajah Binance Chat ──────────────────────────────
export function parseLivenessChatMessage(text: string): ParsedLivenessMessage {
  let clean = (text || "").trim();
  if (!clean) {
    return { isLivenessMessage: false, isCompleted: false, rawText: "" };
  }

  // Handle jika input adalah string JSON dari WebSocket atau webhook
  let orderNumberFromPayload: string | undefined;
  if (clean.startsWith("{") && clean.endsWith("}")) {
    try {
      const obj = JSON.parse(clean);
      if (typeof obj === "object" && obj !== null) {
        orderNumberFromPayload = obj.orderNo || obj.orderNumber || obj.data?.orderNo || obj.data?.orderNumber;
        const innerText = obj.content || obj.text || obj.data?.content || obj.data?.text || obj.message;
        if (typeof innerText === "string") {
          clean = innerText.trim();
        }
      }
    } catch {}
  }

  // 1. Cek indikator verifikasi wajah / liveness check
  const isLivenessMessage =
    /verifikasi\s*wajah/i.test(clean) ||
    /facial\s*verification/i.test(clean) ||
    /liveness\s*check/i.test(clean) ||
    /conduct\s*liveness/i.test(clean) ||
    /face\s*verification/i.test(clean) ||
    /\bliveness\b/i.test(clean) ||
    /face\s*check/i.test(clean) ||
    /verifikasi\s*muka/i.test(clean) ||
    /biometrik/i.test(clean);

  if (!isLivenessMessage) {
    return { isLivenessMessage: false, isCompleted: false, rawText: clean };
  }

  // 2. Cek status: Completed / Selesai / Success / Pass / Passed / Lolos / Approved / Done
  const statusMatch = clean.match(/status[:\s]+([A-Za-z]+)/i);
  const statusStr = statusMatch ? statusMatch[1].trim() : "";
  const isCompleted =
    /completed|selesai|success|pass|passed|approved|lolos|verified|terverifikasi|done|ok/i.test(statusStr) ||
    /\b(completed|selesai|success|passed|approved|lolos|terverifikasi)\b/i.test(clean);

  // 3. Ekstrak Order Number: 15-25 digit
  let orderNumber: string | undefined = orderNumberFromPayload;
  if (!orderNumber) {
    const orderRegex = /(?:Order\s*number|Order\s*no|Nomor\s*pesanan|Pesanan|Order)[:\s]+(\d{15,25})/i;
    const matchOrder = clean.match(orderRegex);
    if (matchOrder) {
      orderNumber = matchOrder[1].trim();
    } else {
      // Fallback digit panjang (15 s/d 25 digit khas order Binance P2P)
      const digitMatch = clean.match(/\b(\d{15,25})\b/);
      if (digitMatch) {
        orderNumber = digitMatch[1].trim();
      }
    }
  }

  // 4. Ekstrak Last verification time
  let verificationTime: string | undefined;
  const timeRegex = /(?:Last\s*verification\s*time|Waktu\s*verifikasi(?:\s*terakhir)?)[:\s]+([0-9:\-\s]{10,25})/i;
  const matchTime = clean.match(timeRegex);
  if (matchTime) {
    verificationTime = matchTime[1].trim();
  }

  // 5. Ekstrak Requester / Merchant Name
  let requester: string | undefined;
  const reqRegex = /([A-Za-z0-9_\-]+)\s+requested\s+to\s+conduct\s+liveness\s+check/i;
  const matchReq = clean.match(reqRegex);
  if (matchReq) {
    requester = matchReq[1].trim();
  }

  return {
    isLivenessMessage: true,
    isCompleted,
    orderNumber,
    verificationTime,
    requester,
    status: isCompleted ? "Completed" : statusStr || "Unknown",
    rawText: clean,
  };
}

// ── In-Memory Cache Fallback (Aktif saat Supabase offline atau belum dikonfigurasi) ─
const inMemoryLivenessRecords: Record<string, OrderLivenessRecord> = {};
let inMemorySettings: VerifierSettings = { ...DEFAULT_VERIFIER_SETTINGS };

// ── Helper DB Internal: Ambil & Simpan Riwayat Liveness ──────────────────────
export async function getLivenessRecordsInternal(): Promise<Record<string, OrderLivenessRecord>> {
  const db = getSupabase();
  let dbRecords: Record<string, OrderLivenessRecord> = {};

  if (db) {
    try {
      const { data } = await db
        .from("user_settings")
        .select("value")
        .eq("key", LIVENESS_RECORDS_KEY)
        .maybeSingle();

      if (data?.value) {
        dbRecords = JSON.parse(data.value) as Record<string, OrderLivenessRecord>;
      }
    } catch (err) {
      console.warn("getLivenessRecordsInternal db error:", err);
    }
  }

  // Gabungkan in-memory records dan db records
  return { ...inMemoryLivenessRecords, ...dbRecords };
}

export async function saveLivenessRecordInternal(
  record: OrderLivenessRecord,
): Promise<{ ok: boolean; records: Record<string, OrderLivenessRecord> }> {
  // Selalu simpan di in-memory cache
  inMemoryLivenessRecords[record.orderNumber] = record;

  const db = getSupabase();
  if (!db) {
    return { ok: true, records: inMemoryLivenessRecords };
  }

  try {
    const existing = await getLivenessRecordsInternal();
    existing[record.orderNumber] = record;

    // Pertahankan maksimal 100 record terakhir agar hemat storage
    const keys = Object.keys(existing);
    if (keys.length > 100) {
      const sortedKeys = keys.sort((a, b) => {
        const ta = new Date(existing[a]?.verifiedAt || 0).getTime();
        const tb = new Date(existing[b]?.verifiedAt || 0).getTime();
        return tb - ta;
      });
      const pruned: Record<string, OrderLivenessRecord> = {};
      for (const k of sortedKeys.slice(0, 100)) {
        pruned[k] = existing[k]!;
      }
      await db.from("user_settings").upsert(
        { key: LIVENESS_RECORDS_KEY, value: JSON.stringify(pruned) } as any,
        { onConflict: "key" },
      );
      return { ok: true, records: pruned };
    }

    await db.from("user_settings").upsert(
      { key: LIVENESS_RECORDS_KEY, value: JSON.stringify(existing) } as any,
      { onConflict: "key" },
    );

    return { ok: true, records: existing };
  } catch (err) {
    console.warn("Gagal menyimpan liveness record ke Supabase:", err);
    return { ok: true, records: inMemoryLivenessRecords };
  }
}

export async function deleteLivenessRecordInternal(
  orderNumber: string,
): Promise<{ ok: boolean; records: Record<string, OrderLivenessRecord> }> {
  delete inMemoryLivenessRecords[orderNumber];

  const db = getSupabase();
  if (!db) return { ok: true, records: inMemoryLivenessRecords };

  try {
    const existing = await getLivenessRecordsInternal();
    delete existing[orderNumber];

    await db.from("user_settings").upsert(
      { key: LIVENESS_RECORDS_KEY, value: JSON.stringify(existing) } as any,
      { onConflict: "key" },
    );

    return { ok: true, records: existing };
  } catch {
    return { ok: true, records: inMemoryLivenessRecords };
  }
}

// ── Helper DB Internal: Ambil Pengaturan Verifier (WA & Telegram) ────────────
async function getVerifierSettingsInternal(): Promise<VerifierSettings> {
  const db = getSupabase();
  if (!db) return inMemorySettings;

  try {
    const { data } = await db
      .from("user_settings")
      .select("value")
      .eq("key", VERIFIER_SETTINGS_KEY)
      .maybeSingle();

    if (data?.value) {
      const parsed = JSON.parse(data.value);
      inMemorySettings = { ...DEFAULT_VERIFIER_SETTINGS, ...parsed };
      return inMemorySettings;
    }
  } catch {}

  return inMemorySettings;
}

// ── Kirim Notifikasi WhatsApp & Telegram untuk Liveness ─────────────────────
export async function notifyLivenessCompleted(record: OrderLivenessRecord): Promise<void> {
  const settings = await getVerifierSettingsInternal();
  if (!settings.wa_phone && !settings.telegram_chat_id) return;

  const orderShort = record.orderNumber.length > 8 ? record.orderNumber.slice(-8) : record.orderNumber;
  const buyer = record.counterPartNickName ? `@${record.counterPartNickName}` : "Pembeli";
  const waktu = record.verificationTimeText || new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

  const messageText = [
    "✅ *VERIFIKASI WAJAH BUYER SELESAI*",
    "━━━━━━━━━━━━━━━━━━",
    `🆔 *Order:* #${record.orderNumber} (..${orderShort})`,
    `👤 *Buyer:* ${buyer}`,
    `🏢 *Merchant:* ${record.requester || "Anda"}`,
    `⏱️ *Waktu Verifikasi:* ${waktu}`,
    "🎯 *Status:* Completed (Lolos Liveness)",
    "━━━━━━━━━━━━━━━━━━",
    "💡 *CATATAN KEAMANAN:*",
    "• Pembeli sudah menyelesaikan verifikasi wajah di Binance Chat.",
    "• Pastikan saldo transfer IDR sudah masuk pas di rekening bank.",
    "• Rilis kripto dilakukan secara *MANUAL* di aplikasi Binance.",
  ].join("\n");

  try {
    if (settings.wa_phone) {
      await sendWhatsAppMessage(settings, messageText);
    }
    if (settings.telegram_enabled && settings.telegram_chat_id) {
      await sendTelegramMessage(settings, messageText);
    }
  } catch (err) {
    console.warn("Gagal mengirim notifikasi liveness:", err);
  }
}

// ── Server Function: Ambil Kredensial Binance Chat WebSocket ────────────────
const getChatCredentialsSchema = z.object({ sessionToken: z.string().optional() });

export const getBinanceChatCredentials = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => getChatCredentialsSchema.parse(data))
  .handler(async ({ data }): Promise<{
    ok: boolean;
    chatWssUrl?: string;
    listenKey?: string;
    listenToken?: string;
    error?: string;
  }> => {
    await requireSession(data.sessionToken);

    const apiKey = process.env["BINANCE_API_KEY"]?.trim();
    const apiSecret = process.env["BINANCE_API_SECRET"]?.trim();

    if (!apiKey || !apiSecret || apiKey === "your_binance_api_key_here") {
      return {
        ok: false,
        error: "BINANCE_API_KEY & BINANCE_API_SECRET belum diisi di file .env!",
      };
    }

    const rawBaseUrl =
      process.env["BINANCE_PROXY_URL"] ||
      process.env["BINANCE_API_BASE_URL"] ||
      "https://api.binance.com";
    const baseUrl = rawBaseUrl.replace(/\/sapi\/.*$/, "").replace(/\/+$/, "");

    try {
      const timestamp = Date.now();
      const params = {
        timestamp,
        recvWindow: 10_000,
      };

      const qs = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
      const signature = createHmac("sha256", apiSecret).update(qs).digest("hex");
      const url = `${baseUrl}/sapi/v1/c2c/chat/retrieveChatCredential?${qs}&signature=${signature}`;

      const resp = await fetch(url, {
        headers: {
          "X-MBX-APIKEY": apiKey,
          "Content-Type": "application/json",
          "clientType": "web",
        },
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return {
          ok: false,
          error: `Binance SAPI HTTP ${resp.status}: ${body.slice(0, 150)}`,
        };
      }

      const json = await resp.json();
      if (json.code && json.code !== "000000" && json.code !== 0 && json.code !== "0") {
        return {
          ok: false,
          error: `Binance SAPI: ${json.message || JSON.stringify(json)}`,
        };
      }

      const d = json.data || json;
      return {
        ok: true,
        chatWssUrl: d.chatWssUrl || d.wssUrl || "",
        listenKey: d.listenKey || "",
        listenToken: d.listenToken || "",
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || String(err),
      };
    }
  });

// ── Server Function: Proses Pesan Chat (Auto / Tempel / Webhook) ────────────
const processLivenessChatMessageSchema = z.object({
  sessionToken: z.string().optional(),
  chatText: z.string().min(1),
  orderNumberHint: z.string().optional(),
  counterPartNickNameHint: z.string().optional(),
  source: z.enum(["binance_chat_ws", "chat_paste", "manual_click", "webhook"]).default("chat_paste"),
});

export type ProcessChatMessageResult = {
  ok: boolean;
  isLiveness: boolean;
  isCompleted: boolean;
  orderNumber?: string;
  record?: OrderLivenessRecord;
  message: string;
};

export const processLivenessChatMessage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => processLivenessChatMessageSchema.parse(data))
  .handler(async ({ data }): Promise<ProcessChatMessageResult> => {
    await requireSession(data.sessionToken);

    const parsed = parseLivenessChatMessage(data.chatText);

    if (!parsed.isLivenessMessage) {
      return {
        ok: false,
        isLiveness: false,
        isCompleted: false,
        message: "Teks bukan merupakan pesan verifikasi wajah / liveness check.",
      };
    }

    if (!parsed.isCompleted) {
      return {
        ok: false,
        isLiveness: true,
        isCompleted: false,
        orderNumber: parsed.orderNumber || data.orderNumberHint,
        message: "Pesan verifikasi wajah terdeteksi, namun statusnya belum 'Completed'.",
      };
    }

    const orderNumber = parsed.orderNumber || data.orderNumberHint;
    if (!orderNumber) {
      return {
        ok: false,
        isLiveness: true,
        isCompleted: true,
        message: "Nomor order tidak ditemukan dalam teks pesan. Silakan sertakan nomor order.",
      };
    }

    const newRecord: OrderLivenessRecord = {
      orderNumber,
      status: "COMPLETED",
      verifiedAt: new Date().toISOString(),
      verificationTimeText: parsed.verificationTime || new Date().toLocaleString("id-ID"),
      requester: parsed.requester || "Merchant",
      counterPartNickName: data.counterPartNickNameHint,
      source: data.source,
      rawSnippet: data.chatText.slice(0, 300),
    };

    await saveLivenessRecordInternal(newRecord);

    // Kirim notifikasi WA / Telegram
    await notifyLivenessCompleted(newRecord);

    return {
      ok: true,
      isLiveness: true,
      isCompleted: true,
      orderNumber,
      record: newRecord,
      message: `✅ Order #${orderNumber} berhasil diverifikasi! Buyer telah menyelesaikan liveness check (Status: Completed).`,
    };
  });

// ── Server Function: Setel Status Liveness Manual (1-Click di Tabel Order) ──
const setOrderLivenessStatusSchema = z.object({
  sessionToken: z.string().optional(),
  orderNumber: z.string().min(1),
  completed: z.boolean(),
  counterPartNickName: z.string().optional(),
});

export const setOrderLivenessStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setOrderLivenessStatusSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; orderNumber: string; completed: boolean }> => {
    await requireSession(data.sessionToken);

    if (!data.completed) {
      await deleteLivenessRecordInternal(data.orderNumber);
      return { ok: true, orderNumber: data.orderNumber, completed: false };
    }

    const newRecord: OrderLivenessRecord = {
      orderNumber: data.orderNumber,
      status: "COMPLETED",
      verifiedAt: new Date().toISOString(),
      verificationTimeText: new Date().toLocaleString("id-ID"),
      requester: "Merchant",
      counterPartNickName: data.counterPartNickName,
      source: "manual_click",
    };

    await saveLivenessRecordInternal(newRecord);
    await notifyLivenessCompleted(newRecord);

    return { ok: true, orderNumber: data.orderNumber, completed: true };
  });

// ── Webhook Handler untuk Integrasi Eksternal ────────────────────────────────
export async function handleIncomingChatMessageWebhook(body: any): Promise<any> {
  const text = typeof body?.text === "string" ? body.text : typeof body?.content === "string" ? body.content : "";
  const orderNumber = String(body?.orderNo || body?.orderNumber || "");

  if (!text) {
    return { ok: false, error: "Parameter text atau content diperlukan" };
  }

  const parsed = parseLivenessChatMessage(text);
  if (!parsed.isLivenessMessage || !parsed.isCompleted) {
    return { ok: false, message: "Bukan pesan liveness completed", parsed };
  }

  const finalOrderNo = parsed.orderNumber || orderNumber;
  if (!finalOrderNo) {
    return { ok: false, error: "Nomor order tidak ditemukan" };
  }

  const newRecord: OrderLivenessRecord = {
    orderNumber: finalOrderNo,
    status: "COMPLETED",
    verifiedAt: new Date().toISOString(),
    verificationTimeText: parsed.verificationTime || new Date().toLocaleString("id-ID"),
    requester: parsed.requester || "Merchant",
    source: "webhook",
    rawSnippet: text.slice(0, 300),
  };

  await saveLivenessRecordInternal(newRecord);
  await notifyLivenessCompleted(newRecord);

  return {
    ok: true,
    message: `Order #${finalOrderNo} verifikasi wajah tercatat`,
    record: newRecord,
  };
}
