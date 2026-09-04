import { ChevronLeft, ChevronRight, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { fmtRp, fmtRp2 } from "@/lib/p2p-engine";
import { normalizeTradePrice, type Trade } from "@/lib/pnl";
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
  const [sourceFilter, setSourceFilter] = useState<"all" | "binance_sync" | "manual">("all");
  const [sideFilter, setSideFilter] = useState<"all" | "buy" | "sell">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (sourceFilter !== "all" && t.source !== sourceFilter) return false;
      if (sideFilter !== "all" && t.side !== sideFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const noteMatch = t.note?.toLowerCase().includes(q);
        const orderMatch = t.binance_order_no?.toLowerCase().includes(q);
        const priceMatch = String(t.price).includes(q);
        const amountMatch = String(t.amount_usdt).includes(q);
        if (!noteMatch && !orderMatch && !priceMatch && !amountMatch) return false;
      }
      return true;
    });
  }, [trades, sourceFilter, sideFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedTrades = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredTrades.slice(start, start + pageSize);
  }, [filteredTrades, safePage, pageSize]);

  if (!trades.length) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setSourceFilter("all");
              setPage(1);
            }}
            className={cn(
              "rounded-md px-2.5 py-1 font-medium transition-colors",
              sourceFilter === "all"
                ? "bg-primary/20 text-primary"
                : "bg-surface-2 text-muted-foreground hover:text-foreground",
            )}
          >
            Semua ({trades.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceFilter("binance_sync");
              setPage(1);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors",
              sourceFilter === "binance_sync"
                ? "bg-yellow-500/20 text-yellow-400"
                : "bg-surface-2 text-muted-foreground hover:text-foreground",
            )}
          >
            <RefreshCw className="size-2.5" />
            Binance ({trades.filter((t) => t.source === "binance_sync").length})
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceFilter("manual");
              setPage(1);
            }}
            className={cn(
              "rounded-md px-2.5 py-1 font-medium transition-colors",
              sourceFilter === "manual"
                ? "bg-primary/20 text-primary"
                : "bg-surface-2 text-muted-foreground hover:text-foreground",
            )}
          >
            Manual ({trades.filter((t) => t.source === "manual").length})
          </button>

          <span className="mx-1 text-border">|</span>

          <button
            type="button"
            onClick={() => {
              setSideFilter(sideFilter === "buy" ? "all" : "buy");
              setPage(1);
            }}
            className={cn(
              "rounded-md px-2 py-1 text-[0.7rem] font-semibold tracking-wider uppercase transition-colors",
              sideFilter === "buy" ? "bg-bid/20 text-bid" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Beli
          </button>
          <button
            type="button"
            onClick={() => {
              setSideFilter(sideFilter === "sell" ? "all" : "sell");
              setPage(1);
            }}
            className={cn(
              "rounded-md px-2 py-1 text-[0.7rem] font-semibold tracking-wider uppercase transition-colors",
              sideFilter === "sell" ? "bg-ask/20 text-ask" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Jual
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-44">
            <Search className="absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari transaksi..."
              className="w-full rounded-md border-0 bg-surface-2 py-1 pr-2.5 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded-md border border-border/80 bg-surface-2 px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            title="Jumlah transaksi per halaman"
          >
            <option value={25}>25 / hal</option>
            <option value={50}>50 / hal</option>
            <option value={100}>100 / hal</option>
            <option value={200}>200 / hal</option>
            <option value={500}>500 / hal</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[0.68rem] tracking-[0.12em] text-muted-foreground uppercase">
              <th className="py-2 pr-3 text-left font-medium">Waktu</th>
              <th className="py-2 pr-3 text-left font-medium">Sisi</th>
              <th className="py-2 pr-3 text-right font-medium">Harga</th>
              <th className="py-2 pr-3 text-right font-medium">Jumlah (USDT)</th>
              <th className="py-2 pr-3 text-right font-medium">Profit / Detail</th>
              <th className="py-2 pr-3 text-left font-medium">Catatan</th>
              {(onEdit || onDelete) && <th className="py-2 text-right font-medium">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginatedTrades.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                  Tidak ada transaksi yang cocok dengan filter.
                </td>
              </tr>
            ) : (
              paginatedTrades.map((t) => (
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
                  <td className="num py-2.5 pr-3 text-right">
                    <div className="font-semibold text-foreground/90">
                      {fmtRp2(normalizeTradePrice(t.price))}
                    </div>
                    <div className="text-[0.68rem] text-muted-foreground">
                      {fmtRp(normalizeTradePrice(t.price) * t.amount_usdt)}
                    </div>
                  </td>
                  <td className="num py-2.5 pr-3 text-right text-foreground/85">
                    <div className="font-semibold text-foreground/90">
                      {t.amount_usdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                    </div>
                    {t.side === "buy" ? (
                      <div className="text-[0.67rem] font-medium text-emerald-400" title="Penambahan saldo stok masuk">
                        +{t.source === "binance_sync" && t.fee_rate
                          ? (t.amount_usdt * (1 - t.fee_rate)).toLocaleString("id-ID", { maximumFractionDigits: 2 })
                          : t.amount_usdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })}{" "}
                        stok
                      </div>
                    ) : (
                      <div className="text-[0.67rem] font-medium text-rose-400" title="Pengurangan saldo stok keluar">
                        -{t.amount_usdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} stok
                      </div>
                    )}
                  </td>
                  {/* Kolom Profit / Detail */}
                  <td className="num py-2.5 pr-3 text-right">
                    {t.side === "sell" && t.profit_idr !== undefined ? (
                      <div>
                        <div
                          className={cn(
                            "font-semibold tabular-nums",
                            t.profit_idr >= 0 ? "text-emerald-400" : "text-rose-400",
                          )}
                        >
                          {t.profit_idr >= 0 ? "+" : ""}
                          {fmtRp(t.profit_idr)}
                        </div>
                        {t.avg_cost_at_sell !== undefined && t.avg_cost_at_sell > 0 && (
                          <div className="text-[0.67rem] text-muted-foreground">
                            Modal: {fmtRp2(t.avg_cost_at_sell)}/USDT
                          </div>
                        )}
                        {t.fee_rate !== undefined && t.fee_rate > 0 && (
                          <div className="text-[0.65rem] text-muted-foreground/80">
                            Fee {(t.fee_rate * 100).toFixed(2)}%
                            {t.fee_idr ? ` (${fmtRp(t.fee_idr)})` : ""}
                          </div>
                        )}
                      </div>
                    ) : t.side === "buy" ? (
                      <div>
                        <div className="text-[0.68rem] text-muted-foreground">
                          {fmtRp(normalizeTradePrice(t.price) * t.amount_usdt)}
                        </div>
                        {t.fee_rate !== undefined && t.fee_rate > 0 && (
                          <div className="text-[0.65rem] text-muted-foreground/80">
                            Fee {(t.fee_rate * 100).toFixed(2)}%
                            {t.fee_idr ? ` (${fmtRp(t.fee_idr)})` : ""}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {t.source === "binance_sync" && (
                        <span
                          title={`Order Binance #${t.binance_order_no ?? ""}`}
                          className="inline-flex items-center gap-0.5 rounded-sm bg-yellow-500/15 px-1 py-0.5 text-[0.6rem] font-semibold tracking-wider text-yellow-400 uppercase"
                        >
                          <RefreshCw className="size-2.5" />
                          Binance
                        </span>
                      )}
                      <span>{t.note || (t.source === "binance_sync" ? "" : "—")}</span>
                    </span>
                  </td>
                  {(onEdit || onDelete) && (
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onEdit ? (
                          <button
                            type="button"
                            onClick={() => onEdit(t)}
                            disabled={t.source === "binance_sync"}
                            title={
                              t.source === "binance_sync"
                                ? "Transaksi dari Binance tidak bisa diedit manual"
                                : "Edit transaksi"
                            }
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span>
            Menampilkan{" "}
            <strong className="text-foreground/90">
              {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredTrades.length)}
            </strong>{" "}
            dari <strong className="text-foreground/90">{filteredTrades.length}</strong> transaksi
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-surface-2 text-foreground/80 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              title="Halaman sebelumnya"
            >
              <ChevronLeft className="size-3.5" />
            </button>

            <span className="px-2 font-medium">
              Hal {safePage} dari {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-surface-2 text-foreground/80 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              title="Halaman berikutnya"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


