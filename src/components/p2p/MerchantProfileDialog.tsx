import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMerchantProfile, type MerchantProfileAd } from "@/lib/merchant-profile";
import { cn } from "@/lib/utils";

export type MerchantProfileTarget = { merchantNo: string; name: string };

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const compactRp = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt` : `${Math.round(n / 1_000).toLocaleString("id-ID")} rb`;
const secs = (s: number | null) => {
  if (s === null) return "—";
  if (s < 60) return `${Math.round(s)} dtk`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `${m} mnt ${r} dtk` : `${m} mnt`;
};
const n0 = (v: number | null) => (v === null ? "—" : v.toLocaleString("id-ID"));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface-2/60 px-3 py-2">
      <div className="text-[0.65rem] text-muted-foreground">{label}</div>
      <div className="num text-sm font-semibold text-foreground">{value}</div>
      {hint ? <div className="text-[0.6rem] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function AdList({ title, ads }: { title: string; ads: MerchantProfileAd[] }) {
  const totalUsdt = ads.reduce((s, a) => s + a.surplusUsdt, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-foreground">
          {title} ({ads.length})
        </span>
        {ads.length > 0 && (
          <span className="num text-[0.68rem] text-muted-foreground">
            Total stok {Math.round(totalUsdt).toLocaleString("id-ID")} USDT
          </span>
        )}
      </div>
      {ads.length === 0 ? (
        <p className="text-[0.7rem] text-muted-foreground">Tidak ada iklan.</p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
          {ads.map((a) => (
            <li key={a.advNo} className="space-y-0.5 px-3 py-2 text-[0.72rem]">
              <div className="flex items-center justify-between gap-2">
                <span className="num font-bold text-foreground">{rp(a.price)}</span>
                <span className={cn("text-[0.62rem] font-semibold", a.online ? "text-bid" : "text-muted-foreground")}>
                  {a.online ? "Online" : "Offline"}
                </span>
              </div>
              <div className="num text-muted-foreground">
                {Math.round(a.surplusUsdt).toLocaleString("id-ID")} USDT · limit {compactRp(a.minLimitIdr)}–{compactRp(a.maxLimitIdr)}
                {a.payTimeLimit ? ` · bayar ${a.payTimeLimit} mnt` : ""}
              </div>
              <div className="truncate text-muted-foreground" title={a.payMethods.join(", ")}>
                {a.payMethods.join(", ") || "—"}
              </div>
              {a.remarks && (
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer text-[0.65rem] hover:text-foreground">Catatan iklan</summary>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[0.65rem]">{a.remarks}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MerchantProfileDialog({
  target,
  sessionToken,
  onClose,
}: {
  target: MerchantProfileTarget | null;
  sessionToken?: string | null | undefined;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["merchant-profile", target?.merchantNo],
    queryFn: () => getMerchantProfile({ data: { sessionToken: sessionToken ?? undefined, merchantNo: target!.merchantNo } }),
    enabled: Boolean(target && sessionToken),
    staleTime: 60_000,
  });
  const p = query.data;
  const m = p?.merchant;
  const multiSell = (p?.sellAds.filter((a) => a.online).length ?? 0) > 1;
  const multiBuy = (p?.buyAds.filter((a) => a.online).length ?? 0) > 1;

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m?.nickName || target?.name || "Profil merchant"}</DialogTitle>
          <DialogDescription>Statistik 30 hari & semua iklan merchant ini di Binance P2P.</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat profil…
          </div>
        ) : !p || !p.ok || !m ? (
          <p className="py-6 text-center text-xs text-ask">Gagal memuat profil: {p?.error ?? "tidak ada data"}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Order 30 hari" value={n0(m.completed30d ?? m.monthOrderCount)} hint={`${n0(m.orderCount)} total`} />
              <Stat label="Tingkat selesai" value={m.monthFinishRatePct === null ? "—" : `${m.monthFinishRatePct}%`} />
              <Stat label="Umur akun" value={m.registerDays === null ? "—" : `${n0(m.registerDays)} hari`} />
              <Stat label="Rata-rata release" value={secs(m.avgReleaseSec30d)} hint="30 hari" />
              <Stat label="Rata-rata bayar" value={secs(m.avgPaySec30d)} hint="30 hari" />
              <Stat label="Tipe" value={m.userType === "merchant" ? "Merchant" : m.userType || "—"} />
            </div>

            {(multiSell || multiBuy) && (
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[0.7rem] text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Merchant ini memasang lebih dari satu iklan online di sisi {multiSell && multiBuy ? "jual & beli" : multiSell ? "jual" : "beli"}.
                  Perhatikan bila iklan-iklannya berderet di pucuk (bisa jadi pancingan bertumpuk).
                </span>
              </div>
            )}

            <AdList title="Iklan jual" ads={p.sellAds} />
            <AdList title="Iklan beli" ads={p.buyAds} />
            <p className="text-[0.6rem] text-muted-foreground">
              Diperbarui {new Date(p.fetchedAt).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB · data dari Binance, disimpan sementara 1 menit.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
