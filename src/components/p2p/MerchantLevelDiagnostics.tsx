import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getMerchantLevelSample, type MerchantLevelSample } from "@/lib/p2p.functions";

const LEVEL_LABEL: Record<string, string> = {
  block: "💎 Block",
  gold: "🥇 Gold",
  silver: "🥈 Silver",
  bronze: "🥉 Bronze",
  regular: "👤 Regular",
};

/**
 * Ambil data mentah advertiser dari Binance (lewat server) untuk mencocokkan level yang
 * terdeteksi bot dengan badge asli di aplikasi Binance. Hanya berjalan saat tombol diklik.
 */
export function MerchantLevelDiagnostics({ sessionToken }: { sessionToken?: string | undefined }) {
  const fetchSample = useServerFn(getMerchantLevelSample);
  const [samples, setSamples] = useState<MerchantLevelSample[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchSample({ data: { sessionToken } });
      if (!res.ok) toast.error(`Gagal mengambil data Binance: ${res.error}`);
      setSamples(res.samples);
    } catch (err) {
      toast.error(`Gagal mengambil data Binance: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!samples) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ generatedAt: new Date().toISOString(), samples }, null, 1));
      toast.success("Data level merchant disalin. Tempel (paste) ke chat untuk dianalisis.");
    } catch {
      toast.error("Gagal menyalin otomatis.");
    }
  };

  const fields = (a: MerchantLevelSample["advertiser"]) =>
    ["userType", "userIdentity", "userGrade", "vipLevel", "proMerchant"]
      .filter((k) => a[k] !== undefined && a[k] !== null && a[k] !== "")
      .map((k) => `${k}=${String(a[k])}`)
      .join(" · ");

  return (
    <div className="rounded-lg border border-border/70 bg-surface-2/40 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-foreground">Cek Level Merchant vs Binance</div>
          <p className="text-[0.68rem] text-muted-foreground">
            Ambil 60 iklan teratas per sisi dari Binance, lalu bandingkan level terdeteksi dengan badge di aplikasi Binance.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-[0.7rem]" onClick={load} disabled={loading}>
            {loading ? "Mengambil…" : "Ambil Data"}
          </Button>
          {samples && samples.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-[0.7rem]" onClick={copy}>
              Salin Data
            </Button>
          )}
        </div>
      </div>
      {samples && (
        <div className="max-h-80 overflow-auto rounded-md border border-border/60">
          <table className="w-full text-[0.65rem]">
            <thead className="sticky top-0 bg-surface-2 text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">Sisi</th>
                <th className="px-2 py-1 text-left">Merchant</th>
                <th className="px-2 py-1 text-left">Terdeteksi</th>
                <th className="px-2 py-1 text-left">Field Binance</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={`${s.side}-${s.rank}-${s.nickName}`} className="border-t border-border/40">
                  <td className="px-2 py-1">{s.side === "SELL" ? "Jual" : "Beli"} #{s.rank}</td>
                  <td className="px-2 py-1 font-medium text-foreground">{s.nickName}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{LEVEL_LABEL[s.detectedLevel] ?? s.detectedLevel}</td>
                  <td className="px-2 py-1 font-mono text-muted-foreground break-all">{fields(s.advertiser) || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
