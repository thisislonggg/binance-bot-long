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
/** "2026-10" -> "Oktober" */
const monthName = (key: string) => dayLabel(`${key}-01`, { month: "long" });
const prevMonthKey = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const daysInMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const pctChange = (now: number, before: number) => (before !== 0 ? ((now - before) / Math.abs(before)) * 100 : null);

type Scope = "today" | "month";
const SCOPE_KEY = "profit_report_scope";

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

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <span className={cn("font-semibold", pct >= 0 ? "text-bid" : "text-ask")}>
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toLocaleString("id-ID", { maximumFractionDigits: 0 })}%{" "}
    </span>
  );
}

export function ProfitReport({ pnl }: { pnl: PnlSummary | undefined }) {
  const colors = useThemeColors();
  const allDaily = useMemo(() => pnl?.daily ?? [], [pnl]);
  const daily = useMemo(() => allDaily.slice(-30), [allDaily]);
  const [scope, setScope] = useState<Scope>("today");
  useEffect(() => {
    try {
      if (localStorage.getItem(SCOPE_KEY) === "month") setScope("month");
    } catch {}
  }, []);
  const changeScope = (next: Scope) => {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {}
  };

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
    const delta = yesterday ? pctChange(today.profit_idr, yesterday.profit_idr) : null;

    // Bulan berjalan vs bulan lalu (periode tanggal yang sama agar perbandingannya adil)
    const monthKey = today.date.slice(0, 7);
    const lastKey = prevMonthKey(monthKey);
    const dayOfMonth = Number(today.date.slice(8, 10));
    const monthDays = allDaily.filter((d) => d.date.startsWith(monthKey));
    const lastMonthDays = allDaily.filter((d) => d.date.startsWith(lastKey));
    const month = {
      ...sumDays(`Bulan ini (${monthName(monthKey)})`, monthDays),
      buys: monthDays.reduce((s, d) => s + d.buys, 0),
      buyUsdt: monthDays.reduce((s, d) => s + d.buy_usdt, 0),
    };
    // Bulan lalu hanya dipakai bila datanya lengkap sejak tanggal 1.
    const lastMonthComplete = lastMonthDays.length > 0 && lastMonthDays[0]!.date.endsWith("-01");
    const lastMonth = lastMonthComplete ? sumDays(`Bulan lalu (${monthName(lastKey)})`, lastMonthDays) : null;
    const lastSamePeriod = lastMonthComplete
      ? sumDays("", lastMonthDays.filter((d) => Number(d.date.slice(8, 10)) <= dayOfMonth))
      : null;
    const monthBest = monthDays
      .filter((d) => d.sells > 0)
      .reduce<DailyPnl | null>((b, d) => (!b || d.profit_idr > b.profit_idr ? d : b), null);
    const monthInfo = {
      name: monthName(monthKey),
      lastName: monthName(lastKey),
      dayOfMonth,
      totalDays: daysInMonth(monthKey),
      days: monthDays,
      stats: month,
      lastMonth,
      lastSamePeriod,
      best: monthBest,
      profitableDays: monthDays.filter((d) => d.profit_idr > 0).length,
      avg: monthDays.length ? month.profit / monthDays.length : 0,
      delta: lastSamePeriod ? pctChange(month.profit, lastSamePeriod.profit) : null,
    };
    // Baris tabel: sisipkan sebelum "Sepanjang waktu"
    periods.splice(periods.length - 1, 0, month, ...(lastMonth ? [lastMonth] : []));
    return { today, yesterday, periods, best, profitableDays, avg30, delta, monthInfo };
  }, [pnl, daily, allDaily]);

  if (!pnl) {
    return <div className="panel p-6 text-center text-sm text-muted-foreground">Memuat laporan keuntungan…</div>;
  }
  if (!view) {
    return <div className="panel p-6 text-center text-sm text-muted-foreground">Belum ada data transaksi untuk laporan.</div>;
  }
  const { today, yesterday, periods, best, profitableDays, avg30, delta, monthInfo: mo } = view;
  const todayMargin = today.sell_usdt > 0 ? today.profit_idr / today.sell_usdt : 0;
  const isMonth = scope === "month";
  const chartDays = isMonth ? mo.days : daily;
  const tickDates = new Set(chartDays.filter((_, i) => i % 5 === 4 || i === chartDays.length - 1).map((d) => d.date));
  const monthMargin = mo.stats.sellUsdt > 0 ? mo.stats.profit / mo.stats.sellUsdt : 0;
  const projection = mo.avg * mo.totalDays;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-5">
        {/* ── Laba hari ini ── */}
        <div className="panel space-y-3 p-4 lg:col-span-2">
          <div className="flex rounded-lg bg-surface-2/60 p-0.5 text-xs" role="tablist" aria-label="Periode laba">
            {([["today", "Hari ini"], ["month", "Bulan ini"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={scope === id}
                onClick={() => changeScope(id)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 font-medium transition-colors",
                  scope === id ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {isMonth ? (
            <>
              <div>
                <div className="text-xs font-medium text-muted-foreground">
                  Laba bulan {mo.name} · tanggal 1–{mo.dayOfMonth} dari {mo.totalDays} hari
                </div>
                <div className={cn("mt-1 text-4xl font-semibold tracking-tight sm:text-5xl", mo.stats.profit >= 0 ? "text-bid" : "text-ask")}>
                  {signedRp(mo.stats.profit)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {mo.lastSamePeriod ? (
                    <>
                      <ChangeBadge pct={mo.delta} />
                      vs 1–{mo.dayOfMonth} {mo.lastName} ({signedRp(mo.lastSamePeriod.profit)})
                    </>
                  ) : (
                    `Sejak 1 ${mo.name}`
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Transaksi jual" value={mo.stats.sells.toLocaleString("id-ID")} hint={`${mo.stats.buys} transaksi beli`} />
                <MiniStat label="USDT terjual" value={usdt(mo.stats.sellUsdt)} hint={`${usdt(mo.stats.buyUsdt)} dibeli`} />
                <MiniStat label="Omset jual" value={rp(mo.stats.sellIdr)} />
                <MiniStat label="Margin / USDT" value={mo.stats.sellUsdt > 0 ? signedRp(monthMargin) : "—"} hint="Laba bersih per USDT" />
                <MiniStat label="Rata-rata / hari" value={signedRp(mo.avg)} hint={`${mo.profitableDays} dari ${mo.dayOfMonth} hari untung`} />
                <MiniStat label="Proyeksi akhir bulan" value={signedRp(projection)} hint="Jika rata-rata harian bertahan" />
                <MiniStat label="Fee dibayar" value={rp(mo.stats.fees)} />
                <MiniStat
                  label="Hari terbaik"
                  value={mo.best ? signedRp(mo.best.profit_idr) : "—"}
                  {...(mo.best ? { hint: dayLabel(mo.best.date, { weekday: "long", day: "numeric" }) } : {})}
                />
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* ── Grafik laba harian ── */}
        <div className="panel p-4 lg:col-span-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="text-sm font-semibold text-foreground">Laba harian · {isMonth ? `bulan ${mo.name}` : "30 hari"}</div>
            <div className="text-[0.7rem] text-muted-foreground">
              {isMonth ? (
                <>
                  Total {signedRp(mo.stats.profit)} · rata-rata {signedRp(mo.avg)}/hari
                  {mo.lastMonth ? ` · ${mo.lastName} penuh ${signedRp(mo.lastMonth.profit)}` : ""}
                </>
              ) : (
                <>
                  Rata-rata {signedRp(avg30)}/hari · {profitableDays} dari 30 hari untung
                  {best ? ` · terbaik ${signedRp(best.profit_idr)} (${dayLabel(best.date, { day: "numeric", month: "short" })})` : ""}
                </>
              )}
            </div>
          </div>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDays} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
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
                  {chartDays.map((d) => (
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
