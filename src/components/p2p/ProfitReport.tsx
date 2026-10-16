import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DailyPnl, PnlSummary } from "@/lib/pnl";
import { cn } from "@/lib/utils";

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const signedRp = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${rp(Math.abs(n))}`;
const usdt = (n: number) => `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT`;
/** Ringkas untuk sumbu: 1,5 jt / 850 rb */
const compactRp = (n: number) => {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (a >= 1_000) return `${sign}${Math.round(a / 1_000).toLocaleString("id-ID")} rb`;
  return `${sign}${Math.round(a)}`;
};
const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", ...opts });

type Period = { label: string; profit: number; sells: number; sellUsdt: number; sellIdr: number; fees: number; days: number | null };

function sumDays(label: string, days: DailyPnl[]): Period {
  return {
    label,
    profit: days.reduce((s, d) => s + d.profit_idr, 0),
    sells: days.reduce((s, d) => s + d.sells, 0),
    sellUsdt: days.reduce((s, d) => s + d.sell_usdt, 0),
    sellIdr: days.reduce((s, d) => s + d.sell_idr, 0),
    fees: days.reduce((s, d) => s + d.fees_idr, 0),
    days: days.length,
  };
}

/** Warna tema dibaca dari CSS (atribut SVG tidak bisa memakai var()). */
function useThemeColors() {
  const [c, setC] = useState({ bid: "#10B981", ask: "#F43F5E", grid: "rgba(255,255,255,0.07)", muted: "#8B95A5" });
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    setC({ bid: read("--bid", c.bid), ask: read("--ask", c.ask), grid: read("--border", c.grid), muted: read("--muted-foreground", c.muted) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return c;
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2/60 px-3 py-2">
      <div className="text-[0.65rem] font-medium text-muted-foreground">{label}</div>
      <div className="num break-words text-sm font-semibold text-foreground">{value}</div>
      {hint ? <div className="truncate text-[0.62rem] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload: DailyPnl }[] }) {
  const d = active && payload?.[0]?.payload;
  if (!d) return null;
  const margin = d.sell_usdt > 0 ? d.profit_idr / d.sell_usdt : 0;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-foreground">{dayLabel(d.date, { weekday: "long", day: "numeric", month: "long" })}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">Laba</span>
        <span className="num text-right font-semibold text-foreground">{signedRp(d.profit_idr)}</span>
        <span className="text-muted-foreground">Transaksi jual</span>
        <span className="num text-right text-foreground">{d.sells}</span>
        <span className="text-muted-foreground">USDT terjual</span>
        <span className="num text-right text-foreground">{usdt(d.sell_usdt)}</span>
        <span className="text-muted-foreground">Margin / USDT</span>
        <span className="num text-right text-foreground">{d.sell_usdt > 0 ? signedRp(margin) : "—"}</span>
        <span className="text-muted-foreground">USDT dibeli</span>
        <span className="num text-right text-foreground">{usdt(d.buy_usdt)}</span>
      </div>
    </div>
  );
}

export function ProfitReport({ pnl }: { pnl: PnlSummary | undefined }) {
  const colors = useThemeColors();
  const daily = pnl?.daily ?? [];

  const view = useMemo(() => {
    if (!pnl || daily.length === 0) return null;
    const today = daily[daily.length - 1]!;
    const yesterday = daily[daily.length - 2];
    const last7 = daily.slice(-7);
    const periods: Period[] = [
      sumDays("Hari ini", [today]),
      ...(yesterday ? [sumDays("Kemarin", [yesterday])] : []),
      sumDays("7 hari", last7),
      sumDays("30 hari", daily),
      {
        label: "Sepanjang waktu",
        profit: pnl.all_time_profit_idr,
        sells: 0,
        sellUsdt: pnl.total_sell_usdt,
        sellIdr: pnl.total_sell_idr,
        fees: pnl.total_fees_idr,
        days: null,
      },
    ];
    const active = daily.filter((d) => d.sells > 0);
    const best = active.reduce<DailyPnl | null>((b, d) => (!b || d.profit_idr > b.profit_idr ? d : b), null);
    const profitableDays = daily.filter((d) => d.profit_idr > 0).length;
    const avg30 = daily.reduce((s, d) => s + d.profit_idr, 0) / daily.length;
    const delta = yesterday && yesterday.profit_idr !== 0 ? ((today.profit_idr - yesterday.profit_idr) / Math.abs(yesterday.profit_idr)) * 100 : null;
    return { today, yesterday, periods, best, profitableDays, avg30, delta };
  }, [pnl, daily]);

  if (!pnl) {
    return <div className="panel p-6 text-center text-sm text-muted-foreground">Memuat laporan keuntungan…</div>;
  }
  if (!view) {
    return <div className="panel p-6 text-center text-sm text-muted-foreground">Belum ada data transaksi untuk laporan.</div>;
  }
  const { today, yesterday, periods, best, profitableDays, avg30, delta } = view;
  const todayMargin = today.sell_usdt > 0 ? today.profit_idr / today.sell_usdt : 0;
  const tickDates = new Set(daily.filter((_, i) => i % 5 === 4 || i === daily.length - 1).map((d) => d.date));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-5">
        {/* ── Laba hari ini ── */}
        <div className="panel space-y-3 p-4 lg:col-span-2">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Laba hari ini</div>
            <div className={cn("mt-1 text-4xl font-semibold tracking-tight sm:text-5xl", today.profit_idr >= 0 ? "text-bid" : "text-ask")}>
              {signedRp(today.profit_idr)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {yesterday ? (
                <>
                  {delta !== null && (
                    <span className={cn("font-semibold", delta >= 0 ? "text-bid" : "text-ask")}>
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString("id-ID", { maximumFractionDigits: 0 })}%{" "}
                    </span>
                  )}
                  vs kemarin ({signedRp(yesterday.profit_idr)}, sehari penuh)
                </>
              ) : (
                "Sejak 00:00 WIB"
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Transaksi jual" value={today.sells.toLocaleString("id-ID")} hint={`${today.buys} transaksi beli`} />
            <MiniStat label="USDT terjual" value={usdt(today.sell_usdt)} hint={`${usdt(today.buy_usdt)} dibeli`} />
            <MiniStat label="Omset jual" value={rp(today.sell_idr)} />
            <MiniStat label="Margin / USDT" value={today.sell_usdt > 0 ? signedRp(todayMargin) : "—"} hint="Laba bersih per USDT" />
            <MiniStat label="Laba / transaksi" value={today.sells > 0 ? signedRp(today.profit_idr / today.sells) : "—"} />
            <MiniStat label="Fee dibayar" value={rp(today.fees_idr)} />
          </div>
        </div>

        {/* ── Grafik laba harian ── */}
        <div className="panel p-4 lg:col-span-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="text-sm font-semibold text-foreground">Laba harian · 30 hari</div>
            <div className="text-[0.7rem] text-muted-foreground">
              Rata-rata {signedRp(avg30)}/hari · {profitableDays} dari 30 hari untung
              {best ? ` · terbaik ${signedRp(best.profit_idr)} (${dayLabel(best.date, { day: "numeric", month: "short" })})` : ""}
            </div>
          </div>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={colors.grid} strokeWidth={1} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={{ fill: colors.muted, fontSize: 10 }}
                  tickFormatter={(d: string) => (tickDates.has(d) ? (d === today.date ? "Hari ini" : dayLabel(d, { day: "numeric", month: "short" })) : "")}
                />
                <YAxis
                  width={52}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: colors.muted, fontSize: 10 }}
                  tickFormatter={(v: number) => compactRp(v)}
                />
                <ReferenceLine y={0} stroke={colors.muted} strokeWidth={1} />
                <Tooltip content={<DayTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="profit_idr" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {daily.map((d) => (
                    <Cell
                      key={d.date}
                      fill={d.profit_idr >= 0 ? colors.bid : colors.ask}
                      fillOpacity={d.date === today.date ? 1 : 0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Perbandingan periode ── */}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[0.68rem] text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Periode</th>
              <th className="px-3 py-2.5 text-right font-medium">Laba bersih</th>
              <th className="px-3 py-2.5 text-right font-medium">Transaksi jual</th>
              <th className="px-3 py-2.5 text-right font-medium">USDT terjual</th>
              <th className="px-3 py-2.5 text-right font-medium">Omset jual</th>
              <th className="px-3 py-2.5 text-right font-medium">Margin / USDT</th>
              <th className="px-4 py-2.5 text-right font-medium">Rata-rata / hari</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {periods.map((p) => (
              <tr key={p.label} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2.5 font-medium text-foreground">{p.label}</td>
                <td className={cn("px-3 py-2.5 text-right font-semibold", p.profit >= 0 ? "text-bid" : "text-ask")}>{signedRp(p.profit)}</td>
                <td className="px-3 py-2.5 text-right text-foreground">
                  {p.days === null ? "—" : p.sells.toLocaleString("id-ID")}
                </td>
                <td className="px-3 py-2.5 text-right text-foreground">{usdt(p.sellUsdt)}</td>
                <td className="px-3 py-2.5 text-right text-foreground">{rp(p.sellIdr)}</td>
                <td className="px-3 py-2.5 text-right text-foreground">{p.sellUsdt > 0 ? signedRp(p.profit / p.sellUsdt) : "—"}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{p.days && p.days > 1 ? signedRp(p.profit / p.days) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 pb-2.5 pt-1 text-[0.62rem] text-muted-foreground">
          Laba dihitung saat USDT terjual (setelah fee, metode harga rata-rata). Sepanjang waktu:{" "}
          {pnl.total_trades_count.toLocaleString("id-ID")} transaksi tercatat (beli &amp; jual), total fee {rp(pnl.total_fees_idr)}.
        </div>
      </div>
    </div>
  );
}
