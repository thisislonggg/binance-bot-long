import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Gauge,
  Layers,
  Newspaper,
  RefreshCw,
  Scale,
  Signal,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

import { AdsTable } from "@/components/p2p/AdsTable";
import { StatCard } from "@/components/p2p/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  biasLabel,
  confidenceLabel,
  fmtPct,
  fmtRp,
  fmtRp2,
  liquidityLabel,
  type HistoryPoint,
  type Snapshot,
} from "@/lib/p2p-engine";
import { getMarketSnapshot } from "@/lib/p2p.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Radar P2P — Harga Iklan USDT/IDR untuk Merchant" },
      {
        name: "description",
        content:
          "Dashboard analisis Binance P2P USDT/IDR: harga beli & jual rekomendasi, margin dinamis, kedalaman likuiditas, dan sinyal pasar untuk merchant.",
      },
      { property: "og:title", content: "Radar P2P — Harga Iklan USDT/IDR untuk Merchant" },
      {
        property: "og:description",
        content:
          "Rekomendasi harga iklan beli & jual USDT/IDR berbasis order book P2P, margin dinamis, dan sinyal pasar jangka pendek.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const HISTORY_KEY = "p2p_price_history";
const POLL_SECONDS = 90;

function loadHistory(): HistoryPoint[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-100) : [];
  } catch {
    return [];
  }
}

