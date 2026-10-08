import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  getBinanceChatCredentials,
  parseLivenessChatMessage,
  processLivenessChatMessage,
  setOrderLivenessStatus,
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
  const triggeringOrders = useRef<Set<string>>(new Set());
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

  // Mutasi setel status liveness jika terdeteksi order aktif yang belum terverifikasi
  const setStatusMutation = useMutation({
    mutationFn: (args: { orderNumber: string; completed: boolean; counterPartNickName?: string }) =>
      setOrderLivenessStatus({
        data: {
          sessionToken: sessionToken ?? undefined,
          orderNumber: args.orderNumber,
          completed: args.completed,
          counterPartNickName: args.counterPartNickName,
        },
      }),
    onSuccess: (res) => {
      if (res.completed) {
        saveLocalVerifiedOrder(res.orderNumber);
        queryClient.invalidateQueries({ queryKey: ["payment-verifier-state"] });
      }
    },
  });

  // Watchdog: Pantau perubahan status auto-verifikasi order & eksekusi auto-verif
  useEffect(() => {
    const orders = verifierQuery.data?.activeOrders;
    if (!orders || !Array.isArray(orders)) return;

    const settings = verifierQuery.data?.settings;
    const isAutoVerify = settings?.auto_verify_on_buyer_payed !== false;
    const verifyMode = settings?.auto_verify_mode || "all_active";

    for (const ord of orders) {
      if (ord.livenessVerified) {
        if (!previouslyVerifiedOrders.current.has(ord.orderNumber)) {
          previouslyVerifiedOrders.current.add(ord.orderNumber);
          saveLocalVerifiedOrder(ord.orderNumber);

          const sound = settings?.sound_enabled ?? true;
          if (sound) playLivenessChime();

          const shortNo = ord.orderNumber.length > 8 ? ord.orderNumber.slice(-8) : ord.orderNumber;
          toast.success(
            `✅ Order #${shortNo} (@${ord.counterPartNickName}) Berhasil Di-Auto-Verifikasi! Buyer Lolos Liveness.`,
            { duration: 8000 }
          );
        }
      } else if (livenessEnabled && isAutoVerify && !triggeringOrders.current.has(ord.orderNumber)) {
        // Watchdog: jika order aktif tapi server belum menandai verified, client langsung trigger auto-verif
        const statusUpper = (ord.orderStatus || "").toUpperCase();
        const isBuyerPayed =
          statusUpper.includes("PAYED") ||
          statusUpper.includes("PAID") ||
          statusUpper.includes("RELEASE") ||
          statusUpper === "2";

        const shouldVerify =
          verifyMode === "chat_only"
            ? false
            : verifyMode === "buyer_payed"
            ? isBuyerPayed
            : true;

        if (shouldVerify) {
          triggeringOrders.current.add(ord.orderNumber);
          saveLocalVerifiedOrder(ord.orderNumber);
          setStatusMutation.mutate({
            orderNumber: ord.orderNumber,
            completed: true,
            counterPartNickName: ord.counterPartNickName,
          });
        }
      }
    }
  }, [verifierQuery.data?.activeOrders, verifierQuery.data?.settings, livenessEnabled]);

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
    mutationFn: (args: { chatText: string; orderNumberHint?: string; source?: any }) =>
      processLivenessChatMessage({
        data: {
          sessionToken: sessionToken ?? undefined,
          chatText: args.chatText,
          orderNumberHint: args.orderNumberHint,
          source: args.source || "binance_chat_ws",
        },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        if (res.orderNumber) {
          saveLocalVerifiedOrder(res.orderNumber);
        }
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
      return;
    }

    let isDestroyed = false;

    function connectWs() {
      if (isDestroyed) return;

      try {
        const baseWs = creds.chatWssUrl!.startsWith("wss://") || creds.chatWssUrl!.startsWith("ws://")
          ? creds.chatWssUrl!
          : `wss://${creds.chatWssUrl!}`;
        const url = `${baseWs}/${creds.listenKey}?token=${creds.listenToken}&clientType=web`;

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
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
            let payload: any = raw;
            if (typeof raw === "string") {
              try {
                payload = JSON.parse(raw);
              } catch {
                payload = raw;
              }
            }

            const content = typeof payload === "string"
              ? payload
              : payload?.data?.content || payload?.content || payload?.text || JSON.stringify(payload);

            const parsed = parseLivenessChatMessage(content);
            if (parsed.isLivenessMessage && parsed.isCompleted) {
              const orderHint =
                parsed.orderNumber ||
                payload?.data?.orderNo ||
                payload?.data?.orderNumber ||
                payload?.orderNo ||
                payload?.orderNumber;

              if (orderHint) {
                saveLocalVerifiedOrder(orderHint);
              }

              processChatMutation.mutate({
                chatText: content,
                orderNumberHint: orderHint,
                source: "binance_chat_ws",
              });
            }
          } catch {}
        };

        ws.onclose = () => {
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
