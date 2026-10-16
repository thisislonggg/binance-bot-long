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
  source: "binance_chat_ws" | "chat_paste" | "manual_click" | "webhook" | "binance_kyc" | "auto_buyer_payed";
  /** true = sinyal berasal dari sumber yang tidak bisa dipalsukan buyer (kartu sistem Binance, merchant, webhook ber-secret). */
  trusted?: boolean;
  rawSnippet?: string;
};

/** Hanya record tepercaya yang boleh memicu auto-verify (membuka payment details ke buyer). */
export function isTrustedLivenessRecord(record: OrderLivenessRecord | undefined): boolean {
  if (!record || record.status !== "COMPLETED") return false;
  return record.trusted === true || record.source === "manual_click";
}

/**
 * Tipe pesan chat yang isinya diketik bebas oleh manusia (buyer / merchant). Pesan liveness
 * dengan tipe ini TIDAK dipercaya: buyer bisa mengetik "Verifikasi wajah ... Status: Completed"
 * untuk memancing bot membuka payment details tanpa benar-benar lolos verifikasi wajah.
 */
const USER_CHAT_MESSAGE_TYPES = new Set([
  "",
  "text",
  "image",
  "video",
  "file",
  "voice",
  "audio",
  "sticker",
  "emoji",
  "auto_reply",
]);

// Kartu & pesan sistem dibuat oleh Binance sendiri, bukan diketik user. Kartu liveness
// (subType add_kyc_vrf) tercatat self=true karena merchant yang "meminta" verifikasi, jadi
// self hanya relevan untuk pesan chat biasa.
const BINANCE_GENERATED_TYPES = new Set(["card", "system"]);

export function isTrustedChatEnvelope(messageType: string | undefined, fromSelf: boolean | undefined): boolean {
  const type = String(messageType || "").trim().toLowerCase();
  if (BINANCE_GENERATED_TYPES.has(type)) return true;
  if (fromSelf === true) return false;
  return !USER_CHAT_MESSAGE_TYPES.has(type);
}

/**
 * Format terstruktur asli Binance (dari log produksi):
 *  - pesan system: {"orderNo":"…","type":"liveness_check_complete_maker"}
 *  - kartu add_kyc_vrf: {"orderNo":"…","addKycVrfInfo":[{"displayTitleValue":"Liveness check","livenessCheckStatus":1}]}
 *    livenessCheckStatus 0 = menunggu, 1 = selesai.
 */
