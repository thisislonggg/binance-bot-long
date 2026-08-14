import { type Ad, fmtRp, fmtRp2 } from "@/lib/p2p-engine";
import { cn } from "@/lib/utils";

export function AdsTable({
  ads,
  side,
  emptyLabel = "Tidak ada iklan yang lolos filter likuiditas.",
}: {
  ads?: Ad[];
  side: "bid" | "ask";
  emptyLabel?: string;
}) {
  const safeAds = Array.isArray(ads) ? ads : [];

  if (!safeAds.length) {
    return <p className="px-1 py-8 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  // Hitung max volume untuk depth bar visualizer
  const maxAvailable = Math.max(...safeAds.map((a) => Number(a?.available_idr) || 1), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/80 text-[0.65rem] tracking-[0.14em] text-muted-foreground uppercase">
            <th className="py-2.5 pr-4 text-left font-semibold">Harga (IDR)</th>
            <th className="py-2.5 pr-4 text-right font-semibold">Stok Likuiditas</th>
            <th className="hidden py-2.5 pr-4 text-right font-semibold sm:table-cell">Limit Transaksi</th>
            <th className="py-2.5 text-left font-semibold">Merchant & Pembayaran</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {safeAds.map((a, i) => {
            const price = Number(a?.price) || 0;
            const availableIdr = Number(a?.available_idr) || 0;
            const minLimit = Number(a?.min_limit_idr) || 0;
            const maxLimit = Number(a?.max_limit_idr) || 0;
            const depthPercent = Math.min(100, Math.round((availableIdr / maxAvailable) * 100));
            const payMethods = Array.isArray(a?.pay_methods) ? a.pay_methods : [];

            return (
              <tr
                key={a?.adv_no ?? i}
                className="group relative transition-colors hover:bg-surface-2/60"
              >
                {/* Harga dengan depth bar background */}
                <td className="relative py-2.5 pr-4 font-semibold">
                  <div
                    className={cn(
                      "absolute top-0 bottom-0 left-0 opacity-15 pointer-events-none transition-all",
                      side === "bid" ? "bg-bid" : "bg-ask",
                    )}
                    style={{ width: `${depthPercent}%` }}
                  />
                  <span className={cn("num relative font-bold text-sm", side === "bid" ? "text-bid" : "text-ask")}>
                    {fmtRp2(price)}
                  </span>
                </td>

                {/* Stok Tersedia */}
                <td className="num py-2.5 pr-4 text-right font-medium text-foreground/90">
                  {fmtRp(availableIdr)}
                </td>

                {/* Limit */}
                <td className="num hidden py-2.5 pr-4 text-right text-muted-foreground sm:table-cell">
                  {fmtRp(minLimit)} – {fmtRp(maxLimit)}
                </td>

                {/* Merchant & Metode Pembayaran */}
                <td className="py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-foreground/90 group-hover:text-foreground">
                      {a?.merchant_name ?? "—"}
                    </span>
                    {a?.user_type === "merchant" ? (
                      <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[0.58rem] font-bold tracking-wider text-primary uppercase">
                        PRO MERCHANT
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {payMethods.slice(0, 3).map((pm) => (
                      <span
                        key={pm}
                        className="rounded border border-border bg-surface-2/80 px-1.5 py-0.2 text-[0.62rem] text-muted-foreground"
                      >
                        {pm}
                      </span>
                    ))}
                    {payMethods.length > 3 && (
                      <span className="text-[0.6rem] text-muted-foreground">
                        +{payMethods.length - 3} lainnya
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
