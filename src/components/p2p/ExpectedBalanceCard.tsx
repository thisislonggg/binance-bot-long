import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Pencil, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getExpectedBalance,
  setExpectedBalanceAnchor,
  setExpectedBalanceMethods,
  type ExpectedBalanceEntry,
  type ExpectedBalanceState,
} from "@/lib/expected-balance";
import { cn } from "@/lib/utils";

const rp = (n: number) => `${n < 0 ? "−" : ""}Rp ${Math.abs(Math.round(n)).toLocaleString("id-ID")}`;
const signedRp = (side: "buy" | "sell", n: number) => `${side === "sell" ? "+" : "−"}${rp(n)}`;
const timeWib = (ms: number, withDate = false) =>
  new Date(ms).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    ...(withDate ? { day: "numeric", month: "short" } : {}),
  });
const parseRupiah = (s: string) => Number(s.replace(/[^0-9]/g, ""));

const QUERY_KEY = ["expected-balance"];

export function ExpectedBalanceCard({ sessionToken }: { sessionToken?: string | null | undefined }) {
  const token = sessionToken ?? undefined;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getExpectedBalance({ data: { sessionToken: token } }),
    enabled: Boolean(sessionToken),
    refetchInterval: 15_000,
  });
  const st = query.data;

  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [showMethods, setShowMethods] = useState(false);

  const setData = (next: ExpectedBalanceState) => queryClient.setQueryData(QUERY_KEY, next);

  const anchorMutation = useMutation({
    mutationFn: (balanceIdr: number) => setExpectedBalanceAnchor({ data: { sessionToken: token, balanceIdr } }),
    onSuccess: (next) => {
      setData(next);
      setEditing(false);
      setInput("");
      toast.success(`Saldo awal disetel ke ${rp(next.anchor?.balanceIdr ?? 0)}. Order yang selesai mulai sekarang dihitung otomatis.`);
    },
    onError: (err: any) => toast.error(`Gagal menyetel saldo: ${err.message}`),
  });

  const methodsMutation = useMutation({
    mutationFn: (excludedMethods: string[]) =>
      setExpectedBalanceMethods({ data: { sessionToken: token, excludedMethods } }),
    onSuccess: setData,
    onError: (err: any) => toast.error(`Gagal menyimpan metode: ${err.message}`),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseRupiah(input);
    if (!input.trim() || !Number.isFinite(val)) {
      toast.error("Masukkan angka saldo yang valid");
      return;
    }
    anchorMutation.mutate(val);
  };

  const toggleMethod = (key: string) => {
    if (!st) return;
    const excluded = st.methods.filter((m) => m.excluded).map((m) => m.key);
    methodsMutation.mutate(excluded.includes(key) ? excluded.filter((k) => k !== key) : [...excluded, key]);
  };

  const anchorForm = (
    <form onSubmit={submit} className="space-y-2">
      <Input
        type="text"
        inputMode="numeric"
        autoFocus={editing}
        placeholder="Saldo asli di m-banking, contoh: 37585000"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="h-9 bg-surface text-sm font-bold num"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={anchorMutation.isPending || !input} className="h-8 flex-1 text-xs font-semibold">
          {anchorMutation.isPending ? "Menyimpan…" : st?.anchor ? "Setel Ulang Saldo" : "Mulai Hitung"}
        </Button>
        {editing && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} className="h-8 text-xs bg-surface">
            Batal
          </Button>
        )}
      </div>
      <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
        Order yang sudah selesai atau sudah ditandai bayar saat ini dianggap sudah termasuk di angka ini.
      </p>
    </form>
  );

  return (
    <div className="panel p-3.5 sm:p-4.5 space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2 uppercase tracking-wide">
          <Wallet className="size-4 text-primary" />
          Perkiraan Saldo Rekening
        </h3>
        {st?.anchor && (
          <button
            type="button"
            onClick={() => query.refetch()}
            className="flex items-center gap-1 text-[0.68rem] text-muted-foreground hover:text-foreground"
            title="Perbarui sekarang"
          >
            <RefreshCw className={cn("size-3", query.isFetching && "animate-spin")} />
            {timeWib(st.updatedAt)}
          </button>
        )}
      </div>

      {!st ? (
        <div className="py-4 text-center text-xs text-muted-foreground">
          {query.isError ? "Gagal memuat perkiraan saldo." : "Memuat…"}
        </div>
      ) : !st.configured ? (
        <p className="text-xs text-muted-foreground">API key Binance belum diisi, jadi order tidak bisa dibaca.</p>
      ) : !st.anchor ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Masukkan saldo asli rekening Anda sekali. Setelah itu setiap order <strong className="text-foreground">jual</strong> yang
            Anda release menambah perkiraan, dan setiap order <strong className="text-foreground">beli</strong> yang selesai
            menguranginya — otomatis.
          </p>
          {anchorForm}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="num font-bold text-foreground text-2xl">{rp(st.expectedIdr)}</div>
            <div className="text-[0.7rem] text-muted-foreground">
              Saldo awal {rp(st.anchor.balanceIdr)} · disetel {timeWib(st.anchor.ts, true)} WIB
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border/60 bg-surface/80 p-2.5">
              <div className="text-[0.65rem] uppercase tracking-wider text-muted-foreground font-semibold">Masuk</div>
              <div className="num font-bold text-bid">+{rp(st.inIdr)}</div>
              <div className="text-[0.65rem] text-muted-foreground">{st.sellCount} order jual</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-surface/80 p-2.5">
              <div className="text-[0.65rem] uppercase tracking-wider text-muted-foreground font-semibold">Keluar</div>
              <div className="num font-bold text-ask">−{rp(st.outIdr)}</div>
              <div className="text-[0.65rem] text-muted-foreground">{st.buyCount} order beli</div>
            </div>
          </div>

          {st.pendingCount > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[0.7rem] text-muted-foreground space-y-0.5">
              <div>
                <strong className="text-foreground">{st.pendingCount} order</strong> sudah ditandai bayar, belum selesai
                {st.pendingInIdr > 0 && <span className="num text-bid"> · +{rp(st.pendingInIdr)}</span>}
                {st.pendingOutIdr > 0 && <span className="num text-ask"> · −{rp(st.pendingOutIdr)}</span>}
              </div>
              <div>
                Jika semua selesai:{" "}
                <strong className="num text-foreground">{rp(st.expectedIdr + st.pendingInIdr - st.pendingOutIdr)}</strong>
              </div>
            </div>
          )}

          {st.error && <p className="text-[0.7rem] text-ask">Gagal membaca order terbaru: {st.error}</p>}

          {editing ? (
            anchorForm
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setInput(String(st.expectedIdr));
                setEditing(true);
              }}
              className="w-full h-8 text-xs bg-surface gap-1.5"
            >
              <Pencil className="size-3" />
              Cocokkan dengan saldo asli
            </Button>
          )}

          <EntryList entries={st.entries} />

          {st.methods.length > 0 && (
            <div className="border-t border-border/60 pt-2.5">
              <button
                type="button"
                onClick={() => setShowMethods((v) => !v)}
                className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Metode pembayaran yang dihitung
                <ChevronDown className={cn("size-3.5 transition-transform", showMethods && "rotate-180")} />
              </button>
              {showMethods && (
                <div className="mt-2 space-y-2">
                  <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                    Matikan metode yang uangnya tidak lewat rekening ini. Untuk order beli, metode = bank penjual yang Anda transfer.
                  </p>
                  {(["sell", "buy"] as const).map((side) => {
                    const list = st.methods.filter((m) => m.side === side);
                    if (!list.length) return null;
                    return (
                      <div key={side} className="space-y-1">
                        <div className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                          {side === "sell" ? "Order jual (uang masuk)" : "Order beli (uang keluar)"}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map((m) => (
                            <button
                              key={m.key}
                              type="button"
                              disabled={methodsMutation.isPending}
                              onClick={() => toggleMethod(m.key)}
                              aria-pressed={!m.excluded}
                              className={cn(
                                "rounded-md border px-2 py-1 text-[0.68rem] transition-colors",
                                m.excluded
                                  ? "border-border/60 text-muted-foreground line-through"
                                  : "border-primary/50 bg-primary/10 text-foreground",
                              )}
                            >
                              {m.method} <span className="num text-muted-foreground">({m.count})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EntryList({ entries }: { entries: ExpectedBalanceEntry[] }) {
  if (!entries.length) {
    return <p className="text-[0.7rem] text-muted-foreground">Belum ada order selesai sejak saldo disetel.</p>;
  }
  return (
    <div className="space-y-1">
      <div className="text-[0.65rem] uppercase tracking-wider text-muted-foreground font-semibold">Order sejak saldo disetel</div>
      <ul className="max-h-56 overflow-y-auto divide-y divide-border/40 text-[0.72rem]">
        {entries.map((e) => (
          <li key={e.orderNumber} className={cn("flex items-center justify-between gap-2 py-1.5", e.state === "skipped" && "opacity-50")}>
            <div className="min-w-0">
              <div className="truncate text-foreground">
                {e.side === "sell" ? "Jual" : "Beli"} · @{e.nickname || "—"}
              </div>
              <div className="text-[0.65rem] text-muted-foreground">
                {timeWib(e.createTime)} · {e.method}
                {e.state === "pending" && <span className="text-amber-400"> · menunggu selesai</span>}
                {e.state === "skipped" && <span> · tidak dihitung</span>}
              </div>
            </div>
            <span
              className={cn(
                "num font-semibold shrink-0",
                e.state === "counted" ? (e.side === "sell" ? "text-bid" : "text-ask") : "text-muted-foreground",
                e.state === "skipped" && "line-through",
              )}
            >
              {signedRp(e.side, e.totalIdr)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
