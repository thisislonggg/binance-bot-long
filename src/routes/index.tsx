import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Gauge,
  Layers,
  Lock,
  LogOut,
  Newspaper,
  NotebookPen,
  RefreshCw,
  Scale,
  Signal,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { toast } from "sonner";

import { AdsTable } from "@/components/p2p/AdsTable";
import { StatCard } from "@/components/p2p/StatCard";
import { TradesTable } from "@/components/p2p/TradesTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
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
import { login } from "@/lib/auth";
import { getBinanceSyncStatus, syncBinanceTrades, type SyncResult } from "@/lib/binance-sync";
import { getMarketSnapshot } from "@/lib/p2p.functions";
import { deleteTrade, getPnlSummary, logTrade, updateTrade, type Trade, type TradeSide } from "@/lib/pnl";

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
const SESSION_KEY = "p2p_session_token";
const POLL_SECONDS = 90;
const BINANCE_SYNC_SECONDS = 180; // 3 menit

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
  // --- Login gerbang password tunggal (lihat src/lib/auth.ts) ---
  const loginFn = useServerFn(login);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) setSessionToken(saved);
    } catch {
      /* storage diblokir: abaikan, minta login manual */
    }
    setSessionChecked(true);
  }, []);

  const handleLogout = useCallback(() => {
    setSessionToken(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* abaikan */
    }
  }, []);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof Error && err.message.includes("unauthorized")) handleLogout();
    },
    [handleLogout],
  );

  const loginMutation = useMutation({
    mutationFn: (password: string) => loginFn({ data: { password } }),
    onSuccess: (res) => {
      if (res.ok && res.token) {
        setSessionToken(res.token);
        try {
          localStorage.setItem(SESSION_KEY, res.token);
        } catch {
          /* abaikan */
        }
        setLoginError(null);
        setLoginPassword("");
      } else if (res.reason === "server_not_configured") {
        setLoginError("Password login belum di-set di server (DASHBOARD_PASSWORD).");
      } else {
        setLoginError("Password salah.");
      }
    },
    onError: () => setLoginError("Gagal menghubungi server."),
  });

  const handleLogin = () => {
    if (!loginPassword) return;
    loginMutation.mutate(loginPassword);
  };

  const snapshotFn = useServerFn(getMarketSnapshot);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [capital, setCapital] = useState(10000);
  const [fee, setFee] = useState(30);
  const [auto, setAuto] = useState(true);
  const [countdown, setCountdown] = useState(POLL_SECONDS);
  const historyRef = useRef<HistoryPoint[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // --- Pencatatan/edit/hapus transaksi & profit harian/mingguan ---
  const logTradeFn = useServerFn(logTrade);
  const updateTradeFn = useServerFn(updateTrade);
  const deleteTradeFn = useServerFn(deleteTrade);
  const pnlFn = useServerFn(getPnlSummary);
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [tradePrice, setTradePrice] = useState("");
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeNote, setTradeNote] = useState("");
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);
  const [deletingTradeId, setDeletingTradeId] = useState<number | null>(null);

  // --- Binance auto-sync ---
  const syncFn = useServerFn(syncBinanceTrades);
  const syncStatusFn = useServerFn(getBinanceSyncStatus);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [autoSyncBinance, setAutoSyncBinance] = useState(true);
  const [syncCountdown, setSyncCountdown] = useState(BINANCE_SYNC_SECONDS);

  const pnlQuery = useQuery({
    queryKey: ["pnl-summary"],
    queryFn: () => pnlFn({ data: { sessionToken: sessionToken ?? undefined } }),
    refetchInterval: 60_000,
    enabled: Boolean(sessionToken),
  });

  useEffect(() => {
    if (pnlQuery.error) handleAuthError(pnlQuery.error);
  }, [pnlQuery.error, handleAuthError]);

  const syncStatusQuery = useQuery({
    queryKey: ["binance-sync-status"],
    queryFn: () => syncStatusFn({ data: { sessionToken: sessionToken ?? undefined } }),
    enabled: Boolean(sessionToken),
    staleTime: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: (isSilent?: boolean) => syncFn({ data: { sessionToken: sessionToken ?? undefined } }),
    onSuccess: (res, isSilent) => {
      setSyncResult(res);
      syncStatusQuery.refetch();
      pnlQuery.refetch();
      if (res.ok && res.added > 0) {
        toast.success(`${res.added} transaksi baru otomatis dicatat dari Binance!`);
      } else if (!isSilent && res.ok && res.added === 0) {
        toast.info("Semua transaksi Binance sudah up-to-date.");
      }
    },
    onError: handleAuthError,
  });

  const handleBinanceSync = () => {
    setSyncResult(null);
    syncMutation.mutate(false);
  };

  // Sync otomatis saat startup jika API key tersedia
  const initialSyncedRef = useRef(false);
  useEffect(() => {
    if (!sessionToken || !syncStatusQuery.data?.available || initialSyncedRef.current) return;
    initialSyncedRef.current = true;
    syncMutation.mutate(true);
  }, [sessionToken, syncStatusQuery.data?.available]);

  // Interval auto-sync berkala
  useEffect(() => {
    if (!autoSyncBinance || !sessionToken || !syncStatusQuery.data?.available) return;
    const id = setInterval(() => {
      setSyncCountdown((c) => {
        if (c <= 1) {
          syncMutation.mutate(true);
          return BINANCE_SYNC_SECONDS;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [autoSyncBinance, sessionToken, syncStatusQuery.data?.available]);

  const resetTradeForm = () => {
    setEditingTradeId(null);
    setTradeSide("buy");
    setTradePrice("");
    setTradeAmount("");
    setTradeNote("");
  };

  const logMutation = useMutation({
    mutationFn: (vars: { side: TradeSide; price: number; amountUsdt: number; note?: string }) =>
      logTradeFn({ data: { ...vars, sessionToken: sessionToken ?? undefined } }),
    onSuccess: () => {
      resetTradeForm();
      pnlQuery.refetch();
      toast.success("Transaksi berhasil dicatat.");
    },
    onError: handleAuthError,
  });

  const updateMutation = useMutation({
    mutationFn: (vars: {
      id: number;
      side: TradeSide;
      price: number;
      amountUsdt: number;
      note?: string;
    }) => updateTradeFn({ data: { ...vars, sessionToken: sessionToken ?? undefined } }),
    onSuccess: () => {
      resetTradeForm();
      pnlQuery.refetch();
      toast.success("Perubahan transaksi berhasil disimpan.");
    },
    onError: handleAuthError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTradeFn({ data: { id, sessionToken: sessionToken ?? undefined } }),
    onMutate: (id) => setDeletingTradeId(id),
    onSuccess: (_res, id) => {
      if (editingTradeId === id) resetTradeForm();
      pnlQuery.refetch();
      toast.success("Transaksi berhasil dihapus.");
    },
    onError: handleAuthError,
    onSettled: () => setDeletingTradeId(null),
  });

  const handleSubmitTrade = () => {
    const price = Number(tradePrice);
    const amount = Number(tradeAmount);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) return;
    if (editingTradeId != null) {
      updateMutation.mutate({
        id: editingTradeId,
        side: tradeSide,
        price,
        amountUsdt: amount,
        note: tradeNote || undefined,
      });
    } else {
      logMutation.mutate({ side: tradeSide, price, amountUsdt: amount, note: tradeNote || undefined });
    }
  };

  const handleEditTrade = (t: Trade) => {
    setEditingTradeId(t.id);
    setTradeSide(t.side);
    setTradePrice(String(t.price));
    setTradeAmount(String(t.amount_usdt));
    setTradeNote(t.note ?? "");
  };

  const handleDeleteTrade = (t: Trade) => {
    if (!window.confirm(`Hapus transaksi ${t.side === "buy" ? "beli" : "jual"} ${fmtRp2(t.price)}?`)) return;
    deleteMutation.mutate(t.id);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} disalin: ${text}`);
  };

  const mutation = useMutation({
    mutationFn: (vars: { capitalUsdt: number; buyFeeIdr: number }) =>
      snapshotFn({ data: { ...vars, sessionToken: sessionToken ?? undefined, history: historyRef.current } }),
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
    onError: handleAuthError,
  });

  const refresh = useCallback(() => {
    mutation.mutate({ capitalUsdt: capital, buyFeeIdr: fee });
  }, [capital, fee, mutation]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!sessionToken) return;
    historyRef.current = loadHistory();
    setHydrated(true);
    refreshRef.current();
  }, [sessionToken]);

  useEffect(() => {
    if (!auto || !sessionToken) return;
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
  }, [auto, sessionToken]);

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

  if (!sessionChecked) {
    return <main className="min-h-screen bg-background" />;
  }

  if (!sessionToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background bg-grid px-4 [background-size:44px_44px]">
        <div className="panel w-full max-w-sm p-6">
          <div className="flex items-center gap-2 text-primary">
            <Lock className="size-5" />
            <span className="text-[0.7rem] font-medium tracking-[0.2em] uppercase">Akses terbatas</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Radar Harga Merchant</h1>
          <p className="mt-1 text-sm text-muted-foreground">Masukkan password untuk membuka dashboard.</p>
          <div className="mt-5 space-y-3">
            <div>
              <Label htmlFor="login-password" className="text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase">
                Password
              </Label>
              <Input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
                autoFocus
                className="mt-2 border-0 bg-surface-2"
              />
            </div>
            <Button
              onClick={handleLogin}
              disabled={loginMutation.isPending || !loginPassword}
              className="w-full font-semibold"
            >
              {loginMutation.isPending ? "Memeriksa…" : "Masuk"}
            </Button>
            {loginError ? <p className="text-xs text-destructive-foreground">{loginError}</p> : null}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background bg-grid [background-size:44px_44px]">
      <Toaster richColors position="top-right" />
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
            <button
              type="button"
              onClick={handleLogout}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="size-3.5" /> Keluar
            </button>
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
              Riwayat harga tersimpan di database & browser: {s?.history.length ?? 0} titik
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
                action={
                  <button
                    type="button"
                    onClick={() => copyToClipboard(String(Math.round(s.my_buy_price)), "Harga Beli")}
                    className="inline-flex items-center gap-1 rounded bg-bid/20 px-2 py-0.5 text-[0.65rem] font-semibold text-bid hover:bg-bid/30 transition-colors"
                    title="Salin harga rekomendasi beli"
                  >
                    <Copy className="size-2.5" /> Salin
                  </button>
                }
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
                action={
                  <button
                    type="button"
                    onClick={() => copyToClipboard(String(Math.round(s.my_sell_price)), "Harga Jual")}
                    className="inline-flex items-center gap-1 rounded bg-ask/20 px-2 py-0.5 text-[0.65rem] font-semibold text-ask hover:bg-ask/30 transition-colors"
                    title="Salin harga rekomendasi jual"
                  >
                    <Copy className="size-2.5" /> Salin
                  </button>
                }
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
                        <YAxis domain={["dataMin - 15", "dataMax + 15"]} hide />
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
          </>
        ) : null}

        {/* ── Otomasi Auto-Catat Transaksi & Laporan PnL Real-Time ── */}
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="size-5 text-primary" />
                <h2 className="text-xl font-semibold">Otomasi Transaksi & Analisis Profit (PnL)</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Transaksi Binance C2C dicatat secara otomatis ke database Supabase dan dihitung
                profit real-time menggunakan standar <strong>FIFO Cost-Basis</strong>.
              </p>
            </div>

            {syncStatusQuery.data?.available ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5">
                  <Switch
                    id="auto-sync"
                    checked={autoSyncBinance}
                    onCheckedChange={setAutoSyncBinance}
                  />
                  <Label htmlFor="auto-sync" className="text-xs cursor-pointer text-muted-foreground">
                    Auto-sync Binance{" "}
                    {autoSyncBinance ? (
                      <span className="text-foreground/90 font-medium">({syncCountdown}s)</span>
                    ) : (
                      "Off"
                    )}
                  </Label>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBinanceSync}
                  disabled={syncMutation.isPending}
                  className="gap-1.5 text-xs font-medium"
                >
                  <RefreshCw className={syncMutation.isPending ? "size-3.5 animate-spin" : "size-3.5"} />
                  {syncMutation.isPending ? "Menyinkronkan…" : "Sync Sekarang"}
                </Button>
              </div>
            ) : null}
          </div>

          {/* Sync Status Banner */}
          {syncStatusQuery.data?.available ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-surface/50 px-4 py-2.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <span>
                  Koneksi Binance API: <strong className="text-foreground">Terhubung & Siap</strong>
                </span>
                {syncStatusQuery.data.last_sync_ts ? (
                  <span>
                    · Terakhir disinkronkan:{" "}
                    <strong className="text-foreground/90">
                      {new Date(syncStatusQuery.data.last_sync_ts).toLocaleString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </strong>
                  </span>
                ) : null}
              </div>

              {syncResult && syncResult.ok ? (
                <span className="text-bid font-medium">
                  {syncResult.added > 0
                    ? `+${syncResult.added} order baru ditambahkan`
                    : "Semua order sudah tersinkron"}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-xs text-foreground/90">
              <strong>💡 Tips Otomasi:</strong> Set <code className="font-mono text-primary">BINANCE_API_KEY</code> &{" "}
              <code className="font-mono text-primary">BINANCE_API_SECRET</code> di file server <code>.env</code> untuk
              mengaktifkan auto-catat transaksi otomatis tanpa perlu input manual.
            </div>
          )}

          {/* Kartu Ringkasan Metrik PnL */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Profit Hari Ini"
              tone={(pnlQuery.data?.today_profit_idr ?? 0) >= 0 ? "bid" : "ask"}
              icon={<TrendingUp className="size-4" />}
              value={fmtRp2(pnlQuery.data?.today_profit_idr ?? 0)}
              hint="Realized profit hari ini (FIFO)"
            />
            <StatCard
              label="Profit 7 Hari"
              tone={(pnlQuery.data?.week_profit_idr ?? 0) >= 0 ? "bid" : "ask"}
              icon={<TrendingUp className="size-4" />}
              value={fmtRp2(pnlQuery.data?.week_profit_idr ?? 0)}
              hint="Akumulasi profit 7 hari terakhir"
            />
            <StatCard
              label="Profit 30 Hari (Bulanan)"
              tone={(pnlQuery.data?.month_profit_idr ?? 0) >= 0 ? "bid" : "ask"}
              icon={<TrendingUp className="size-4" />}
              value={fmtRp2(pnlQuery.data?.month_profit_idr ?? 0)}
              hint="Akumulasi profit 30 hari"
            />
            <StatCard
              label="Profit Sepanjang Masa"
              tone={(pnlQuery.data?.all_time_profit_idr ?? 0) >= 0 ? "bid" : "ask"}
              icon={<CheckCircle2 className="size-4" />}
              value={fmtRp2(pnlQuery.data?.all_time_profit_idr ?? 0)}
              hint="Total keuntungan bersih kumulatif"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Posisi Terbuka (Stok USDT)"
              icon={<Wallet className="size-4" />}
              value={`${(pnlQuery.data?.open_position_usdt ?? 0).toLocaleString("id-ID", {
                maximumFractionDigits: 2,
              })} USDT`}
              hint={
                pnlQuery.data && pnlQuery.data.open_position_usdt > 0
                  ? `Avg. harga beli: ${fmtRp2(pnlQuery.data.open_position_avg_cost_idr)}`
                  : "Tidak ada stok terbuka"
              }
            />
            <StatCard
              label="Rata-rata Margin Bersih"
              tone="primary"
              icon={<Scale className="size-4" />}
              value={
                pnlQuery.data && pnlQuery.data.avg_profit_per_usdt_idr > 0
                  ? `+${fmtRp2(pnlQuery.data.avg_profit_per_usdt_idr)} / USDT`
                  : "—"
              }
              hint="Rata-rata selisih profit per USDT terjual"
            />
            <StatCard
              label="Volume Turnover Transaksi"
              icon={<Layers className="size-4" />}
              value={`${(
                (pnlQuery.data?.total_buy_usdt ?? 0) + (pnlQuery.data?.total_sell_usdt ?? 0)
              ).toLocaleString("id-ID", { maximumFractionDigits: 1 })} USDT`}
              hint={`Total: ${fmtRp(
                (pnlQuery.data?.total_buy_idr ?? 0) + (pnlQuery.data?.total_sell_idr ?? 0),
              )} (${pnlQuery.data?.total_trades_count ?? 0} transaksi)`}
            />
          </div>

          {/* Grid Formulir Catat Manual & Tabel Transaksi */}
          <div className="grid gap-4 lg:grid-cols-[1fr_1.65fr]">
            {/* Form Catat/Edit Manual */}
            <div className="panel p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold tracking-[0.1em] uppercase">
                <NotebookPen className="size-4 text-primary" />
                {editingTradeId != null ? "Edit Transaksi" : "Input Transaksi Manual"}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {editingTradeId != null
                  ? "Ubah data transaksi lalu simpan."
                  : "Gunakan form ini jika ada transaksi di luar Binance C2C yang ingin Anda catat ke dalam PnL."}
              </p>

              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase">
                      Sisi
                    </Label>
                    <Select value={tradeSide} onValueChange={(v) => setTradeSide(v as TradeSide)}>
                      <SelectTrigger className="mt-2 border-0 bg-surface-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buy">Beli (Buy)</SelectItem>
                        <SelectItem value="sell">Jual (Sell)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase">
                      Harga Eksekusi (Rp)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={tradePrice}
                      onChange={(e) => setTradePrice(e.target.value)}
                      placeholder="mis. 16250"
                      className="num mt-2 border-0 bg-surface-2"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase">
                    Jumlah (USDT)
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={tradeAmount}
                    onChange={(e) => setTradeAmount(e.target.value)}
                    placeholder="mis. 500"
                    className="num mt-2 border-0 bg-surface-2"
                  />
                </div>

                <div>
                  <Label className="text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase">
                    Catatan (opsional)
                  </Label>
                  <Input
                    value={tradeNote}
                    onChange={(e) => setTradeNote(e.target.value)}
                    placeholder="mis. Pelanggan offline / Bank Mandiri"
                    className="mt-2 border-0 bg-surface-2"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={handleSubmitTrade}
                    disabled={
                      logMutation.isPending || updateMutation.isPending || !tradePrice || !tradeAmount
                    }
                    className="w-full font-semibold"
                  >
                    {logMutation.isPending || updateMutation.isPending
                      ? "Menyimpan…"
                      : editingTradeId != null
                        ? "Simpan Perubahan"
                        : "Catat Transaksi"}
                  </Button>
                  {editingTradeId != null ? (
                    <Button variant="outline" onClick={resetTradeForm} className="shrink-0">
                      Batal
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Tabel Transaksi */}
            <div className="panel p-5">
              <div className="flex items-center justify-between pb-2">
                <h3 className="text-sm font-semibold tracking-[0.1em] uppercase">
                  Riwayat Transaksi (Auto & Manual)
                </h3>
                <Badge variant="outline" className="num text-xs">
                  {pnlQuery.data?.recent_trades.length ?? 0} Transaksi Terakhir
                </Badge>
              </div>

              <div className="mt-2">
                <TradesTable
                  trades={pnlQuery.data?.recent_trades ?? []}
                  onEdit={handleEditTrade}
                  onDelete={handleDeleteTrade}
                  editingId={editingTradeId}
                  deletingId={deletingTradeId}
                />
              </div>

              {pnlQuery.data && !pnlQuery.data.configured ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Supabase belum dikonfigurasi di server, jadi riwayat transaksi belum bisa disimpan.
                </p>
              ) : null}

              {pnlQuery.data && pnlQuery.data.unmatched_sell_usdt > 0 ? (
                <p className="mt-3 rounded-md bg-surface-2 p-2.5 text-xs text-muted-foreground">
                  ℹ️ <strong>{pnlQuery.data.unmatched_sell_usdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT</strong> terjual
                  tanpa catatan pembelian sebelumnya (kemungkinan stok awal sebelum bot aktif). Bagian ini dilewati dari perhitungan profit.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <footer className="mt-12 border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
          Data pasar Binance P2P diambil secara langsung dari endpoint publik. Transaksi C2C disinkronkan secara aman via Binance API Key (Read-Only). Semua kalkulasi profit dihitung otomatis menggunakan standar FIFO cost-basis akuntansi.
        </footer>
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