function Dashboard() {
  const snapshotFn = useServerFn(getMarketSnapshot);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [capital, setCapital] = useState(10000);
  const [fee, setFee] = useState(30);
  const [auto, setAuto] = useState(true);
  const [countdown, setCountdown] = useState(POLL_SECONDS);
  const historyRef = useRef<HistoryPoint[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const mutation = useMutation({
    mutationFn: (vars: { capitalUsdt: number; buyFeeIdr: number }) =>
      snapshotFn({ data: { ...vars, history: historyRef.current } }),
    onSuccess: (data) => {
      historyRef.current = data.history;
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(data.history));
      } catch {
        /* storage penuh / diblokir: abaikan */
      }
      setSnapshot(data);
      setCountdown(POLL_SECONDS);
    },
  });

  const refresh = useCallback(() => {
    mutation.mutate({ capitalUsdt: capital, buyFeeIdr: fee });
  }, [capital, fee, mutation]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    historyRef.current = loadHistory();
    setHydrated(true);
    refreshRef.current();
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          refreshRef.current();
          return POLL_SECONDS;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [auto]);

  const chartData = useMemo(
    () =>
      (snapshot?.history ?? []).map((p) => ({
        ts: new Date(p.ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
        price: p.fair_price,
      })),
    [snapshot],
  );

  const s = snapshot;
  const loading = mutation.isPending && !s;

  return (
    <main className="min-h-screen bg-background bg-grid [background-size:44px_44px]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-bid/70" />
                <span className="relative inline-flex size-2 rounded-full bg-bid" />
              </span>
              <span className="text-[0.7rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
                Binance P2P · USDT / IDR
              </span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Radar Harga Merchant</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Acuan harga iklan <strong className="text-foreground/90">beli</strong> dan{" "}
              <strong className="text-foreground/90">jual</strong> Anda — dihitung dari order book
              kompetitor, kedalaman stok, dan margin minimum dinamis.
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            <Button
              onClick={refresh}
              disabled={mutation.isPending}
              className="w-full font-semibold sm:w-auto"
            >
              <RefreshCw className={mutation.isPending ? "animate-spin" : ""} />
              {mutation.isPending ? "Mengambil data…" : "Refresh sekarang"}
            </Button>
            <div className="flex items-center gap-2.5">
              <Switch id="auto" checked={auto} onCheckedChange={setAuto} />
              <Label htmlFor="auto" className="text-xs text-muted-foreground">
                Auto-refresh {auto ? `· ${countdown}s` : "nonaktif"}
              </Label>
            </div>
          </div>
        </header>

        {/* Parameter */}
        <section className="mt-7 grid gap-4 sm:grid-cols-[repeat(2,minmax(0,220px))_1fr]">
          <div className="panel p-4">
            <Label htmlFor="capital" className="text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase">
              Modal (USDT)
            </Label>
            <Input
              id="capital"
              type="number"
              min={1}
              value={capital}
              onChange={(e) => setCapital(Math.max(1, Number(e.target.value) || 0))}
              className="num mt-2 border-0 bg-surface-2 text-lg font-semibold"
            />
          </div>
          <div className="panel p-4">
            <Label htmlFor="fee" className="text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase">
              Fee beli (Rp/USDT)
            </Label>
            <Input
              id="fee"
              type="number"
              min={0}
              value={fee}
              onChange={(e) => setFee(Math.max(0, Number(e.target.value) || 0))}
              className="num mt-2 border-0 bg-surface-2 text-lg font-semibold"
            />
          </div>
          <div className="panel flex flex-col justify-center gap-1.5 p-4">
            <span className="text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase">
              Terakhir diperbarui
            </span>
            <span className="num text-sm text-foreground/90">
              {s ? new Date(s.timestamp).toLocaleString("id-ID") : hydrated ? "—" : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              Riwayat harga tersimpan di browser Anda: {s?.history.length ?? 0} titik
            </span>
          </div>
        </section>

        {mutation.isError ? (
          <p className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            Gagal mengambil data pasar. Coba refresh lagi.
          </p>
        ) : null}

        {loading ? (
          <p className="mt-10 text-sm text-muted-foreground">Mengambil order book P2P…</p>
        ) : null}

        {s ? (
          <>
            {/* Rekomendasi harga */}
            <section className="mt-6 grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Pasang iklan BELI di"
                tone="bid"
                icon={<ArrowDownRight className="size-5" />}
                value={fmtRp2(s.my_buy_price)}
                hint={
                  <>
                    Sebelum fee {fmtRp2(s.my_buy_price_pre_fee)} · zona kompetitor{" "}
                    {fmtRp(s.my_buy_zone[0])}–{fmtRp(s.my_buy_zone[1])}
                  </>
                }
              />
              <StatCard
                label="Pasang iklan JUAL di"
                tone="ask"
                icon={<ArrowUpRight className="size-5" />}
                value={fmtRp2(s.my_sell_price)}
                hint={
                  <>
                    Zona kompetitor {fmtRp(s.my_sell_zone[0])}–{fmtRp(s.my_sell_zone[1])}
                  </>
                }
              />
            </section>

            <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Harga tengah wajar"
                tone="primary"
                icon={<Scale className="size-4" />}
                value={fmtRp2(s.fair_price)}
                hint={`Bias pasar: ${biasLabel(s.bias)}`}
              />
              <StatCard
                label="Margin Anda"
                icon={<TrendingUp className="size-4" />}
                value={`${fmtRp2(s.spread_abs)}`}
                hint={`${fmtPct(s.spread_pct)} · minimum dijaga ${fmtRp2(s.min_margin_used)}${
                  s.margin_adjusted ? " (harga dilebarkan)" : ""
                }`}
              />
              <StatCard
                label="Likuiditas terlihat"
                icon={<Layers className="size-4" />}
                value={fmtRp(s.total_liquidity_idr)}
                hint={`Kelas: ${liquidityLabel(s.liquidity_class)} · ${s.sell_ref_count_clean + s.buy_ref_count_clean} iklan valid`}
              />
              <StatCard
                label="Skor keyakinan"
                icon={<Gauge className="size-4" />}
                value={`${s.confidence}/100`}
                hint={confidenceLabel(s.confidence)}
              />
            </section>

            {/* Grafik + sinyal */}
            <section className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
              <div className="panel p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-[0.1em] uppercase">
                    Harga wajar (riwayat sesi)
                  </h2>
                  <Badge variant="outline" className="num text-xs">
                    {chartData.length} titik
                  </Badge>
                </div>
                <div className="mt-4 h-56">
                  {chartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="fair" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.45} />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <YAxis
                          domain={["dataMin - 15", "dataMax + 15"]}
                          hide
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--color-surface-2)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 10,
                            fontSize: 12,
                          }}
                          labelStyle={{ color: "var(--color-muted-foreground)" }}
                          formatter={(v: number) => [fmtRp2(v), "Harga wajar"]}
                        />
                        <Area
                          type="monotone"
                          dataKey="price"
                          stroke="var(--color-primary)"
                          strokeWidth={2}
                          fill="url(#fair)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Butuh minimal 2 pembacaan — biarkan auto-refresh berjalan.
                    </div>
                  )}
                </div>
              </div>

              <div className="panel space-y-3 p-5">
                <h2 className="text-sm font-semibold tracking-[0.1em] uppercase">Sinyal pasar</h2>
                <Row
                  icon={<Signal className="size-4" />}
                  label="Arah jangka pendek"
                  value={s.price_outlook.outlook}
                />
                <Row
                  icon={<Activity className="size-4" />}
                  label="Momentum"
                  value={
                    s.momentum.available
                      ? `${s.momentum.label} (${fmtPct(s.momentum.delta_pct ?? NaN)})`
                      : s.momentum.label
                  }
                />
                <Row
                  icon={<Layers className="size-4" />}
                  label="Imbalance order book"
                  value={`${s.order_book_imbalance.label} (${fmtPct(s.order_book_imbalance.imbalance_pct, 1)})`}
                />
                <Row
                  icon={<Scale className="size-4" />}
                  label="Selisih vs bursa spot"
                  value={fmtPct(s.cross_platform_gap_pct)}
                />
                <Row
                  icon={<Activity className="size-4" />}
                  label="Volatilitas terakhir"
                  value={fmtPct(s.volatility_pct, 3)}
                />
                <Row
                  icon={<Wallet className="size-4" />}
                  label="Pangsa modal Anda"
                  value={`${fmtPct(s.capital_share_pct, 1)} dari likuiditas`}
                />
                <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                  Sinyal ini heuristik sederhana, bukan prediksi harga. Jangan jadikan satu-satunya
                  dasar keputusan.
                </p>
              </div>
            </section>

            {/* Rincian margin & kedalaman */}
            <section className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="panel p-5">
                <h2 className="text-sm font-semibold tracking-[0.1em] uppercase">
                  Kenapa margin sebesar ini
                </h2>
                <div className="mt-3 space-y-2.5">
                  <Row label="Dasar (floor)" value={fmtPct(s.margin_breakdown['floor_pct'] ?? NaN, 3)} />
                  <Row label="Buffer volatilitas" value={fmtPct(s.margin_breakdown['vol_buf_pct'] ?? NaN, 3)} />
                  <Row label="Buffer likuiditas" value={fmtPct(s.margin_breakdown['liq_buf_pct'] ?? NaN, 3)} />
                  <Row label="Buffer modal" value={fmtPct(s.margin_breakdown['capital_buf_pct'] ?? NaN, 3)} />
                  <Row
                    label="Faktor kepadatan kompetitor"
                    value={`×${(s.margin_breakdown['crowd_factor'] ?? 0).toFixed(2)} (jual ${s.sell_density} · beli ${s.buy_density} iklan nempel)`}
                  />
                  <Row label="Margin minimum dipakai" value={fmtRp2(s.min_margin_used)} />
                </div>
              </div>

              <div className="panel p-5">
                <h2 className="text-sm font-semibold tracking-[0.1em] uppercase">
                  Kedalaman stok relevan
                </h2>
                <div className="mt-3 space-y-2.5">
                  <Row label="Modal Anda" value={`${s.capital_usdt.toLocaleString("id-ID")} USDT · ${fmtRp(s.capital_idr)}`} />
                  <Row label="Target kedalaman" value={fmtRp(s.depth_target_idr)} />
                  <Row
                    label="Sisi JUAL (acuan)"
                    value={`${fmtRp2(s.sell_depth.price)} · ${s.sell_depth.ads_used} iklan · ${fmtRp(s.sell_depth.depth_reached_idr)}${s.sell_depth.depth_sufficient ? "" : " (belum cukup)"}`}
                  />
                  <Row
                    label="Sisi BELI (acuan)"
                    value={`${fmtRp2(s.buy_depth.price)} · ${s.buy_depth.ads_used} iklan · ${fmtRp(s.buy_depth.depth_reached_idr)}${s.buy_depth.depth_sufficient ? "" : " (belum cukup)"}`}
                  />
                  <Row
                    label="Referensi bursa spot"
                    value={
                      Object.keys(s.cross_platform).length
                        ? Object.entries(s.cross_platform)
                            .map(([k, v]) => `${k.includes("indodax") ? "Indodax" : "CoinGecko"} ${fmtRp2(v)}`)
                            .join(" · ")
                        : "tidak tersedia"
                    }
                  />
                </div>
              </div>
            </section>

            {/* Order book */}
            <section className="panel mt-4 p-5">
              <Tabs defaultValue="sell">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold tracking-[0.1em] uppercase">
                    Order book kompetitor
                  </h2>
                  <TabsList>
                    <TabsTrigger value="sell">Acuan iklan JUAL saya</TabsTrigger>
                    <TabsTrigger value="buy">Acuan iklan BELI saya</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="sell" className="mt-4">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Kompetitor yang menjual USDT — {s.sell_ref_count_clean} dari{" "}
                    {s.sell_ref_count_raw} iklan lolos filter likuiditas & outlier.
                  </p>
                  <AdsTable ads={s.top_sell_ref_ads} side="ask" />
                </TabsContent>
                <TabsContent value="buy" className="mt-4">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Kompetitor yang membeli USDT — {s.buy_ref_count_clean} dari {s.buy_ref_count_raw}{" "}
                    iklan lolos filter likuiditas & outlier.
                  </p>
                  <AdsTable ads={s.top_buy_ref_ads} side="bid" />
                </TabsContent>
              </Tabs>
            </section>

            {/* Berita */}
            {s.news_items.length ? (
              <section className="panel mt-4 p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[0.1em] uppercase">
                  <Newspaper className="size-4 text-primary" /> Konteks berita
                </h2>
                <ul className="mt-3 space-y-2">
                  {s.news_items.map((n) => (
                    <li key={n.link || n.title}>
                      <a
                        href={n.link}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm text-foreground/85 underline-offset-4 hover:text-primary hover:underline"
                      >
                        {n.title}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Judul mentah dari Google News — tidak dipakai untuk menghitung harga.
                </p>
              </section>
            ) : null}

            <footer className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
              Data iklan diambil langsung dari endpoint publik Binance P2P. Semua angka rekomendasi
              adalah hasil hitungan heuristik atas data tersebut, bukan nasihat keuangan.
            </footer>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="num text-right text-sm font-medium text-foreground/90">{value}</span>
    </div>
  );
}
