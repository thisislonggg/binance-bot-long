import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Gauge,
  History,
  Layers,
  Lock,
  LogOut,
  Newspaper,
  NotebookPen,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Signal,
  Sparkles,
  TrendingUp,
  Upload,
  Wallet,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { toast } from "sonner";

import { AdsTable } from "@/components/p2p/AdsTable";
import { MarginCalculator } from "@/components/p2p/MarginCalculator";
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
import {
  getBinanceSyncStatus,
  importBinanceCsvTrades,
  syncBinanceTrades,
  type SyncResult,
} from "@/lib/binance-sync";
import { getMarketSnapshot } from "@/lib/p2p.functions";
import { deleteTrade, getPnlSummary, logTrade, updateTrade, type Trade, type TradeSide } from "@/lib/pnl";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Radar P2P Pro — Terminal Harga Iklan USDT/IDR & Profit Merchant" },
      {
        name: "description",
        content:
          "Terminal profesional Binance P2P USDT/IDR: rekomendasi harga iklan, margin spread dinamis, otomasi pencatatan transaksi, dan analisis PnL merchant.",
      },
      { property: "og:title", content: "Radar P2P Pro — Terminal Merchant Binance USDT/IDR" },
      {
        property: "og:description",
        content:
          "Terminal real-time untuk merchant Binance P2P: harga pasang iklan, kalkulasi PnL FIFO otomatis, dan order book depth map.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const HISTORY_KEY = "p2p_price_history";
const SESSION_KEY = "p2p_session_token";
const POLL_SECONDS = 60;
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

function saveHistory(h: HistoryPoint[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-100)));
  } catch {
    // Abaikan error localStorage jika penuh
  }
}

