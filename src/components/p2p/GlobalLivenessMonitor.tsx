import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  getBinanceChatCredentials,
  parseLivenessChatMessage,
  processLivenessChatMessage,
} from "@/lib/liveness-verifier";
import { getVerifierState } from "@/lib/payment-verifier";

const LOCAL_STORAGE_KEY = "binance_verified_liveness_orders_cache";

export function getLocalVerifiedOrders(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {}
  return new Set();
}

export function saveLocalVerifiedOrder(orderNo: string) {
  if (typeof window === "undefined" || !orderNo) return;
  try {
    const set = getLocalVerifiedOrders();
    set.add(orderNo);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(Array.from(set).slice(-100)));
  } catch {}
}

// ── Log Diagnostik Liveness (koneksi WebSocket chat & pesan mentah dari Binance) ──
// Disimpan di localStorage agar merchant bisa menyalin & mengirimkannya saat auto-verify
// tidak mendeteksi liveness. Format pesan kartu liveness Binance tidak terdokumentasi publik.
const DIAG_STORAGE_KEY = "p2p_liveness_diagnostics";
export const LIVENESS_DIAG_EVENT = "p2p-liveness-diag";

export type LivenessDiagEntry = { t: string; kind: string; detail: string };

export function getLivenessDiagnostics(): LivenessDiagEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DIAG_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function clearLivenessDiagnostics() {
  try {
    localStorage.removeItem(DIAG_STORAGE_KEY);
    window.dispatchEvent(new Event(LIVENESS_DIAG_EVENT));
  } catch {}
}

function logLivenessDiag(kind: string, detail: unknown) {
  if (typeof window === "undefined") return;
  try {
    const text = typeof detail === "string" ? detail : JSON.stringify(detail);
    const entry: LivenessDiagEntry = {
      t: new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }),
      kind,
      detail: text.slice(0, 1500),
    };
    const next = [...getLivenessDiagnostics(), entry].slice(-60);
    localStorage.setItem(DIAG_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(LIVENESS_DIAG_EVENT));
  } catch {}
}

function playLivenessChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    };

    playTone(523.25, now, 0.12);        // C5
    playTone(659.25, now + 0.1, 0.12);  // E5
    playTone(783.99, now + 0.2, 0.15);  // G5
    playTone(1046.5, now + 0.32, 0.35); // C6
  } catch {}
}

