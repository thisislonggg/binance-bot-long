import { Pencil, Trash2 } from "lucide-react";

import { fmtRp2 } from "@/lib/p2p-engine";
import type { Trade } from "@/lib/pnl";
import { cn } from "@/lib/utils";

export function TradesTable({
  trades,
  emptyLabel = "Belum ada transaksi tercatat.",
  onEdit,
  onDelete,
  editingId,
  deletingId,
}: {
  trades: Trade[];
  emptyLabel?: string;
  onEdit?: (trade: Trade) => void;
  onDelete?: (trade: Trade) => void;
  editingId?: number | null;
  deletingId?: number | null;
}) {
  if (!trades.length) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[0.68rem] tracking-[0.12em] text-muted-foreground uppercase">
            <th className="py-2 pr-3 text-left font-medium">Waktu</th>
            <th className="py-2 pr-3 text-left font-medium">Sisi</th>
            <th className="py-2 pr-3 text-right font-medium">Harga</th>
            <th className="py-2 pr-3 text-right font-medium">Jumlah (USDT)</th>
            <th className="py-2 pr-3 text-left font-medium">Catatan</th>
            {(onEdit || onDelete) && <th className="py-2 text-right font-medium">Aksi</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {trades.map((t) => (
            <tr key={t.id} className={cn("align-top", editingId === t.id && "bg-primary/5")}>
              <td className="num py-2.5 pr-3 text-muted-foreground">
                {new Date(t.ts).toLocaleString("id-ID", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="py-2.5 pr-3">
                <span
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wider uppercase",
                    t.side === "buy" ? "bg-bid/15 text-bid" : "bg-ask/15 text-ask",
                  )}
                >
                  {t.side === "buy" ? "Beli" : "Jual"}
                </span>
              </td>
              <td className="num py-2.5 pr-3 text-right font-semibold text-foreground/90">
                {fmtRp2(t.price)}
              </td>
              <td className="num py-2.5 pr-3 text-right text-foreground/85">
                {t.amount_usdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
              </td>
              <td className="py-2.5 pr-3 text-muted-foreground">{t.note || "—"}</td>
              {(onEdit || onDelete) && (
                <td className="py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {onEdit ? (
                      <button
                        type="button"
                        onClick={() => onEdit(t)}
                        title="Edit transaksi"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button
                        type="button"
                        onClick={() => onDelete(t)}
                        disabled={deletingId === t.id}
                        title="Hapus transaksi"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive-foreground disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
