import { type Ad, fmtRp, fmtRp2 } from "@/lib/p2p-engine";
import { cn } from "@/lib/utils";

export function AdsTable({
  ads,
  side,
  emptyLabel = "Tidak ada iklan yang lolos filter.",
}: {
  ads: Ad[];
  side: "bid" | "ask";
  emptyLabel?: string;
}) {
  if (!ads.length) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[0.68rem] tracking-[0.12em] text-muted-foreground uppercase">
            <th className="py-2 pr-3 text-left font-medium">Harga</th>
            <th className="py-2 pr-3 text-right font-medium">Stok tersedia</th>
            <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Limit</th>
            <th className="py-2 text-left font-medium">Merchant</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ads.map((a, i) => (
            <tr key={a.adv_no ?? i} className="align-top">
              <td className={cn("num py-2.5 pr-3 font-semibold", side === "bid" ? "text-bid" : "text-ask")}>
                {fmtRp2(a.price)}
              </td>
              <td className="num py-2.5 pr-3 text-right text-foreground/85">{fmtRp(a.available_idr)}</td>
              <td className="num hidden py-2.5 pr-3 text-right text-muted-foreground sm:table-cell">
                {fmtRp(a.min_limit_idr)} – {fmtRp(a.max_limit_idr)}
              </td>
              <td className="py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-foreground/90">{a.merchant_name}</span>
                  {a.user_type === "merchant" ? (
                    <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wider text-primary uppercase">
                      merchant
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {a.pay_methods.slice(0, 3).join(" · ") || "—"}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