export function GlobalLivenessMonitor({ sessionToken }: { sessionToken?: string | null }) {
  const queryClient = useQueryClient();
  const previouslyVerifiedOrders = useRef<Set<string>>(getLocalVerifiedOrders());
  const notifiedFailures = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // 1. Polling State Verifier Secara Global tiap 7 detik
  const verifierQuery = useQuery({
    queryKey: ["payment-verifier-state"],
    queryFn: () => getVerifierState({ data: { sessionToken: sessionToken ?? undefined } }),
    enabled: Boolean(sessionToken),
    refetchInterval: 7_000,
  });

  const livenessEnabled = verifierQuery.data?.settings?.liveness_enabled !== false;

  // Watchdog: hanya MEMANTAU & memberi notifikasi. Keputusan auto-verify sepenuhnya di server
  // (getVerifierState), yang menegakkan syarat keamanan & sakelar pengaturan.
  useEffect(() => {
    const orders = verifierQuery.data?.activeOrders;
    if (!orders || !Array.isArray(orders)) return;
    const sound = verifierQuery.data?.settings?.sound_enabled ?? true;

    for (const ord of orders) {
      const shortNo = ord.orderNumber.length > 8 ? ord.orderNumber.slice(-8) : ord.orderNumber;

      // Payment details benar-benar terbuka (Binance / server mengonfirmasi verifikasi)
      if (ord.kycVerifiedInBinance && !previouslyVerifiedOrders.current.has(ord.orderNumber)) {
        previouslyVerifiedOrders.current.add(ord.orderNumber);
        saveLocalVerifiedOrder(ord.orderNumber);
        if (sound) playLivenessChime();
        toast.success(
          `✅ Order #${shortNo} (@${ord.counterPartNickName}): buyer lolos liveness & payment details terbuka.`,
          { duration: 8000 },
        );
        continue;
      }

      // Binance menolak verifikasi: beri tahu sekali per percobaan
      const av = ord.autoVerify;
      if (av?.state === "failed") {
        const key = `${ord.orderNumber}:${av.attempts}`;
        if (!notifiedFailures.current.has(key)) {
          notifiedFailures.current.add(key);
          toast.error(`Auto-verify order #${shortNo} gagal: ${av.message}`, { duration: 10000 });
        }
      }
    }
  }, [verifierQuery.data?.activeOrders, verifierQuery.data?.settings]);

  // 2. Kredensial WebSocket Chat Binance SAPI
  const chatCredsQuery = useQuery({
    queryKey: ["binance-chat-creds"],
    queryFn: () => getBinanceChatCredentials({ data: { sessionToken: sessionToken ?? undefined } }),
    enabled: Boolean(sessionToken) && livenessEnabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Mutasi memproses pesan chat dari WebSocket
  const processChatMutation = useMutation({
    mutationFn: (args: {
      chatText: string;
      orderNumberHint?: string;
      messageType?: string;
      fromSelf?: boolean;
      envelopeOrderNo?: string;
    }) =>
      processLivenessChatMessage({
        data: {
          sessionToken: sessionToken ?? undefined,
          chatText: args.chatText,
          orderNumberHint: args.orderNumberHint,
          source: "binance_chat_ws",
          messageType: args.messageType,
          fromSelf: args.fromSelf,
          envelopeOrderNo: args.envelopeOrderNo,
        },
      }),
    onSuccess: (res) => {
      logLivenessDiag("server_result", res.message);
      if (res.untrusted) {
        toast.warning(res.message, { duration: 12000 });
        return;
      }
      if (res.ok) {
        playLivenessChime();
        toast.success(res.message, { duration: 8000 });
        queryClient.invalidateQueries({ queryKey: ["payment-verifier-state"] });
      }
    },
  });

  // 3. Koneksi WebSocket Background dengan Ping Keepalive (Tiap 25 detik)
  useEffect(() => {
    if (!sessionToken || !livenessEnabled) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      return;
    }

    const creds = chatCredsQuery.data;
    if (!creds?.ok || !creds.chatWssUrl || !creds.listenKey) {
      if (creds) {
        logLivenessDiag(
          "chat_credentials_error",
          creds.error || `Kredensial chat tidak lengkap (wss=${Boolean(creds.chatWssUrl)}, listenKey=${Boolean(creds.listenKey)})`,
        );
      }
      return;
    }

    let isDestroyed = false;

    function connectWs() {
      if (isDestroyed) return;

      try {
        const rawWss = (creds.chatWssUrl || "").trim();
        const baseWs = rawWss.startsWith("wss://") || rawWss.startsWith("ws://")
          ? rawWss
          : `wss://${rawWss}`;
        const cleanBaseWs = baseWs.replace(/\/+$/, "");
        const url = `${cleanBaseWs}/${creds.listenKey}?token=${creds.listenToken}&clientType=web`;

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          logLivenessDiag("ws_open", `Terhubung ke chat Binance (${cleanBaseWs})`);
          // Kirim ping tiap 25 detik agar koneksi Binance tidak terputus
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: "ping" }));
              } catch {}
            }
          }, 25_000);
        };

        ws.onmessage = (event) => {
          try {
            const raw = event.data;
            const rawText = typeof raw === "string" ? raw : "[binary]";
            if (!/"type"\s*:\s*"pong"/i.test(rawText)) logLivenessDiag("ws_message", rawText);
            let payload: any = raw;
            if (typeof raw === "string") {
              try {
                payload = JSON.parse(raw);
              } catch {
                payload = raw;
              }
            }

            // Handle array of messages atau single message
            const items = Array.isArray(payload) ? payload : [payload];
            for (const item of items) {
              if (!item) continue;
              const msgType = String(item?.type || item?.msgType || item?.data?.type || "").toLowerCase();
              const isSystemOrCard = msgType === "system" || msgType === "card" || msgType.includes("sys");

              // Isi kartu sistem Binance bisa berupa OBJEK (bukan string). Dulu objek ini membuat
              // parser crash diam-diam (.trim pada objek) sehingga kartu liveness tidak pernah terdeteksi.
              const rawContent =
                typeof item === "string"
                  ? item
                  : item?.data?.content ??
                    item?.content ??
                    item?.text ??
                    item?.data?.text ??
                    item?.message ??
                    (isSystemOrCard ? item : "");
              const content =
                typeof rawContent === "string" ? rawContent : rawContent ? JSON.stringify(rawContent) : "";

              const parsed = parseLivenessChatMessage(content);
              if (parsed.isLivenessMessage) {
                logLivenessDiag(
                  "liveness_detected",
                  `type=${msgType || "?"} self=${String(item?.self)} orderNo=${item?.orderNo || "-"} completed=${parsed.isCompleted} status=${parsed.status} order=${parsed.orderNumber || "-"}`,
                );
              }
              if (parsed.isLivenessMessage && parsed.isCompleted) {
                const orderHint =
                  parsed.orderNumber ||
                  item?.data?.orderNo ||
                  item?.data?.orderNumber ||
                  item?.orderNo ||
                  item?.orderNumber ||
                  item?.params?.orderNo ||
                  item?.params?.orderNumber;

                // Metadata amplop (tipe pesan, pengirim, order chat) ditentukan Binance, bukan oleh isi
                // pesan yang bisa diketik buyer. Server memakainya untuk menolak liveness palsu.
                const envelopeOrderNo = item?.orderNo || item?.data?.orderNo || item?.orderNumber || item?.data?.orderNumber;
                const fromSelf =
                  typeof item?.self === "boolean" ? item.self : typeof item?.data?.self === "boolean" ? item.data.self : undefined;

                processChatMutation.mutate({
                  chatText: content,
                  orderNumberHint: orderHint,
                  messageType: msgType,
                  ...(fromSelf !== undefined ? { fromSelf } : {}),
                  ...(envelopeOrderNo ? { envelopeOrderNo: String(envelopeOrderNo) } : {}),
                });
              }
            }
          } catch (err) {
            logLivenessDiag("ws_parse_error", String(err));
          }
        };

        ws.onclose = (ev) => {
          logLivenessDiag("ws_closed", `code=${ev.code} reason=${ev.reason || "-"}`);
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          if (!isDestroyed) {
            // Auto reconnect setelah 5 detik
            reconnectTimeoutRef.current = setTimeout(connectWs, 5_000);
          }
        };

        ws.onerror = () => {
          // onerror akan mentrigger onclose secara otomatis
        };
      } catch {}
    }

    connectWs();

    return () => {
      isDestroyed = true;
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [chatCredsQuery.data, livenessEnabled, sessionToken]);

  return null;
}