function Dashboard() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  // Polling pasar & history chart
  const [history, setHistory] = useState<HistoryPoint[]>(loadHistory);
  const [copiedPrice, setCopiedPrice] = useState<"buy" | "sell" | null>(null);
  const [activeTab, setActiveTab] = useState<"pnl" | "market" | "calculator" | "news">("pnl");

  // State Form Transaksi Manual
  const [showManualForm, setShowManualForm] = useState(false);
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [tradePrice, setTradePrice] = useState("");
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeNote, setTradeNote] = useState("");
  const [tradeTs, setTradeTs] = useState("");
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);
  const [deletingTradeId, setDeletingTradeId] = useState<number | null>(null);

  // State Auto-sync Binance
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [autoSyncBinance, setAutoSyncBinance] = useState(true);
  const [syncCountdown, setSyncCountdown] = useState(BINANCE_SYNC_SECONDS);

  // Binding Server Functions
  const loginFn = useServerFn(login);
  const getSnapshotFn = useServerFn(getMarketSnapshot);
  const pnlFn = useServerFn(getPnlSummary);
  const logTradeFn = useServerFn(logTrade);
  const updateTradeFn = useServerFn(updateTrade);
  const deleteTradeFn = useServerFn(deleteTrade);
  const syncFn = useServerFn(syncBinanceTrades);
  const syncStatusFn = useServerFn(getBinanceSyncStatus);
  const importCsvFn = useServerFn(importBinanceCsvTrades);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inisialisasi token dari sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) setSessionToken(saved);
    } catch {
      // Abaikan
    } finally {
      setAuthInitialized(true);
    }
  }, []);

  const handleAuthError = useCallback((err: unknown) => {
    const msg = String(err);
    if (msg.includes("AUTH_REQUIRED") || msg.includes("UNAUTHORIZED")) {
      setSessionToken(null);
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        // Abaikan
      }
    }
  }, []);

  // Query Market Snapshot
  const snapshotQuery = useQuery({
    queryKey: ["p2p-snapshot"],
    queryFn: () => getSnapshotFn({ data: { sessionToken: sessionToken ?? undefined } }),
    refetchInterval: POLL_SECONDS * 1000,
    enabled: Boolean(sessionToken),
  });

  useEffect(() => {
    if (snapshotQuery.error) handleAuthError(snapshotQuery.error);
  }, [snapshotQuery.error, handleAuthError]);

  // Query PnL Summary
  const pnlQuery = useQuery({
    queryKey: ["pnl-summary"],
    queryFn: () => pnlFn({ data: { sessionToken: sessionToken ?? undefined } }),
    refetchInterval: 60_000,
    enabled: Boolean(sessionToken),
  });

  useEffect(() => {
    if (pnlQuery.error) handleAuthError(pnlQuery.error);
  }, [pnlQuery.error, handleAuthError]);

  // Query Status Binance Sync
  const syncStatusQuery = useQuery({
    queryKey: ["binance-sync-status"],
    queryFn: () => syncStatusFn({ data: { sessionToken: sessionToken ?? undefined } }),
    enabled: Boolean(sessionToken),
    staleTime: 60_000,
  });

  // Mutasi Sync Binance API
  const syncMutation = useMutation({
    mutationFn: (vars?: { isSilent?: boolean; fullHistory?: boolean }) =>
      syncFn({
        data: {
          sessionToken: sessionToken ?? undefined,
          fullHistory: vars?.fullHistory ?? false,
        },
      }),
    onSuccess: (res, vars) => {
      setSyncResult(res);
      syncStatusQuery.refetch();
      pnlQuery.refetch();
      if (res.not_configured) {
        toast.error("Binance API Key & Secret belum diisi di file .env atau hosting!");
      } else if (!res.ok && res.error) {
        toast.error(`Gagal sync Binance: ${res.error}`);
      } else if (res.ok && res.added > 0) {
        toast.success(`${res.added} transaksi berhasil ditarik dari Binance!`);
      } else if (!vars?.isSilent && res.ok && res.added === 0) {
        toast.info(
          vars?.fullHistory
            ? "Semua riwayat 6 bulan terakhir sudah ada di database."
            : "Semua transaksi Binance sudah up-to-date.",
        );
      }
    },
    onError: handleAuthError,
  });

  // Mutasi Import CSV Binance
  const importCsvMutation = useMutation({
    mutationFn: (csvText: string) =>
      importCsvFn({
        data: {
          sessionToken: sessionToken ?? undefined,
          csvText,
        },
      }),
    onSuccess: (res) => {
      pnlQuery.refetch();
      syncStatusQuery.refetch();
      if (res.ok) {
        toast.success(`Berhasil mengimpor ${res.added} transaksi dari file CSV! (${res.skipped} terlewati/duplikat)`);
      } else {
        toast.error(`Gagal impor CSV: ${res.error}`);
      }
    },
    onError: handleAuthError,
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      toast.loading("Memproses dan mengimpor file CSV Binance...");
      importCsvMutation.mutate(text);
    } catch (err) {
      toast.error("Gagal membaca file CSV: " + String(err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleBinanceSync = () => {
    setSyncResult(null);
    syncMutation.mutate({ isSilent: false, fullHistory: false });
  };

  const handleFullHistorySync = () => {
    setSyncResult(null);
    toast.loading("Menarik seluruh histori transaksi 6 bulan terakhir dari Binance...");
    syncMutation.mutate({ isSilent: false, fullHistory: true });
  };

  // Sync otomatis saat login/startup
  const initialSyncedRef = useRef(false);
  useEffect(() => {
    if (!sessionToken || !syncStatusQuery.data?.available || initialSyncedRef.current) return;
    initialSyncedRef.current = true;
    syncMutation.mutate({ isSilent: true, fullHistory: true });
  }, [sessionToken, syncStatusQuery.data?.available]);

  // Interval auto-sync berkala
  useEffect(() => {
    if (!autoSyncBinance || !sessionToken || !syncStatusQuery.data?.available) return;
    const id = setInterval(() => {
      setSyncCountdown((c) => {
        if (c <= 1) {
          syncMutation.mutate({ isSilent: true, fullHistory: false });
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
    setTradeTs("");
  };

  // Mutasi Transaksi Manual
  const logMutation = useMutation({
    mutationFn: (data: {
      side: TradeSide;
      price: number;
      amount_usdt: number;
      note?: string;
      ts?: string;
    }) => logTradeFn({ data: { sessionToken: sessionToken ?? undefined, ...data } }),
    onSuccess: (res) => {
      if (res.ok) {
        resetTradeForm();
        setShowManualForm(false);
        pnlQuery.refetch();
        toast.success("Transaksi manual berhasil dicatat!");
      }
    },
    onError: handleAuthError,
  });

  const updateMutation = useMutation({
    mutationFn: (data: {
      id: number;
      side?: TradeSide;
      price?: number;
      amount_usdt?: number;
      note?: string | null;
      ts?: string;
    }) => updateTradeFn({ data: { sessionToken: sessionToken ?? undefined, ...data } }),
    onSuccess: (res) => {
      if (res.ok) {
        resetTradeForm();
        setShowManualForm(false);
        pnlQuery.refetch();
        toast.success("Transaksi berhasil diperbarui!");
      }
    },
    onError: handleAuthError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      deleteTradeFn({ data: { sessionToken: sessionToken ?? undefined, id } }),
    onMutate: (id) => setDeletingTradeId(id),
    onSettled: () => setDeletingTradeId(null),
    onSuccess: (res) => {
      if (res.ok) {
        if (editingTradeId === res.id) resetTradeForm();
        pnlQuery.refetch();
        toast.success("Transaksi dihapus.");
      }
    },
    onError: handleAuthError,
  });

  const handleStartEditTrade = (t: Trade) => {
    setEditingTradeId(t.id);
    setTradeSide(t.side);
    setTradePrice(String(t.price));
    setTradeAmount(String(t.amount_usdt));
    setTradeNote(t.note ?? "");
    const d = new Date(t.ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    setTradeTs(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
    setShowManualForm(true);
  };

  const handleTradeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseFloat(tradePrice.replace(/,/g, ""));
    const a = parseFloat(tradeAmount.replace(/,/g, ""));
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(a) || a <= 0) return;

    const isoTs = tradeTs ? new Date(tradeTs).toISOString() : undefined;
    const noteVal = tradeNote.trim() ? tradeNote.trim() : undefined;

    if (editingTradeId != null) {
      updateMutation.mutate({
        id: editingTradeId,
        side: tradeSide,
        price: p,
        amount_usdt: a,
        note: noteVal ?? null,
        ts: isoTs,
      });
    } else {
      logMutation.mutate({
        side: tradeSide,
        price: p,
        amount_usdt: a,
        note: noteVal,
        ts: isoTs,
      });
    }
  };

  const handleCopyPrice = (price: number, type: "buy" | "sell") => {
    if (!price) return;
    navigator.clipboard.writeText(String(Math.round(price)));
    setCopiedPrice(type);
    toast.success(`Harga ${type === "buy" ? "Beli" : "Jual"} (${fmtRp2(price)}) disalin ke clipboard!`);
    setTimeout(() => setCopiedPrice(null), 2000);
  };

  // Update history saat snapshot baru datang
  useEffect(() => {
    const s = snapshotQuery.data;
    if (!s) return;
    setHistory((prev) => {
      const nextPoint: HistoryPoint = {
        ts: s.timestamp || new Date().toISOString(),
        fair_price: s.fair_price,
      };
      if (prev.length && prev[prev.length - 1]!.ts === nextPoint.ts) {
        return prev;
      }
      const next = [...prev, nextPoint].slice(-100);
      saveHistory(next);
      return next;
    });
  }, [snapshotQuery.data]);


  const loginMutation = useMutation({
    mutationFn: (pwd: string) => loginFn({ data: { password: pwd } }),
    onSuccess: (res) => {
      if (res.ok && res.token) {
        setSessionToken(res.token);
        setAuthError(null);
        setPasswordInput("");
        try {
          sessionStorage.setItem(SESSION_KEY, res.token);
        } catch {
          // Abaikan
        }
      } else {
        setAuthError(res.error || "Password salah.");
      }
    },
    onError: (err) => setAuthError(String(err)),
  });

  const handleLogout = () => {
    setSessionToken(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Abaikan
    }
  };

  const chartData = useMemo(() => {
    return history.map((h) => ({
      time: new Date(h.ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      fair: h.fair_price,
    }));
  }, [history]);

  const fairDomain = useMemo(() => {
    if (!chartData.length) return [15000, 17000];
    const vals = chartData.map((d) => d.fair);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.15, 20);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [chartData]);

  if (!authInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground text-sm">
        <RefreshCw className="size-4 animate-spin mr-2" /> Memuat terminal...
      </div>
    );
  }

  // ── Login Gate (Sleek Fintech Auth) ─────────────────────────────────────────
  if (!sessionToken) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="panel w-full max-w-sm p-7 space-y-6 shadow-2xl">
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary border border-primary/30 shadow-lg shadow-primary/20">
              <Zap className="size-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">RADAR P2P PRO</h1>
            <p className="text-xs text-muted-foreground">
              Terminal Analisis Harga & Otomasi Merchant USDT/IDR
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (passwordInput.trim()) loginMutation.mutate(passwordInput);
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-muted-foreground font-medium">
                Password Dashboard
              </Label>
              <Input
                id="password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Masukkan password..."
                autoFocus
                className="bg-surface-2 border-border/80 text-foreground"
              />
            </div>

            {authError ? (
              <p className="rounded-lg bg-destructive/15 border border-destructive/30 px-3 py-2 text-xs text-destructive-foreground font-medium">
                {authError}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={loginMutation.isPending || !passwordInput.trim()}
              className="w-full font-semibold shadow-lg"
            >
              {loginMutation.isPending ? "Memverifikasi…" : "Buka Terminal"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const s = snapshotQuery.data;
  const pnl = pnlQuery.data;

  return (
    <div className="min-h-screen bg-background text-foreground pb-16">
      <Toaster position="top-right" richColors />

      {/* ── Top Live Ticker Header ──────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* Logo & Brand */}
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary border border-primary/30">
              <Zap className="size-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-extrabold tracking-tight text-foreground">RADAR P2P</span>
                <span className="rounded bg-primary/20 px-1.5 py-0.2 text-[0.6rem] font-bold text-primary tracking-wider uppercase">
                  PRO
                </span>
              </div>
              <span className="text-[0.65rem] text-muted-foreground block -mt-0.5">
                Binance C2C · USDT/IDR
              </span>
            </div>
          </div>

          {/* Real-time Ticker Badges */}
          {s ? (
            <div className="hidden lg:flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface-2/60 px-2.5 py-1">
                <span className="text-muted-foreground">Fair Price:</span>
                <span className="num font-bold text-foreground">{fmtRp2(s.fair_price)}</span>
              </div>

              <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface-2/60 px-2.5 py-1">
                <span className="text-muted-foreground">Spread:</span>
                <span className="num font-bold text-primary">+{fmtRp(s.spread_abs)} ({fmtPct(s.spread_pct)})</span>
              </div>

              {syncStatusQuery.data?.available ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-bid/25 bg-bid/10 px-2.5 py-1 text-bid">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-bid opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-bid" />
                  </span>
                  <span className="text-[0.7rem] font-semibold">Binance Sync Aktif</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Quick Actions & Logout */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => snapshotQuery.refetch()}
              disabled={snapshotQuery.isFetching}
              className="h-8 gap-1.5 text-xs bg-surface-2/80 hover:bg-surface-3"
            >
              <RefreshCw className={snapshotQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
              <span className="hidden sm:inline">Segarkan</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
              title="Keluar dari sesi"
            >
              <LogOut className="size-3.5 mr-1 sm:mr-1.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main Trading Terminal Body ───────────────────────────────────────── */}
      <main className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 space-y-6">

        {/* ── HERO: Dual Trading Cockpit (Buy & Sell Recommendations) ───────── */}
        {s ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* Kartu Rekomendasi BELI */}
            <div className="panel relative overflow-hidden p-5 md:col-span-6 glow-bid border-bid/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex size-2 rounded-full bg-bid" />
                  <span className="text-xs font-bold tracking-wider text-bid uppercase">
                    Harga Pasang Iklan BELI Anda
                  </span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopyPrice(s.my_buy_price, "buy")}
                  className="h-7 gap-1 border-bid/30 bg-bid/10 text-bid hover:bg-bid/20 text-xs font-semibold"
                >
                  {copiedPrice === "buy" ? (
                    <>
                      <Check className="size-3.5 text-bid" /> Disalin!
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" /> Salin Harga
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-3 flex items-baseline justify-between gap-2">
                <div className="num text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                  {fmtRp2(s.my_buy_price)}
                </div>
                <div className="num text-xs font-bold text-bid bg-bid/15 px-2 py-0.5 rounded-full border border-bid/20">
                  {fmtRp(s.my_buy_price - s.fair_price)} vs Fair
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-bid" />
                  <span>Kedalaman: <strong>{s.buy_depth.ads_used} iklan</strong> ({fmtRp(s.buy_depth.depth_reached_idr)})</span>
                </div>

                <a
                  href="https://p2p.binance.com/en/trade/buy/USDT?fiat=IDR"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-bid hover:underline font-medium"
                >
                  Buka P2P <ExternalLink className="size-3" />
                </a>
              </div>
            </div>

            {/* Kartu Rekomendasi JUAL */}
            <div className="panel relative overflow-hidden p-5 md:col-span-6 glow-ask border-ask/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex size-2 rounded-full bg-ask" />
                  <span className="text-xs font-bold tracking-wider text-ask uppercase">
                    Harga Pasang Iklan JUAL Anda
                  </span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopyPrice(s.my_sell_price, "sell")}
                  className="h-7 gap-1 border-ask/30 bg-ask/10 text-ask hover:bg-ask/20 text-xs font-semibold"
                >
                  {copiedPrice === "sell" ? (
                    <>
                      <Check className="size-3.5 text-ask" /> Disalin!
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" /> Salin Harga
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-3 flex items-baseline justify-between gap-2">
                <div className="num text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                  {fmtRp2(s.my_sell_price)}
                </div>
                <div className="num text-xs font-bold text-ask bg-ask/15 px-2 py-0.5 rounded-full border border-ask/20">
                  +{fmtRp(s.my_sell_price - s.fair_price)} vs Fair
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-ask" />
                  <span>Kedalaman: <strong>{s.sell_depth.ads_used} iklan</strong> ({fmtRp(s.sell_depth.depth_reached_idr)})</span>
                </div>

                <a
                  href="https://p2p.binance.com/en/trade/sell/USDT?fiat=IDR"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-ask hover:underline font-medium"
                >
                  Buka P2P <ExternalLink className="size-3" />
                </a>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── PRO WORKSPACE TABS ────────────────────────────────────────────── */}
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("pnl")}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                  activeTab === "pnl"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-surface-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="size-3.5" />
                Laporan Profit (PnL) & Riwayat
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("market")}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                  activeTab === "market"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-surface-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="size-3.5" />
                Order Book & Analisis Pasar
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("calculator")}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                  activeTab === "calculator"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-surface-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Calculator className="size-3.5" />
                Kalkulator Simulasi Margin
              </button>

              {s?.news_items && s.news_items.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("news")}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                    activeTab === "news"
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "bg-surface-2 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Newspaper className="size-3.5" />
                  Konteks Berita ({s.news_items.length})
                </button>
              ) : null}
            </div>
          </div>

          {/* ── TAB 1: LAPORAN PNL & TRANSAKSI OTOMATIS ─────────────────────── */}
          {activeTab === "pnl" && (
            <div className="space-y-6">
              {/* Financial Metric Cards Grid (WIB Timezone Aware) */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  label="Profit Hari Ini"
                  value={pnl ? `+${fmtRp(pnl.today_profit_idr)}` : "—"}
                  subvalue={
                    pnl
                      ? `${pnl.today_trades_count} transaksi (${fmtRp(pnl.today_turnover_idr)} omset)`
                      : undefined
                  }
                  tone="bid"
                  icon={<Sparkles className="size-4" />}
                  hint="Sejak 00:00 WIB hari ini"
                />

                <StatCard
                  label="Profit Kemarin"
                  value={pnl ? `+${fmtRp(pnl.yesterday_profit_idr)}` : "—"}
                  tone="primary"
                  icon={<History className="size-4" />}
                  hint="Rekap 24 jam penuh kemarin (WIB)"
                />

                <StatCard
                  label="Rolling 24 Jam"
                  value={pnl ? `+${fmtRp(pnl.last_24h_profit_idr)}` : "—"}
                  tone="bid"
                  icon={<TrendingUp className="size-4" />}
                  hint="Performa 24 jam non-stop"
                />

                <StatCard
                  label="Profit 7 Hari (Mingguan)"
                  value={pnl ? `+${fmtRp(pnl.week_profit_idr)}` : "—"}
                  subvalue={pnl ? `+${fmtRp(pnl.month_profit_idr)} (30 hari)` : undefined}
                  tone="primary"
                  icon={<Activity className="size-4" />}
                  hint="Perputaran 7 hari terakhir"
                />

                <StatCard
                  label="Sepanjang Masa"
                  value={pnl ? `+${fmtRp(pnl.all_time_profit_idr)}` : "—"}
                  subvalue={pnl ? `${pnl.total_trades_count} total transaksi` : undefined}
                  tone="primary"
                  icon={<Wallet className="size-4" />}
                  hint="Total laba terealisasi (FIFO)"
                />

                <StatCard
                  label="Stok Terbuka"
                  value={pnl ? `${pnl.open_position_usdt.toLocaleString("id-ID", { maximumFractionDigits: 1 })} USDT` : "—"}
                  subvalue={
                    pnl && pnl.open_position_usdt > 0
                      ? `Modal: ${fmtRp2(pnl.open_position_avg_cost_idr)}/USDT`
                      : "Stok seimbang"
                  }
                  tone="neutral"
                  icon={<Layers className="size-4" />}
                  hint={pnl ? `Avg margin: +${fmtRp(pnl.avg_profit_per_usdt_idr)}/USDT` : undefined}
                />
              </div>


              {/* Sync Actions & Manual Trade Trigger Toolbar */}
              <div className="panel p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {syncStatusQuery.data?.available ? (
                    <>
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5">
                        <Switch
                          id="auto-sync"
                          checked={autoSyncBinance}
                          onCheckedChange={setAutoSyncBinance}
                        />
                        <Label htmlFor="auto-sync" className="text-xs cursor-pointer text-muted-foreground font-medium">
                          Auto-sync{" "}
                          {autoSyncBinance ? (
                            <span className="text-foreground font-bold">({syncCountdown}s)</span>
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
                        className="gap-1.5 text-xs font-semibold"
                      >
                        <RefreshCw className={syncMutation.isPending ? "size-3.5 animate-spin" : "size-3.5"} />
                        {syncMutation.isPending ? "Menyinkronkan…" : "Sync Baru"}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFullHistorySync}
                        disabled={syncMutation.isPending}
                        className="gap-1.5 text-xs font-semibold border-primary/40 text-primary hover:bg-primary/10"
                        title="Tarik seluruh riwayat transaksi Binance C2C selama 6 bulan terakhir via API"
                      >
                        <History className="size-3.5" />
                        Tarik 6 Bulan (API)
                      </Button>
                    </>
                  ) : null}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importCsvMutation.isPending}
                    className="gap-1.5 text-xs font-semibold bg-surface-2 hover:bg-surface-3"
                    title="Unggah file ekspor CSV riwayat pesanan P2P langsung dari website Binance (Bebas kendala Geoblock / IP restriction)"
                  >
                    <FileSpreadsheet className={importCsvMutation.isPending ? "size-3.5 animate-pulse" : "size-3.5 text-emerald-400"} />
                    {importCsvMutation.isPending ? "Mengimpor CSV…" : "Import CSV Binance"}
                  </Button>
                </div>

                <Button
                  size="sm"
                  onClick={() => setShowManualForm(!showManualForm)}
                  className="gap-1.5 text-xs font-semibold"
                >
                  <Plus className="size-3.5" />
                  {showManualForm ? "Tutup Form" : "Catat Transaksi Manual"}
                </Button>
              </div>

              {/* Form Input Transaksi Manual (Collapsible) */}
              {showManualForm && (
                <div className="panel p-5 space-y-4 border-primary/30">
                  <div className="flex items-center justify-between border-b border-border/80 pb-2">
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                      {editingTradeId ? "Edit Transaksi Manual" : "Form Catat Transaksi Manual / Modal Awal"}
                    </h3>
                    <button
                      type="button"
                      onClick={resetTradeForm}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Batal
                    </button>
                  </div>

                  <form onSubmit={handleTradeSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div>
                      <Label className="text-[0.7rem] font-semibold text-muted-foreground uppercase">Sisi</Label>
                      <Select value={tradeSide} onValueChange={(v) => setTradeSide(v as TradeSide)}>
                        <SelectTrigger className="mt-1 bg-surface-2 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buy">Beli (Masuk Stok)</SelectItem>
                          <SelectItem value="sell">Jual (Keluar Stok)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-[0.7rem] font-semibold text-muted-foreground uppercase">Harga (IDR)</Label>
                      <Input
                        type="number"
                        placeholder="contoh 16200"
                        value={tradePrice}
                        onChange={(e) => setTradePrice(e.target.value)}
                        className="mt-1 bg-surface-2 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.7rem] font-semibold text-muted-foreground uppercase">Jumlah (USDT)</Label>
                      <Input
                        type="number"
                        placeholder="contoh 1000"
                        value={tradeAmount}
                        onChange={(e) => setTradeAmount(e.target.value)}
                        className="mt-1 bg-surface-2 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.7rem] font-semibold text-muted-foreground uppercase">Catatan / Lawan</Label>
                      <Input
                        placeholder="contoh @merchant_id"
                        value={tradeNote}
                        onChange={(e) => setTradeNote(e.target.value)}
                        className="mt-1 bg-surface-2 text-xs"
                      />
                    </div>

                    <div className="flex items-end">
                      <Button
                        type="submit"
                        disabled={logMutation.isPending || updateMutation.isPending}
                        className="w-full text-xs font-semibold"
                      >
                        {editingTradeId ? "Simpan Perubahan" : "Tambah Transaksi"}
                      </Button>
                    </div>
                  </form>
                </div>
              )}

              {/* Tabel Riwayat Transaksi */}
              <div className="panel p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-border/80 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-foreground tracking-wide uppercase">
                      Riwayat Transaksi Merchant
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Daftar transaksi tersimpan dari Binance Sync & Manual dengan standar akuntansi FIFO.
                    </p>
                  </div>
                </div>

                <TradesTable
                  trades={pnl?.recent_trades ?? []}
                  onEdit={handleStartEditTrade}
                  onDelete={(t) => deleteMutation.mutate(t.id)}
                  editingId={editingTradeId}
                  deletingId={deletingTradeId}
                />
              </div>
            </div>
          )}

          {/* ── TAB 2: ORDER BOOK & ANALISIS PASAR ───────────────────────────── */}
          {activeTab === "market" && (
            <div className="space-y-6">
              {/* Order book kompetitor */}
              <div className="panel p-5">
                <Tabs defaultValue="sell">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                        Order Book Kompetitor Real-Time
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Iklan kompetitor yang lolos filter likuiditas & outlier di pasar P2P Binance.
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => snapshotQuery.refetch()}
                        disabled={snapshotQuery.isFetching}
                        className="gap-1.5 text-xs font-semibold h-8"
                      >
                        <RefreshCw className={snapshotQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
                        {snapshotQuery.isFetching ? "Memuat Pasar…" : "Refresh Order Book"}
                      </Button>

                      <TabsList className="bg-surface-2">
                        <TabsTrigger value="sell" className="text-xs">
                          Acuan Iklan JUAL ({s?.sell_ref_count_clean ?? (s?.top_sell_ref_ads?.length || 0)})
                        </TabsTrigger>
                        <TabsTrigger value="buy" className="text-xs">
                          Acuan Iklan BELI ({s?.buy_ref_count_clean ?? (s?.top_buy_ref_ads?.length || 0)})
                        </TabsTrigger>
                      </TabsList>
                    </div>
                  </div>

                  <TabsContent value="sell" className="mt-4">
                    {snapshotQuery.isPending && !s ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                        <RefreshCw className="size-6 animate-spin text-primary mb-2" />
                        <p className="text-xs">Sedang menghubungkan ke feed pasar Binance P2P…</p>
                      </div>
                    ) : (
                      <AdsTable ads={s?.top_sell_ref_ads ?? []} side="ask" />
                    )}
                  </TabsContent>

                  <TabsContent value="buy" className="mt-4">
                    {snapshotQuery.isPending && !s ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                        <RefreshCw className="size-6 animate-spin text-primary mb-2" />
                        <p className="text-xs">Sedang menghubungkan ke feed pasar Binance P2P…</p>
                      </div>
                    ) : (
                      <AdsTable ads={s?.top_buy_ref_ads ?? []} side="bid" />
                    )}
                  </TabsContent>
                </Tabs>
              </div>


              {/* Grafik Riwayat Fair Price & Intel Pasar */}
              {s && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  {/* Grafik Fair Price */}
                  <div className="panel p-5 lg:col-span-8 space-y-4">
                    <div className="flex items-center justify-between border-b border-border/80 pb-2">
                      <div>
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                          Pergerakan Fair Price USDT/IDR
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Titik temu pasar P2P berbasis weighted mid-price order book.
                        </p>
                      </div>
                      <span className="num font-bold text-sm text-primary">{fmtRp2(s.fair_price)}</span>
                    </div>

                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fairGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                              <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <YAxis domain={fairDomain} hide />
                          <Tooltip
                            contentStyle={{
                              background: "oklch(0.18 0.02 260 / 95%)",
                              border: "1px solid oklch(1 0 0 / 12%)",
                              borderRadius: "0.5rem",
                              fontSize: "0.75rem",
                            }}
                            formatter={(v: any) => [fmtRp2(Number(v)), "Fair Price"]}
                          />
                          <Area
                            type="monotone"
                            dataKey="fair"
                            stroke="var(--color-primary)"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#fairGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Sinyal Pasar & Kedalaman Likuiditas */}
                  <div className="panel p-5 lg:col-span-4 space-y-4 flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-foreground uppercase tracking-wide border-b border-border/80 pb-2">
                        Sinyal & Intel Pasar
                      </h3>

                      <div className="mt-3 space-y-3 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Bias Pasar:</span>
                          <span className="font-bold text-foreground">{biasLabel(s.bias ?? "neutral")}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Tingkat Keyakinan:</span>
                          <span className="font-bold text-foreground">{confidenceLabel(s.confidence ?? 50)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Likuiditas Pasar:</span>
                          <span className="font-bold text-primary">{liquidityLabel(s.liquidity_class ?? "normal")}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Kedalaman Beli:</span>
                          <span className="font-bold text-bid">{s.buy_depth?.depth_sufficient ? "Cukup Tercover" : "Tipis"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Kedalaman Jual:</span>
                          <span className="font-bold text-ask">{s.sell_depth?.depth_sufficient ? "Cukup Tercover" : "Tipis"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg bg-surface-2/60 p-3 text-[0.7rem] text-muted-foreground">
                      💡 <strong>Tips Merchant:</strong> Pasang harga iklan Beli pada <strong className="text-bid">{fmtRp2(s.my_buy_price)}</strong> dan Jual pada <strong className="text-ask">{fmtRp2(s.my_sell_price)}</strong> untuk perputaran maksimal.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: KALKULATOR SIMULASI MARGIN ───────────────────────────── */}
          {activeTab === "calculator" && (
            <MarginCalculator
              defaultBuyPrice={s?.my_buy_price || 16200}
              defaultSellPrice={s?.my_sell_price || 16350}
            />
          )}

          {/* ── TAB 4: KONTEKS BERITA ───────────────────────────────────────── */}
          {activeTab === "news" && s && s.news_items && (
            <div className="panel p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-border/80 pb-2">
                <Newspaper className="size-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                  Konteks Berita Pasar Terkini
                </h3>
              </div>

              <ul className="divide-y divide-border/40 space-y-2">
                {s.news_items.map((n) => (
                  <li key={n.link || n.title} className="pt-2">
                    <a
                      href={n.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs text-foreground/90 hover:text-primary hover:underline transition-colors flex items-center justify-between gap-2"
                    >
                      <span>{n.title}</span>
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

