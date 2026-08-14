import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  Check,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  History,
  Layers,
  Lock,
  LogOut,
  Newspaper,
  Plus,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { toast } from "sonner";

import { AdsTable } from "@/components/p2p/AdsTable";
import { MarginCalculator } from "@/components/p2p/MarginCalculator";
import { StatCard } from "@/components/p2p/StatCard";
import { TradesTable } from "@/components/p2p/TradesTable";
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
} from "@/lib/p2p-engine";
import { login } from "@/lib/auth";
import {
  getBinanceSyncStatus,
  importBinanceCsvTrades,
  syncBinanceTrades,
  type SyncResult,
} from "@/lib/binance-sync";
import { getMarketSnapshot } from "@/lib/p2p.functions";
import { deleteTrade, getPnlSummary, logTrade, updateTrade, type TradeSide } from "@/lib/pnl";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Radar P2P — Terminal Merchant Binance USDT/IDR" },
      {
        name: "description",
        content: "Terminal analisis harga pasar USDT/IDR, pencatatan transaksi otomatis, dan manajemen profit merchant.",
      },
    ],
  }),
  component: Dashboard,
});

const HISTORY_KEY = "p2p_price_history";
const SESSION_KEY = "p2p_session_token";
const POLL_SECONDS = 60;
const BINANCE_SYNC_SECONDS = 180;

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
    // Abaikan
  }
}