function parseStructuredLiveness(obj: any): ParsedLivenessMessage | null {
  const orderNumber = obj.orderNo || obj.orderNumber || undefined;
  const rawText = JSON.stringify(obj);
  const sysType = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
  if (/^liveness_check_complete/.test(sysType)) {
    return { isLivenessMessage: true, isCompleted: true, orderNumber, status: "Completed", rawText };
  }
  if (/^liveness_check_/.test(sysType)) {
    return { isLivenessMessage: true, isCompleted: false, orderNumber, status: sysType, rawText };
  }
  if (Array.isArray(obj.addKycVrfInfo)) {
    const checks = obj.addKycVrfInfo.filter(
      (i: any) => i && (i.livenessCheckStatus !== undefined || /liveness/i.test(String(i.displayTitleValue || ""))),
    );
    if (checks.length === 0) return null;
    const isCompleted = checks.every((i: any) => Number(i.livenessCheckStatus) === 1);
    return {
      isLivenessMessage: true,
      isCompleted,
      orderNumber,
      status: isCompleted ? "Completed" : `livenessCheckStatus=${checks.map((i: any) => i.livenessCheckStatus).join(",")}`,
      rawText,
    };
  }
  return null;
}

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
export function parseLivenessChatMessage(text: unknown): ParsedLivenessMessage {
  // Isi pesan kartu sistem bisa berupa objek; jangan sampai .trim() melempar error dan kartu hilang diam-diam.
  let clean = (typeof text === "string" ? text : text ? JSON.stringify(text) : "").trim();
  if (!clean) {
    return { isLivenessMessage: false, isCompleted: false, rawText: "" };
  }

  // Handle jika input memiliki escaped newlines dari JSON stringify
  clean = clean.replace(/\\n/g, "\n").replace(/\\r/g, "");

  // Handle jika input adalah string JSON dari WebSocket atau webhook
  let orderNumberFromPayload: string | undefined;
  if (clean.startsWith("{") && clean.endsWith("}")) {
    try {
      const obj = JSON.parse(clean);
      if (typeof obj === "object" && obj !== null) {
        const structured = parseStructuredLiveness(obj);
        if (structured) return structured;
        orderNumberFromPayload =
          obj.orderNo ||
          obj.orderNumber ||
          obj.data?.orderNo ||
          obj.data?.orderNumber ||
          obj.params?.orderNo ||
          obj.params?.orderNumber;
        const innerText =
          obj.content ||
          obj.text ||
          obj.data?.content ||
          obj.data?.text ||
          obj.message ||
          obj.data?.message;
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
  // Mendukung teks kartu ("Status:\nCompleted") maupun JSON kartu sistem ("status":"COMPLETED").
  const statusMatch = clean.match(/(?:status|\*status\*|\*\*status\*\*)["'*:\s=]+([A-Za-z_]+)/i);
  const statusStr = statusMatch ? statusMatch[1].trim() : "";

  // Jika status secara eksplisit PENDING / WAITING / FAILED / MENUNGGU, MAKA WAJIB BELUM SELESAI!
  const isExplicitPending = /pending|menunggu|waiting|unverified|proses|process/i.test(statusStr);
  const isExplicitFailed = /failed|gagal|rejected|ditolak/i.test(statusStr);
  // Kata status harus utuh: "Uncompleted" / "Incomplete" TIDAK dianggap selesai.
  const isExplicitCompleted =
    /^(completed|complete|selesai|passed|pass|approved|lolos|success|successful|berhasil|verified)$/i.test(statusStr);
  // Negasi sebelum kata status ("Status: Not completed", "Status: Belum selesai") menggagalkan status.
  const isNegatedStatus = /status["'*:\s=]+(not|belum|tidak)\b/i.test(clean);

  // isCompleted HANYA true jika statusStr adalah completed dan TIDAK pending/failed/negasi
  let isCompleted = isExplicitCompleted && !isExplicitPending && !isExplicitFailed && !isNegatedStatus;

  // Fallback: jika tidak ada kata status spesifik, cek kata kelulusan tanpa indikasi pending/failed
  if (!statusMatch) {
    const hasPendingWords =
      /\b(pending|menunggu|waiting|unverified|proses|failed|gagal|not|belum|tidak|incomplete|uncompleted)\b/i.test(clean);
    const hasCompletedWords = /\b(completed|selesai|passed|approved|lolos|success|terverifikasi)\b/i.test(clean);
    if (hasCompletedWords && !hasPendingWords) {
      isCompleted = true;
    }
  }

  // 3. Ekstrak Order Number: 15-25 digit
  let orderNumber: string | undefined = orderNumberFromPayload;
  if (!orderNumber) {
    const orderRegex = /(?:Order\s*number|Order\s*no|Nomor\s*pesanan|Pesanan|Order)[*:\s]+(\d{15,25})/i;
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
  const timeRegex = /(?:Last\s*verification\s*time|Waktu\s*verifikasi(?:\s*terakhir)?)[*:\s]+([0-9:\-\s]{10,25})/i;
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
// Disimpan di globalThis: TanStack Start memecah server function ke chunk terpisah sehingga modul ini
// bisa dimuat lebih dari sekali dalam satu proses. Tanpa ini, record yang disimpan handler chat tidak
// terlihat oleh polling getVerifierState (dan auto-verify tidak pernah dicoba ulang).
const livenessGlobal = globalThis as typeof globalThis & {
  __p2pLivenessRecords?: Record<string, OrderLivenessRecord>;
};
const inMemoryLivenessRecords: Record<string, OrderLivenessRecord> = (livenessGlobal.__p2pLivenessRecords ??= {});
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
  if (!db) {
    const mem = (globalThis as any).__p2pVerifierSettingsMem as Partial<VerifierSettings> | undefined;
    return mem ? { ...DEFAULT_VERIFIER_SETTINGS, ...mem } : inMemorySettings;
  }

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
    return getBinanceChatCredentialsInternal();
  });

/** Isi getBinanceChatCredentials tanpa cek sesi: dipanggil langsung oleh bot server. */
export async function getBinanceChatCredentialsInternal(): Promise<{
    ok: boolean;
    chatWssUrl?: string;
    listenKey?: string;
    listenToken?: string;
    error?: string;
  }> {

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
        clientType: "web",
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
  }

// ── Server Function: Proses Pesan Chat (Auto / Tempel / Webhook) ────────────
const processLivenessChatMessageSchema = z.object({
  sessionToken: z.string().optional(),
  chatText: z.string().min(1),
  orderNumberHint: z.string().optional(),
  counterPartNickNameHint: z.string().optional(),
  source: z.enum(["binance_chat_ws", "chat_paste", "manual_click", "webhook"]).default("chat_paste"),
  // Metadata amplop pesan WebSocket Binance (bukan isi yang bisa diketik buyer)
  messageType: z.string().max(40).optional(),
  fromSelf: z.boolean().optional(),
  envelopeOrderNo: z.string().max(40).optional(),
});

export type ProcessChatMessageResult = {
  ok: boolean;
  isLiveness: boolean;
  isCompleted: boolean;
  /** Pesan mirip liveness "Completed" tetapi dari sumber yang bisa dipalsukan buyer: tidak diproses. */
  untrusted?: boolean;
  orderNumber?: string | undefined;
  record?: OrderLivenessRecord;
  message: string;
};

export const processLivenessChatMessage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => processLivenessChatMessageSchema.parse(data))
  .handler(async ({ data }): Promise<ProcessChatMessageResult> => {
    await requireSession(data.sessionToken);
    return processLivenessChatInternal(data);
  });

/** Isi processLivenessChatMessage tanpa cek sesi: dipanggil langsung oleh bot server. */
export async function processLivenessChatInternal(data: z.infer<typeof processLivenessChatMessageSchema>): Promise<ProcessChatMessageResult> {

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

    const orderNumber = parsed.orderNumber || data.orderNumberHint || data.envelopeOrderNo;
    if (!orderNumber) {
      return {
        ok: false,
        isLiveness: true,
        isCompleted: true,
        message: "Nomor order tidak ditemukan dalam teks pesan. Silakan sertakan nomor order.",
      };
    }

    // KEAMANAN: pesan dari WebSocket hanya dipercaya jika berupa kartu/sistem Binance (bukan teks
    // yang diketik buyer), dan nomor order di isi pesan sama dengan order tempat pesan itu dikirim.
    if (data.source === "binance_chat_ws") {
      const envelopeMismatch =
        Boolean(data.envelopeOrderNo && parsed.orderNumber) && data.envelopeOrderNo !== parsed.orderNumber;
      if (!isTrustedChatEnvelope(data.messageType, data.fromSelf) || envelopeMismatch) {
        console.warn(
          `[LIVENESS] Pesan liveness 'Completed' untuk order #${orderNumber} DIABAIKAN (tipe=${data.messageType || "?"}, self=${String(data.fromSelf)}, orderAmplop=${data.envelopeOrderNo || "-"}).`,
        );
        return {
          ok: false,
          isLiveness: true,
          isCompleted: true,
          untrusted: true,
          orderNumber,
          message: envelopeMismatch
            ? `Pesan liveness menyebut order #${orderNumber} tetapi dikirim di chat order lain. Diabaikan demi keamanan.`
            : `Pesan liveness "Completed" untuk order #${orderNumber} dikirim sebagai pesan chat biasa (tipe: ${data.messageType || "tidak diketahui"}), bukan kartu sistem Binance. Bisa jadi diketik buyer, jadi TIDAK diproses otomatis. Periksa di Binance lalu verifikasi manual bila memang selesai.`,
        };
      }
    }

    const newRecord: OrderLivenessRecord = {
      orderNumber,
      status: "COMPLETED",
      verifiedAt: new Date().toISOString(),
      verificationTimeText: parsed.verificationTime || new Date().toLocaleString("id-ID"),
      requester: parsed.requester || "Merchant",
      ...(data.counterPartNickNameHint ? { counterPartNickName: data.counterPartNickNameHint } : {}),
      source: data.source,
      // Kartu sistem Binance (lolos cek di atas) atau teks yang ditempel sendiri oleh merchant
      trusted: data.source === "binance_chat_ws" || data.source === "chat_paste" || data.source === "manual_click",
      rawSnippet: data.chatText.slice(0, 300),
    };

    // Binance mengirim kartu (livenessCheckStatus=1) dan pesan sistem untuk kejadian yang sama:
    // jangan kirim notifikasi dua kali bila order ini sudah tercatat selesai dari sumber tepercaya.
    const existing = (await getLivenessRecordsInternal())[orderNumber];
    const alreadyCompleted = existing?.status === "COMPLETED" && isTrustedLivenessRecord(existing);
    if (!alreadyCompleted) {
      await saveLivenessRecordInternal(newRecord);
      // Kirim notifikasi WA / Telegram
      await notifyLivenessCompleted(newRecord);
    }

    // Eksekusi Auto-Verify ke Binance SAPI untuk membuka payment details ke buyer (khusus order SELL pending).
    // Mengikuti sakelar liveness & auto-verify di pengaturan; syarat keamanan dicek di executeAutoVerifyForSellOrder.
    let autoVerifyNote = "";
    try {
      const settings = await getVerifierSettingsInternal();
      if (settings.liveness_enabled !== false && settings.auto_verify_on_buyer_payed !== false) {
        const { executeAutoVerifyForSellOrder } = await import("./binance-merchant");
        const fromBinance = data.source === "binance_chat_ws";
        // Tepat setelah buyer selesai liveness, Binance kadang belum siap menerima verifikasi:
        // coba ulang cepat beberapa kali dalam request yang sama (polling dashboard tetap jadi cadangan).
        let kycRes = await executeAutoVerifyForSellOrder({
          orderNumber,
          livenessCompleted: true,
          binanceLivenessSignal: fromBinance,
        });
        for (const waitMs of [2_000, 4_000]) {
          if (kycRes.verified || (kycRes.skipped && !/menolak|Exception/i.test(kycRes.message))) break;
          await new Promise((r) => setTimeout(r, waitMs));
          kycRes = await executeAutoVerifyForSellOrder({
            orderNumber,
            livenessCompleted: true,
            binanceLivenessSignal: fromBinance,
            retryNow: true,
          });
        }
        if (kycRes.verified && !kycRes.skipped) {
          autoVerifyNote = " Detail rekening pembayaran telah berhasil dibuka ke buyer di Binance.";
        } else if (!kycRes.verified) {
          autoVerifyNote = ` Auto-verify: ${kycRes.message}`;
        }
      } else {
        autoVerifyNote =
          " Auto-verify NONAKTIF di pengaturan, jadi rekening belum dibuka: tekan Auto-Verif manual atau aktifkan auto-verify.";
      }
    } catch (err) {
      console.debug("[AUTO-VERIFY] Error saat panggil executeAutoVerifyForSellOrder:", err);
    }

    return {
      ok: true,
      isLiveness: true,
      isCompleted: true,
      orderNumber,
      record: newRecord,
      message: `✅ Order #${orderNumber}: buyer selesai liveness check.${autoVerifyNote}`,
    };
  }

// ── Server Function: Setel Status Liveness Manual (1-Click di Tabel Order) ──
const setOrderLivenessStatusSchema = z.object({
  sessionToken: z.string().optional(),
  orderNumber: z.string().min(1),
  completed: z.boolean(),
  counterPartNickName: z.string().optional(),
});

export const setOrderLivenessStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setOrderLivenessStatusSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; orderNumber: string; completed: boolean; message?: string }> => {
    await requireSession(data.sessionToken);

    if (!data.completed) {
      await deleteLivenessRecordInternal(data.orderNumber);
      try {
        const { unmarkOrderKycVerified } = await import("./binance-merchant");
        unmarkOrderKycVerified(data.orderNumber);
      } catch {}
      return { ok: true, orderNumber: data.orderNumber, completed: false, message: "Status liveness order telah dibatalkan." };
    }

    const newRecord: OrderLivenessRecord = {
      orderNumber: data.orderNumber,
      status: "COMPLETED",
      verifiedAt: new Date().toISOString(),
      verificationTimeText: new Date().toLocaleString("id-ID"),
      requester: "Merchant (Manual Auto-Verif)",
      ...(data.counterPartNickName ? { counterPartNickName: data.counterPartNickName } : {}),
      source: "manual_click",
      trusted: true,
    };

    await saveLivenessRecordInternal(newRecord);
    await notifyLivenessCompleted(newRecord);

    let kycMsg = "Order berhasil diverifikasi & notifikasi terkirim.";
    // Tombol merchant: buka payment details secara manual (melewati syarat sinyal otomatis)
    try {
      const { executeAutoVerifyForSellOrder } = await import("./binance-merchant");
      const kycRes = await executeAutoVerifyForSellOrder({
        orderNumber: data.orderNumber,
        livenessCompleted: true,
        manual: true,
      });
      if (kycRes.message) {
        kycMsg = kycRes.message;
      }
    } catch {}

    return { ok: true, orderNumber: data.orderNumber, completed: true, message: kycMsg };
  });

// ── Webhook Handler untuk Integrasi Eksternal ────────────────────────────────
/**
 * Webhook publik: siapa pun yang tahu URL-nya bisa mengirim teks. Hanya request yang membawa
 * WEBHOOK_SECRET yang benar (opts.trusted, dicek di src/server.ts) boleh memicu auto-verify.
 * Tanpa secret, pesan hanya dicatat sebagai sinyal TIDAK tepercaya (payment details tidak dibuka).
 */
export async function handleIncomingChatMessageWebhook(body: any, opts: { trusted?: boolean } = {}): Promise<any> {
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
    trusted: opts.trusted === true,
    rawSnippet: text.slice(0, 300),
  };

  if (!opts.trusted) {
    // Jangan tandai COMPLETED dan jangan kirim notifikasi "buyer lolos" dari sumber yang tidak terautentikasi
    console.warn(`[LIVENESS] Webhook liveness tanpa WEBHOOK_SECRET yang valid untuk order #${finalOrderNo} diabaikan.`);
    return {
      ok: false,
      error: "UNTRUSTED_WEBHOOK",
      message:
        "Webhook liveness ditolak: sertakan ?secret=<WEBHOOK_SECRET> atau header x-webhook-secret. Payment details TIDAK dibuka.",
    };
  }

  await saveLivenessRecordInternal(newRecord);
  await notifyLivenessCompleted(newRecord);

  // Eksekusi auto-verify ke Binance SAPI (syarat keamanan dicek di dalam fungsi)
  let verifyMessage = "";
  try {
    const settings = await getVerifierSettingsInternal();
    if (settings.liveness_enabled !== false && settings.auto_verify_on_buyer_payed !== false) {
      const { executeAutoVerifyForSellOrder } = await import("./binance-merchant");
      const res = await executeAutoVerifyForSellOrder({
        orderNumber: finalOrderNo,
        livenessCompleted: true,
      });
      verifyMessage = res.message;
    } else {
      verifyMessage = "Auto-verify nonaktif di pengaturan.";
    }
  } catch {}

  return {
    ok: true,
    message: `Order #${finalOrderNo} verifikasi wajah tercatat. ${verifyMessage}`.trim(),
    record: newRecord,
  };
}

// Re-export method C2C API untuk kemudahan integrasi
export {
  verifiedAdditionalKyc,
  getUserOrderDetail,
  executeAutoVerifyForSellOrder,
  verifyAdditionalKycOrder,
  isOrderKycVerified,
  unmarkOrderKycVerified,
} from "./binance-merchant";

