import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActiveP2pOrder } from "@/lib/payment-verifier";

import {
  clearLivenessDiagnostics,
  getLivenessDiagnostics,
  LIVENESS_DIAG_EVENT,
  type LivenessDiagEntry,
} from "./GlobalLivenessMonitor";

/**
 * Panel diagnostik auto-verify liveness: status koneksi chat Binance, pesan mentah terakhir,
 * dan detail order mentah. Merchant cukup menekan "Salin Log" lalu mengirimkannya untuk analisis
 * bila bot tidak mendeteksi buyer yang sudah lolos verifikasi wajah.
 */
export function LivenessDiagnostics({ activeOrders }: { activeOrders: ActiveP2pOrder[] }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LivenessDiagEntry[]>([]);

  useEffect(() => {
    const refresh = () => setEntries(getLivenessDiagnostics());
    refresh();
    window.addEventListener(LIVENESS_DIAG_EVENT, refresh);
    return () => window.removeEventListener(LIVENESS_DIAG_EVENT, refresh);
  }, []);

  const lastConn = [...entries]
    .reverse()
    .find((e) => e.kind.startsWith("ws_") || e.kind === "chat_credentials_error");
  const connLabel = !lastConn
    ? "Belum ada aktivitas koneksi chat"
    : lastConn.kind === "chat_credentials_error"
      ? `Gagal ambil kredensial chat: ${lastConn.detail}`
      : lastConn.kind === "ws_closed"
        ? `Terputus (${lastConn.t}) · ${lastConn.detail}`
        : `Terhubung / aktif (${lastConn.t})`;
  const connOk =
    lastConn && lastConn.kind !== "chat_credentials_error" && lastConn.kind !== "ws_closed";
  const messageCount = entries.filter((e) => e.kind === "ws_message").length;
  const livenessCount = entries.filter((e) => e.kind === "liveness_detected").length;

  const copyLog = async () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      connection: connLabel,
      entries,
      sellOrders: activeOrders
        .filter((o) => o.tradeType === "SELL")
        .map((o) => ({
          orderNumber: o.orderNumber,
          orderStatus: o.orderStatus,
          additionalKycVerify: o.additionalKycVerify,
          additionalKycStatus: o.additionalKycStatus,
          livenessVerified: o.livenessVerified,
          kycVerifiedInBinance: o.kycVerifiedInBinance,
          autoVerify: o.autoVerify,
          livenessSource: o.livenessRecord?.source,
          debugDetail: o.debugDetail,
        })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success("Log diagnostik disalin. Tempel (paste) ke chat untuk dianalisis.");
    } catch {
      toast.error("Gagal menyalin otomatis. Blok teks log di bawah lalu salin manual.");
      setOpen(true);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-surface/60 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="font-semibold text-foreground">Diagnostik Auto-Verify Liveness</div>
          <div className={connOk ? "text-emerald-400" : "text-amber-400"}>
            Chat Binance: {connLabel}
          </div>
          <div className="text-muted-foreground">
            {messageCount} pesan chat terekam · {livenessCount} pesan liveness terdeteksi
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-[0.7rem]" onClick={copyLog}>
            Salin Log
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[0.7rem]"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Sembunyikan" : "Lihat Detail"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[0.7rem] text-muted-foreground"
            onClick={clearLivenessDiagnostics}
          >
            Hapus
          </Button>
        </div>
      </div>
      {open && (
        <div className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-background/60 p-2 font-mono text-[0.65rem] leading-relaxed">
          {entries.length === 0 ? (
            <div className="text-muted-foreground">
              Belum ada log. Biarkan dashboard terbuka saat ada order masuk.
            </div>
          ) : (
            [...entries].reverse().map((e, i) => (
              <div key={i} className="border-b border-border/30 py-1 break-all">
                <span className="text-muted-foreground">{e.t}</span>{" "}
                <span className="text-sky-400">{e.kind}</span> {e.detail}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