function BrandLogo({ className = "size-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="32" height="32" rx="8" fill="#181E2A" />
      <path
        d="M16 6L24 11.5V20.5L16 26L8 20.5V11.5L16 6Z"
        stroke="#F59E0B"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3.5" fill="#10B981" />
      <path
        d="M16 9.5V12.5M16 19.5V22.5M10.5 13L13 14.5M19 17.5L21.5 19M21.5 13L19 14.5M13 17.5L10.5 19"
        stroke="#F59E0B"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
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
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);
  const [deletingTradeId, setDeletingTradeId] = useState<number | null>(null);

  // State Auto-sync Binance
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
      syncStatusQuery.refetch();
      pnlQuery.refetch();
      if (res.not_configured) {
        toast.error("Binance API Key & Secret belum dikonfigurasi.");
      } else if (!res.ok && res.error) {
        toast.error(`Gagal sinkronisasi: ${res.error}`);
      } else if (res.ok && res.added > 0) {
        toast.success(`${res.added} transaksi baru berhasil disinkronkan.`);
      } else if (!vars?.isSilent && res.ok && res.added === 0) {
        toast.info(
          vars?.fullHistory
            ? "Semua data transaksi sudah tersimpan."
            : "Data transaksi sudah mutakhir.",
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
        toast.success(`Berhasil mengimpor ${res.added} transaksi. (${res.skipped} terlewati/duplikat)`);
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
      importCsvMutation.mutate(text);
    } catch {
      toast.error("Gagal membaca file CSV.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleBinanceSync = () => syncMutation.mutate({ isSilent: false });
  const handleFullHistorySync = () => syncMutation.mutate({ isSilent: false, fullHistory: true });

  // Countdown & Trigger Auto-sync
  useEffect(() => {
    if (!autoSyncBinance || !syncStatusQuery.data?.available) return;

    const timer = setInterval(() => {
      setSyncCountdown((prev) => {
        if (prev <= 1) {
          syncMutation.mutate({ isSilent: true });
          return BINANCE_SYNC_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoSyncBinance, syncStatusQuery.data?.available, syncMutation]);

  // Update histori saat snapshot baru masuk
  useEffect(() => {
    if (!snapshotQuery.data) return;
    setHistory(snapshotQuery.data.history);
    saveHistory(snapshotQuery.data.history);
  }, [snapshotQuery.data]);

  // Mutasi Login
  const loginMutation = useMutation({
    mutationFn: (password: string) => loginFn({ data: { password } }),
    onSuccess: (res) => {
      if (res.ok && res.token) {
        setSessionToken(res.token);
        try {
          sessionStorage.setItem(SESSION_KEY, res.token);
        } catch {
          // Abaikan
        }
        setAuthError(null);
        setPasswordInput("");
        toast.success("Berhasil masuk.");
      } else {
        setAuthError("Password tidak sesuai.");
      }
    },
    onError: () => setAuthError("Terjadi kendala saat verifikasi."),
  });

  const handleLogout = () => {
    setSessionToken(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Abaikan
    }
    toast.info("Anda telah keluar.");
  };

  // Mutasi Transaksi Manual (Tambah / Edit / Hapus)
  const logMutation = useMutation({
    mutationFn: (data: { side: TradeSide; price: number; amountUsdt: number; note?: string }) =>
      logTradeFn({ data: { ...data, sessionToken: sessionToken ?? undefined } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Transaksi tersimpan.");
        resetTradeForm();
        pnlQuery.refetch();
      } else {
        toast.error("Gagal menyimpan transaksi.");
      }
    },
    onError: handleAuthError,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; side: TradeSide; price: number; amountUsdt: number; note?: string }) =>
      updateTradeFn({ data: { ...data, sessionToken: sessionToken ?? undefined } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Perubahan transaksi tersimpan.");
        resetTradeForm();
        pnlQuery.refetch();
      } else {
        toast.error("Gagal memperbarui transaksi.");
      }
    },
    onError: handleAuthError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      deleteTradeFn({ data: { id, sessionToken: sessionToken ?? undefined } }),
    onMutate: (id) => setDeletingTradeId(id),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Transaksi dihapus.");
        pnlQuery.refetch();
      } else {
        toast.error("Gagal menghapus transaksi.");
      }
    },
    onError: handleAuthError,
    onSettled: () => setDeletingTradeId(null),
  });

  const resetTradeForm = () => {
    setTradePrice("");
    setTradeAmount("");
    setTradeNote("");
    setEditingTradeId(null);
    setShowManualForm(false);
  };

  const handleStartEditTrade = (t: { id: number; side: TradeSide; price: number; amount_usdt: number; note: string | null }) => {
    setEditingTradeId(t.id);
    setTradeSide(t.side);
    setTradePrice(String(t.price));
    setTradeAmount(String(t.amount_usdt));
    setTradeNote(t.note ?? "");
    setShowManualForm(true);
  };

  const handleTradeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseFloat(tradePrice);
    const a = parseFloat(tradeAmount);
    if (!Number.isFinite(p) || p <= 0) {
      toast.error("Harga harus berupa angka positif.");
      return;
    }
    if (!Number.isFinite(a) || a <= 0) {
      toast.error("Jumlah USDT harus berupa angka positif.");
      return;
    }

    if (editingTradeId !== null) {
      updateMutation.mutate({
        id: editingTradeId,
        side: tradeSide,
        price: p,
        amountUsdt: a,
        note: tradeNote.trim() || undefined,
      });
    } else {
      logMutation.mutate({
        side: tradeSide,
        price: p,
        amountUsdt: a,
        note: tradeNote.trim() || undefined,
      });
    }
  };

  const handleCopyPrice = (val: number, side: "buy" | "sell") => {
    navigator.clipboard.writeText(String(Math.round(val)));
    setCopiedPrice(side);
    toast.success(`Harga ${fmtRp2(val)} disalin.`);
    setTimeout(() => setCopiedPrice(null), 2000);
  };

  const chartData = useMemo(
    () => history.map((pt) => ({ time: pt.ts.slice(11, 16), fair: pt.fair_price })),
    [history],
  );

  const fairDomain = useMemo(() => {
    if (chartData.length === 0) return [16000, 16500];
    const vals = chartData.map((d) => d.fair);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.15, 20);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [chartData]);

  if (!authInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground text-xs">
        <RefreshCw className="size-4 animate-spin mr-2" /> Memuat terminal...
      </div>
    );
  }

  // ── Login Screen ───────────────────────────────────────────────────────────
  if (!sessionToken) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-background">
        <div className="panel w-full max-w-sm p-6 space-y-5">
          <div className="flex flex-col items-center text-center space-y-1.5">
            <BrandLogo className="size-9 mb-1" />
            <h1 className="text-base font-bold text-foreground">Radar P2P</h1>
            <p className="text-xs text-muted-foreground">
              Terminal Merchant Binance USDT/IDR
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (passwordInput.trim()) loginMutation.mutate(passwordInput);
            }}
            className="space-y-3.5"
          >
            <div className="space-y-1">
              <Label htmlFor="password" className="text-xs text-muted-foreground font-medium">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Masukkan password..."
                autoFocus
                className="bg-surface-2 border-border text-foreground text-xs h-9"
              />
            </div>

            {authError ? (
              <p className="rounded bg-destructive/10 border border-destructive/20 px-2.5 py-1.5 text-xs text-destructive">
                {authError}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={loginMutation.isPending || !passwordInput.trim()}
              className="w-full text-xs font-semibold h-9"
            >
              {loginMutation.isPending ? "Memverifikasi…" : "Masuk ke Terminal"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const s = snapshotQuery.data;
  const pnl = pnlQuery.data;

  return (
    <div className="min-h-screen bg-background text-foreground pb-12">
      <Toaster position="top-right" richColors />

      {/* ── Top Header ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* Logo & Brand */}
          <div className="flex items-center gap-2.5">
            <BrandLogo className="size-6" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-foreground">Radar P2P</span>
                <span className="rounded bg-surface-2 border border-border px-1.5 py-0.2 text-[0.6rem] font-semibold text-muted-foreground">
                  USDT/IDR
                </span>
              </div>
            </div>
          </div>

          {/* Ticker Badges */}
          {s ? (
            <div className="hidden md:flex items-center gap-2.5 text-xs">
              <div className="flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 py-1">
                <span className="text-muted-foreground">Nilai Wajar:</span>
                <span className="num font-bold text-foreground">{fmtRp2(s.fair_price)}</span>
              </div>

              <div className="flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 py-1">
                <span className="text-muted-foreground">Spread:</span>
                <span className="num font-bold text-primary">+{fmtRp(s.spread_abs)} ({fmtPct(s.spread_pct)})</span>
              </div>

              {syncStatusQuery.data?.available ? (
                <div className="flex items-center gap-1.5 rounded border border-bid/25 bg-bid/10 px-2 py-1 text-bid text-[0.7rem]">
                  <span className="size-1.5 rounded-full bg-bid" />
                  <span>Sync Aktif</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Actions & Logout */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                snapshotQuery.refetch();
                pnlQuery.refetch();
              }}
              disabled={snapshotQuery.isFetching || pnlQuery.isFetching}
              className="h-7.5 gap-1.5 text-xs bg-surface-2 hover:bg-surface-3"
            >
              <RefreshCw className={snapshotQuery.isFetching ? "size-3 animate-spin" : "size-3"} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="h-7.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-3.5 mr-1" />
              <span className="hidden sm:inline">Keluar</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main Body ───────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 space-y-5">

        {/* ── Dual Trading Recommendations ─────────────────────────────────── */}
        {s ? (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-12">
            {/* Rekomendasi BELI */}
            <div className="panel p-4.5 md:col-span-6 border-bid/25">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-bid" />
                  <span className="text-xs font-bold text-bid uppercase tracking-wider">
                    Rekomendasi Pasang Beli
                  </span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopyPrice(s.my_buy_price, "buy")}
                  className="h-6.5 gap-1 border-bid/25 bg-bid/10 text-bid hover:bg-bid/20 text-xs font-semibold px-2"
                >
                  {copiedPrice === "buy" ? (
                    <>
                      <Check className="size-3" /> Disalin
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" /> Salin
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-2.5 flex items-baseline justify-between gap-2">
                <div className="num text-2xl sm:text-3xl font-bold text-foreground">
                  {fmtRp2(s.my_buy_price)}
                </div>
                <div className="num text-xs font-medium text-bid">
                  {fmtRp(s.my_buy_price - s.fair_price)} vs Nilai Wajar
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
                <span>Kedalaman: <strong>{s.buy_depth.ads_used} iklan</strong> ({fmtRp(s.buy_depth.depth_reached_idr)})</span>
                <a
                  href="https://p2p.binance.com/en/trade/buy/USDT?fiat=IDR"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-bid hover:underline"
                >
                  Binance P2P <ExternalLink className="size-3" />
                </a>
              </div>
            </div>

            {/* Rekomendasi JUAL */}
            <div className="panel p-4.5 md:col-span-6 border-ask/25">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-ask" />
                  <span className="text-xs font-bold text-ask uppercase tracking-wider">
                    Rekomendasi Pasang Jual
                  </span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopyPrice(s.my_sell_price, "sell")}
                  className="h-6.5 gap-1 border-ask/25 bg-ask/10 text-ask hover:bg-ask/20 text-xs font-semibold px-2"
                >
                  {copiedPrice === "sell" ? (
                    <>
                      <Check className="size-3" /> Disalin
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" /> Salin
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-2.5 flex items-baseline justify-between gap-2">
                <div className="num text-2xl sm:text-3xl font-bold text-foreground">
                  {fmtRp2(s.my_sell_price)}
                </div>
                <div className="num text-xs font-medium text-ask">
                  +{fmtRp(s.my_sell_price - s.fair_price)} vs Nilai Wajar
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
                <span>Kedalaman: <strong>{s.sell_depth.ads_used} iklan</strong> ({fmtRp(s.sell_depth.depth_reached_idr)})</span>
                <a
                  href="https://p2p.binance.com/en/trade/sell/USDT?fiat=IDR"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-ask hover:underline"
                >
                  Binance P2P <ExternalLink className="size-3" />
                </a>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Navigation Tabs ──────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab("pnl")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === "pnl"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Wallet className="size-3.5" />
                Laporan & Transaksi
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("market")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === "market"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="size-3.5" />
                Buku Pesanan
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("calculator")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === "calculator"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Calculator className="size-3.5" />
                Simulasi Margin
              </button>

              {s?.news_items && s.news_items.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("news")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeTab === "news"
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-2 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Newspaper className="size-3.5" />
                  Berita Pasar ({s.news_items.length})
                </button>
              ) : null}
            </div>
          </div>

          {/* ── TAB 1: LAPORAN & TRANSAKSI ──────────────────────────────────── */}
          {activeTab === "pnl" && (
            <div className="space-y-5">
              {/* Financial Metric Cards */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  label="Hari Ini"
                  value={pnl ? `+${fmtRp(pnl.today_profit_idr)}` : "—"}
                  subvalue={
                    pnl
                      ? `${pnl.today_trades_count} transaksi (${fmtRp(pnl.today_turnover_idr)} omset)`
                      : undefined
                  }
                  tone="bid"
                  hint="Sejak 00:00 WIB"
                />

                <StatCard
                  label="Kemarin"
                  value={pnl ? `+${fmtRp(pnl.yesterday_profit_idr)}` : "—"}
                  tone="neutral"
                  hint="24 jam penuh kemarin"
                />

                <StatCard
                  label="24 Jam Terakhir"
                  value={pnl ? `+${fmtRp(pnl.last_24h_profit_idr)}` : "—"}
                  tone="bid"
                  hint="Performa rolling 24 jam"
                />

                <StatCard
                  label="7 Hari"
                  value={pnl ? `+${fmtRp(pnl.week_profit_idr)}` : "—"}
                  subvalue={pnl ? `+${fmtRp(pnl.month_profit_idr)} (30 hari)` : undefined}
                  tone="neutral"
                  hint="Akumulasi mingguan"
                />

                <StatCard
                  label="Total Realisasi"
                  value={pnl ? `+${fmtRp(pnl.all_time_profit_idr)}` : "—"}
                  subvalue={pnl ? `${pnl.total_trades_count} total transaksi` : undefined}
                  tone="neutral"
                  hint="Laba bersih setelah fee"
                />

                <StatCard
                  label="Sisa Stok USDT"
                  value={pnl ? `${pnl.open_position_usdt.toLocaleString("id-ID", { maximumFractionDigits: 1 })} USDT` : "—"}
                  subvalue={
                    pnl && pnl.open_position_usdt > 0
                      ? `Modal: ${fmtRp2(pnl.open_position_avg_cost_idr)}`
                      : "Stok seimbang"
                  }
                  tone="neutral"
                  hint={pnl ? `Margin avg: +${fmtRp(pnl.avg_profit_per_usdt_idr)}/USDT` : undefined}
                />
              </div>

              {/* Toolbar Aksi */}
              <div className="panel p-3.5 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {syncStatusQuery.data?.available ? (
                    <>
                      <div className="flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 py-1">
                        <Switch
                          id="auto-sync"
                          checked={autoSyncBinance}
                          onCheckedChange={setAutoSyncBinance}
                        />
                        <Label htmlFor="auto-sync" className="text-xs cursor-pointer text-muted-foreground">
                          Auto-sync{" "}
                          {autoSyncBinance ? (
                            <span className="text-foreground font-semibold">({syncCountdown}s)</span>
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
                        className="gap-1 text-xs h-8"
                      >
                        <RefreshCw className={syncMutation.isPending ? "size-3 animate-spin" : "size-3"} />
                        {syncMutation.isPending ? "Sinkronisasi…" : "Sync Baru"}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFullHistorySync}
                        disabled={syncMutation.isPending}
                        className="gap-1 text-xs h-8 text-primary border-primary/30 hover:bg-primary/10"
                      >
                        <History className="size-3" />
                        Tarik Riwayat
                      </Button>
                    </>
                  ) : null}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importCsvMutation.isPending}
                    className="gap-1 text-xs h-8 bg-surface-2 hover:bg-surface-3"
                  >
                    <FileSpreadsheet className={importCsvMutation.isPending ? "size-3 animate-pulse" : "size-3 text-emerald-400"} />
                    {importCsvMutation.isPending ? "Mengimpor…" : "Impor CSV"}
                  </Button>
                </div>

                <Button
                  size="sm"
                  onClick={() => setShowManualForm(!showManualForm)}
                  className="gap-1 text-xs h-8"
                >
                  <Plus className="size-3.5" />
                  {showManualForm ? "Tutup Form" : "Catat Transaksi"}
                </Button>
              </div>

              {/* Form Input Transaksi Manual */}
              {showManualForm && (
                <div className="panel p-4 space-y-3 border-primary/30">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <h3 className="text-xs font-semibold text-foreground">
                      {editingTradeId ? "Edit Transaksi" : "Catat Transaksi Manual"}
                    </h3>
                    <button
                      type="button"
                      onClick={resetTradeForm}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Batal
                    </button>
                  </div>

                  <form onSubmit={handleTradeSubmit} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                    <div>
                      <Label className="text-[0.7rem] text-muted-foreground">Sisi</Label>
                      <Select value={tradeSide} onValueChange={(v) => setTradeSide(v as TradeSide)}>
                        <SelectTrigger className="mt-1 bg-surface-2 text-xs h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buy">Beli (Masuk Stok)</SelectItem>
                          <SelectItem value="sell">Jual (Keluar Stok)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-[0.7rem] text-muted-foreground">Harga (IDR)</Label>
                      <Input
                        type="number"
                        placeholder="contoh: 17820"
                        value={tradePrice}
                        onChange={(e) => setTradePrice(e.target.value)}
                        className="mt-1 bg-surface-2 text-xs h-8"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.7rem] text-muted-foreground">Jumlah (USDT)</Label>
                      <Input
                        type="number"
                        placeholder="contoh: 1000"
                        value={tradeAmount}
                        onChange={(e) => setTradeAmount(e.target.value)}
                        className="mt-1 bg-surface-2 text-xs h-8"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.7rem] text-muted-foreground">Catatan / Lawan</Label>
                      <Input
                        placeholder="opsional..."
                        value={tradeNote}
                        onChange={(e) => setTradeNote(e.target.value)}
                        className="mt-1 bg-surface-2 text-xs h-8"
                      />
                    </div>

                    <div className="flex items-end">
                      <Button
                        type="submit"
                        disabled={logMutation.isPending || updateMutation.isPending}
                        className="w-full text-xs font-semibold h-8"
                      >
                        {editingTradeId ? "Simpan" : "Tambah"}
                      </Button>
                    </div>
                  </form>
                </div>
              )}

              {/* Tabel Riwayat Transaksi */}
              <div className="panel p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <div>
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Riwayat Transaksi
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Semua transaksi tercatat via Sinkronisasi Binance & Input Manual.
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

          {/* ── TAB 2: BUKU PESANAN (ORDER BOOK) ────────────────────────────── */}
          {activeTab === "market" && (
            <div className="space-y-5">
              <div className="panel p-4 space-y-3">
                <Tabs defaultValue="sell">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border pb-2.5">
                    <div>
                      <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                        Buku Pesanan Binance P2P
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Daftar iklan kompetitor terverifikasi di pasar USDT/IDR.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => snapshotQuery.refetch()}
                        disabled={snapshotQuery.isFetching}
                        className="gap-1 text-xs h-7.5"
                      >
                        <RefreshCw className={snapshotQuery.isFetching ? "size-3 animate-spin" : "size-3"} />
                        {snapshotQuery.isFetching ? "Memuat…" : "Refresh"}
                      </Button>

                      <TabsList className="bg-surface-2 h-7.5">
                        <TabsTrigger value="sell" className="text-xs px-2.5">
                          Iklan JUAL ({s?.sell_ref_count_clean ?? (s?.top_sell_ref_ads?.length || 0)})
                        </TabsTrigger>
                        <TabsTrigger value="buy" className="text-xs px-2.5">
                          Iklan BELI ({s?.buy_ref_count_clean ?? (s?.top_buy_ref_ads?.length || 0)})
                        </TabsTrigger>
                      </TabsList>
                    </div>
                  </div>

                  <TabsContent value="sell" className="mt-3">
                    {snapshotQuery.isPending && !s ? (
                      <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground text-xs">
                        <RefreshCw className="size-5 animate-spin text-primary mb-2" />
                        <span>Memuat data buku pesanan Binance…</span>
                      </div>
                    ) : (
                      <AdsTable ads={s?.top_sell_ref_ads ?? []} side="ask" />
                    )}
                  </TabsContent>

                  <TabsContent value="buy" className="mt-3">
                    {snapshotQuery.isPending && !s ? (
                      <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground text-xs">
                        <RefreshCw className="size-5 animate-spin text-primary mb-2" />
                        <span>Memuat data buku pesanan Binance…</span>
                      </div>
                    ) : (
                      <AdsTable ads={s?.top_buy_ref_ads ?? []} side="bid" />
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Grafik Nilai Wajar & Intel Pasar */}
              {s && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  {/* Grafik Fair Price */}
                  <div className="panel p-4 lg:col-span-8 space-y-3">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <div>
                        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                          Grafik Nilai Wajar USDT/IDR
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Titik tengah pasar P2P berbasis weighted mid-price.
                        </p>
                      </div>
                      <span className="num font-bold text-sm text-primary">{fmtRp2(s.fair_price)}</span>
                    </div>

                    <div className="h-52 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fairGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <YAxis domain={fairDomain} hide />
                          <Tooltip
                            contentStyle={{
                              background: "#12161F",
                              border: "1px solid rgba(255, 255, 255, 0.1)",
                              borderRadius: "0.375rem",
                              fontSize: "0.75rem",
                            }}
                            formatter={(v: any) => [fmtRp2(Number(v)), "Nilai Wajar"]}
                          />
                          <Area
                            type="monotone"
                            dataKey="fair"
                            stroke="#F59E0B"
                            strokeWidth={1.8}
                            fillOpacity={1}
                            fill="url(#fairGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Sinyal Pasar */}
                  <div className="panel p-4 lg:col-span-4 space-y-3 flex flex-col justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-foreground uppercase tracking-wider border-b border-border pb-2">
                        Sinyal & Kondisi Pasar
                      </h3>

                      <div className="mt-3 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Bias Pasar:</span>
                          <span className="font-semibold text-foreground">{biasLabel(s.bias ?? "neutral")}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Keyakinan:</span>
                          <span className="font-semibold text-foreground">{confidenceLabel(s.confidence ?? 50)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Likuiditas:</span>
                          <span className="font-semibold text-primary">{liquidityLabel(s.liquidity_class ?? "normal")}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Kedalaman Beli:</span>
                          <span className="font-semibold text-bid">{s.buy_depth?.depth_sufficient ? "Tercover" : "Tipis"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Kedalaman Jual:</span>
                          <span className="font-semibold text-ask">{s.sell_depth?.depth_sufficient ? "Tercover" : "Tipis"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded border border-border bg-surface-2 p-2.5 text-[0.7rem] text-muted-foreground">
                      Target spread optimal: Beli di <strong className="text-bid">{fmtRp2(s.my_buy_price)}</strong> | Jual di <strong className="text-ask">{fmtRp2(s.my_sell_price)}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: KALKULATOR SIMULASI MARGIN ───────────────────────────── */}
          {activeTab === "calculator" && (
            <MarginCalculator
              defaultBuyPrice={s?.my_buy_price || 17780}
              defaultSellPrice={s?.my_sell_price || 17830}
            />
          )}

          {/* ── TAB 4: BERITA PASAR ─────────────────────────────────────────── */}
          {activeTab === "news" && s?.news_items && (
            <div className="panel p-4 space-y-3">
              <div className="border-b border-border pb-2">
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Berita Terkait Pasar & Nilai Tukar
                </h3>
                <p className="text-xs text-muted-foreground">
                  Informasi terkini seputar pergerakan Rupiah dan pasar kripto Indonesia.
                </p>
              </div>

              <div className="divide-y divide-border">
                {s.news_items.map((n, idx) => (
                  <div key={idx} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                    <span className="text-xs text-foreground">{n.title}</span>
                    <a
                      href={n.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0 font-medium"
                    >
                      Baca <ExternalLink className="size-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
