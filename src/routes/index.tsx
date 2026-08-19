import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  Check,
  Coins,
  Copy,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Globe,
  History,
  Landmark,
  Layers,
  Lock,
  LogOut,
  Newspaper,
  Percent,
  PiggyBank,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sliders,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { toast } from "sonner";

import { AdsTable } from "@/components/p2p/AdsTable";
import { ArbitrageScanner } from "@/components/p2p/ArbitrageScanner";
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
  getBinanceFundingBalance,
  getBinanceSyncStatus,
  importBinanceCsvTrades,
  syncBinanceTrades,
  type FundingBalance,
  type SyncResult,
} from "@/lib/binance-sync";
import { getMarketSnapshot } from "@/lib/p2p.functions";
import {
  deleteTrade,
  getInitialCapital,
  getPnlSummary,
  logTrade,
  normalizeTradePrice,
  parseFlexibleNumber,
  resetCustomStockCost,
  setCustomStockCost,
  setInitialCapital,
  updateTrade,
  type TradeSide,
} from "@/lib/pnl";

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
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p === "object" && typeof p.ts === "string" && Number.isFinite(Number(p.fair_price)))
      .slice(-100);
  } catch {
    return [];
  }
}

function saveHistory(h: HistoryPoint[]): void {
  try {
    if (!Array.isArray(h)) return;
    const clean = h.filter((p) => p && typeof p === "object" && typeof p.ts === "string" && Number.isFinite(Number(p.fair_price)));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(clean.slice(-100)));
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

function ImpactBadge({ impact }: { impact?: string }) {
  if (impact === "bullish_usdt") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[0.65rem] font-bold text-emerald-400">
        <ArrowUpRight className="size-3" /> Bullish USDT (+)
      </span>
    );
  }
  if (impact === "bearish_usdt") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[0.65rem] font-bold text-rose-400">
        <ArrowDownRight className="size-3" /> Bearish USDT (-)
      </span>
    );
  }
  if (impact === "volatility") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[0.65rem] font-bold text-amber-400">
        <Activity className="size-3" /> Volatilitas (⚡)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-3 border border-border px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
      Netral (—)
    </span>
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
  const [activeTab, setActiveTab] = useState<"pnl" | "market" | "calculator" | "arbitrage" | "news">("pnl");

  const [newsCategoryFilter, setNewsCategoryFilter] = useState<"all" | "kurs_rupiah" | "kebijakan_fed_bi" | "pasar_kripto">("all");


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
  const setCapitalFn = useServerFn(setInitialCapital);
  const setCustomCostFn = useServerFn(setCustomStockCost);
  const resetCustomCostFn = useServerFn(resetCustomStockCost);
  const importCsvFn = useServerFn(importBinanceCsvTrades);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State Modal Awal (Capital Management)
  const [isEditingCapital, setIsEditingCapital] = useState(false);
  const [capitalInputStr, setCapitalInputStr] = useState("");

  // State Atur & Reset Harga Modal Stok (HPP)
  const [isEditingStockCost, setIsEditingStockCost] = useState(false);
  const [stockCostInputStr, setStockCostInputStr] = useState("");

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

  // Query Saldo Funding Wallet (real-time, poll setiap 30 detik)
  const fundingBalanceQuery = useQuery({
    queryKey: ["binance-funding-balance"],
    queryFn: () => fundingBalanceFn({ data: { sessionToken: sessionToken ?? undefined } }),
    enabled: Boolean(sessionToken) && Boolean(syncStatusQuery.data?.available),
    refetchInterval: 30_000,
    staleTime: 20_000,
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

  // Mutasi Atur & Reset Harga Modal Stok (HPP)
  const setStockCostMutation = useMutation({
    mutationFn: (costIdr: number) =>
      setCustomCostFn({
        data: {
          sessionToken: sessionToken ?? undefined,
          costIdr,
        },
      }),
    onSuccess: (res) => {
      pnlQuery.refetch();
      setIsEditingStockCost(false);
      if (res.ok) {
        if (res.costIdr > 0) {
          toast.success(`Harga modal stok berhasil diatur ke ${fmtRp2(res.costIdr)}/USDT.`);
        } else {
          toast.success("Harga modal stok berhasil di-reset ke kalkulasi otomatis (AVCO).");
        }
      } else {
        toast.error("Gagal menyimpan harga modal stok.");
      }
    },
    onError: handleAuthError,
  });

  const resetStockCostMutation = useMutation({
    mutationFn: () =>
      resetCustomCostFn({
        data: {
          sessionToken: sessionToken ?? undefined,
        },
      }),
    onSuccess: (res) => {
      pnlQuery.refetch();
      setIsEditingStockCost(false);
      if (res.ok) {
        toast.success("Harga modal stok berhasil di-reset ke kalkulasi otomatis (AVCO riil).");
      } else {
        toast.error("Gagal me-reset harga modal stok.");
      }
    },
    onError: handleAuthError,
  });

  const handleStartEditStockCost = () => {
    const current = pnl?.open_position_avg_cost_idr ?? 0;
    setStockCostInputStr(current > 0 ? String(Math.round(current)) : "");
    setIsEditingStockCost(true);
  };

  const handleSaveStockCost = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFlexibleNumber(stockCostInputStr);
    if (val <= 0) {
      resetStockCostMutation.mutate();
    } else {
      setStockCostMutation.mutate(val);
    }
  };

  const handleResetToAutoCost = () => {
    resetStockCostMutation.mutate();
  };

  const handleSetToFairPriceCost = () => {
    const fair = snapshotQuery.data?.fair_price;
    if (fair && fair > 0) {
      setStockCostMutation.mutate(Math.round(fair));
    } else {
      toast.error("Nilai wajar pasar belum tersedia.");
    }
  };

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

  // Mutasi Update Modal Awal
  const setCapitalMutation = useMutation({
    mutationFn: (cap: number) =>
      setCapitalFn({ data: { initialCapitalIdr: cap, sessionToken: sessionToken ?? undefined } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Modal awal Rp ${Math.round(res.initial_capital_idr).toLocaleString("id-ID")} berhasil disimpan.`);
        setIsEditingCapital(false);
        pnlQuery.refetch();
      } else {
        toast.error("Gagal menyimpan modal awal.");
      }
    },
    onError: handleAuthError,
  });

  const handleStartEditCapital = () => {
    const current = pnl?.initial_capital_idr ?? 0;
    setCapitalInputStr(current > 0 ? String(current) : "");
    setIsEditingCapital(true);
  };

  const handleSaveCapital = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFlexibleNumber(capitalInputStr);
    if (!Number.isFinite(val) || val < 0) {
      toast.error("Masukkan angka modal awal yang valid (≥ 0).");
      return;
    }
    setCapitalMutation.mutate(val);
  };

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
    const rawP = parseFlexibleNumber(tradePrice);
    const a = parseFlexibleNumber(tradeAmount);
    const p = normalizeTradePrice(rawP);
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

  const chartData = useMemo(() => {
    if (!Array.isArray(history)) return [];
    return history
      .filter((pt) => pt && typeof pt === "object" && typeof pt.ts === "string")
      .map((pt) => ({
        time: pt.ts.length >= 16 ? pt.ts.slice(11, 16) : String(pt.ts),
        fair: Number(pt.fair_price) || 0,
      }));
  }, [history]);


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
        {s ? (() => {
          const buyAd = s.my_buy_price || 16200;
          const buyFee = buyAd * 0.0008;
          const buyHpp = buyAd * 1.0008;

          const sellAd = s.my_sell_price || 16250;
          const sellFee = sellAd * 0.0008;
          const sellNet = sellAd * 0.9992;

          const netSpreadAbs = sellNet - buyHpp;
          const netSpreadPct = buyHpp > 0 ? (netSpreadAbs / buyHpp) * 100 : 0;
          const totalFeePerUsdt = buyFee + sellFee;

          return (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-12">
                {/* Rekomendasi BELI */}
                <div className="panel p-4.5 md:col-span-6 border-bid/30 bg-gradient-to-br from-surface to-bid/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-bid animate-pulse" />
                      <span className="text-xs font-bold text-bid uppercase tracking-wider">
                        Rekomendasi Pasang Beli
                      </span>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyPrice(buyAd, "buy")}
                      className="h-6.5 gap-1 border-bid/30 bg-bid/10 text-bid hover:bg-bid/20 text-xs font-semibold px-2"
                    >
                      {copiedPrice === "buy" ? (
                        <>
                          <Check className="size-3" /> Disalin
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" /> Salin Harga
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <div>
                      <div className="text-[0.68rem] font-medium text-muted-foreground uppercase tracking-wider">
                        Harga Iklan (Sebelum Fee)
                      </div>
                      <div className="num text-2xl sm:text-3xl font-bold text-foreground">
                        {fmtRp2(buyAd)}
                      </div>
                    </div>
                    <div className="num text-xs font-medium text-bid text-right">
                      {s.my_buy_price && s.fair_price ? fmtRp(s.my_buy_price - s.fair_price) : "—"} vs Fair
                    </div>
                  </div>

                  {/* Rincian Fee Beli & HPP Riil */}
                  <div className="mt-3 rounded-md border border-bid/20 bg-surface-2/70 p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Fee Maker Beli (0.08%):</span>
                      <span className="num font-semibold text-foreground/85">+{fmtRp2(buyFee)}/USDT</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/50 pt-1.5 font-bold">
                      <span className="text-foreground">HPP Modal Riil (Sesudah Fee):</span>
                      <span className="num text-bid text-sm">{fmtRp2(buyHpp)}/USDT</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
                    <span>Kedalaman: <strong>{s.buy_depth?.ads_used ?? 0} iklan</strong> ({fmtRp(s.buy_depth?.depth_reached_idr ?? 0)})</span>
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
                <div className="panel p-4.5 md:col-span-6 border-ask/30 bg-gradient-to-br from-surface to-ask/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-ask animate-pulse" />
                      <span className="text-xs font-bold text-ask uppercase tracking-wider">
                        Rekomendasi Pasang Jual
                      </span>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyPrice(sellAd, "sell")}
                      className="h-6.5 gap-1 border-ask/30 bg-ask/10 text-ask hover:bg-ask/20 text-xs font-semibold px-2"
                    >
                      {copiedPrice === "sell" ? (
                        <>
                          <Check className="size-3" /> Disalin
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" /> Salin Harga
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <div>
                      <div className="text-[0.68rem] font-medium text-muted-foreground uppercase tracking-wider">
                        Harga Iklan (Sebelum Fee)
                      </div>
                      <div className="num text-2xl sm:text-3xl font-bold text-foreground">
                        {fmtRp2(sellAd)}
                      </div>
                    </div>
                    <div className="num text-xs font-medium text-ask text-right">
                      +{s.my_sell_price && s.fair_price ? fmtRp(s.my_sell_price - s.fair_price) : "—"} vs Fair
                    </div>
                  </div>

                  {/* Rincian Fee Jual & Net Bersih */}
                  <div className="mt-3 rounded-md border border-ask/20 bg-surface-2/70 p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Fee Maker Jual (0.08%):</span>
                      <span className="num font-semibold text-foreground/85">-{fmtRp2(sellFee)}/USDT</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/50 pt-1.5 font-bold">
                      <span className="text-foreground">Net Diterima (Sesudah Fee):</span>
                      <span className="num text-ask text-sm">{fmtRp2(sellNet)}/USDT</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
                    <span>Kedalaman: <strong>{s.sell_depth?.ads_used ?? 0} iklan</strong> ({fmtRp(s.sell_depth?.depth_reached_idr ?? 0)})</span>
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

              {/* Baris Ringkasan Margin 1 Putaran Beli-Jual */}
              <div className="panel px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 border-primary/20 bg-surface-2/40 text-xs">
                <div className="flex items-center gap-2">
                  <Coins className="size-4 text-primary" />
                  <span className="text-muted-foreground">Simulasi 1 Putaran:</span>
                  <span className="font-semibold text-foreground">
                    Spread Iklan: +{fmtRp(sellAd - buyAd)} ({fmtPct(s.spread_pct)})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-muted-foreground">
                    Total Fee (0.16%): <strong className="text-foreground">{fmtRp2(totalFeePerUsdt)}/USDT</strong>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-bid/15 px-2 py-0.5 font-bold text-bid">
                    <TrendingUp className="size-3" />
                    Margin Bersih Riil: +{fmtRp2(netSpreadAbs)}/USDT ({fmtPct(netSpreadPct)})
                  </span>
                </div>
              </div>

              {/* ── Sinkronisasi Benchmark Multi-Platform & Panduan Ambil Stok ── */}
              <div className="panel p-3.5 border-border/70 bg-surface-2/40 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                  <div className="flex items-center gap-2">
                    <Globe className="size-3.5 text-primary" />
                    <span className="font-bold text-foreground">Sinkronisasi Pasar Multi-Platform:</span>
                  </div>
                  <span className="text-[0.68rem] text-muted-foreground">
                    Acuan Nilai Wajar: <strong className="text-foreground">{fmtRp2(s.fair_price)}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 text-center">
                  {/* Indodax Spot */}
                  <div className="rounded border border-border/60 bg-surface/80 p-2">
                    <div className="text-[0.65rem] text-muted-foreground font-medium uppercase tracking-wider">
                      🇮🇩 Indodax Orderbook
                    </div>
                    <div className="num font-bold text-foreground mt-0.5">
                      {s.cross_platform?.indodax_ask ? fmtRp(s.cross_platform.indodax_ask) : s.cross_platform?.indodax_usdt_idr_spot ? fmtRp(s.cross_platform.indodax_usdt_idr_spot) : "—"}
                    </div>
                    <div className="text-[0.62rem] text-muted-foreground flex items-center justify-center gap-1.5 mt-0.5">
                      <span className="text-bid font-semibold">Ask: {s.cross_platform?.indodax_ask ? fmtRp(s.cross_platform.indodax_ask) : "—"}</span>
                      <span>|</span>
                      <span className="text-ask font-semibold">Bid: {s.cross_platform?.indodax_bid ? fmtRp(s.cross_platform.indodax_bid) : "—"}</span>
                    </div>
                  </div>

                  {/* Bybit Benchmark */}
                  <div className="rounded border border-border/60 bg-surface/80 p-2">
                    <div className="text-[0.65rem] text-muted-foreground font-medium uppercase tracking-wider">
                      🌐 Bybit
                    </div>
                    <div className="num font-bold text-foreground mt-0.5">
                      {s.cross_platform?.bybit_usdt_idr ? fmtRp(s.cross_platform.bybit_usdt_idr) : "—"}
                    </div>
                    <div className="text-[0.62rem] text-muted-foreground">USDT/IDR Est</div>
                  </div>

                  {/* OKX Benchmark */}
                  <div className="rounded border border-border/60 bg-surface/80 p-2">
                    <div className="text-[0.65rem] text-muted-foreground font-medium uppercase tracking-wider">
                      🌐 OKX
                    </div>
                    <div className="num font-bold text-foreground mt-0.5">
                      {s.cross_platform?.okx_usdt_idr ? fmtRp(s.cross_platform.okx_usdt_idr) : "—"}
                    </div>
                    <div className="text-[0.62rem] text-muted-foreground">USDT/IDR Est</div>
                  </div>

                  {/* CoinGecko */}
                  <div className="rounded border border-border/60 bg-surface/80 p-2">
                    <div className="text-[0.65rem] text-muted-foreground font-medium uppercase tracking-wider">
                      🪙 CoinGecko
                    </div>
                    <div className="num font-bold text-foreground mt-0.5">
                      {s.cross_platform?.coingecko_usdt_idr ? fmtRp(s.cross_platform.coingecko_usdt_idr) : "—"}
                    </div>
                    <div className="text-[0.62rem] text-muted-foreground">Tether Global IDR</div>
                  </div>

                  {/* Forex Kurs USD/IDR */}
                  <div className="rounded border border-border/60 bg-surface/80 p-2 col-span-2 sm:col-span-1">
                    <div className="text-[0.65rem] text-muted-foreground font-medium uppercase tracking-wider">
                      🏦 Kurs USD/IDR
                    </div>
                    <div className="num font-bold text-foreground mt-0.5">
                      {s.cross_platform?.forex_usd_idr ? fmtRp(s.cross_platform.forex_usd_idr) : "—"}
                    </div>
                    <div className="text-[0.62rem] text-muted-foreground">Pasar Uang Antar Bank</div>
                  </div>
                </div>

                {/* Advice Ambil Stok */}
                <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5 flex items-start gap-2 text-xs">
                  <div className="mt-0.5 rounded bg-primary/20 p-1 text-primary">
                    <Zap className="size-3.5" />
                  </div>
                  <div>
                    <strong className="text-foreground">Strategi Optimal Ambil Stok USDT:</strong>{" "}
                    <span className="text-muted-foreground">
                      Pasang Iklan Beli di harga{" "}
                      <strong className="text-bid font-bold">{fmtRp2(buyAd)}</strong> (+1 Rupiah di atas kompetitor teratas)
                      untuk menempati antrian pertama (Rank #1) tanpa overpay. HPP modal efektif setelah fee:{" "}
                      <strong className="text-foreground">{fmtRp2(buyHpp)}/USDT</strong>.
                      {(s.cross_platform?.indodax_ask || s.cross_platform?.indodax_usdt_idr_spot) ? (
                        (() => {
                          const indodaxBuyPrice = s.cross_platform?.indodax_ask || s.cross_platform?.indodax_usdt_idr_spot || 0;
                          return buyAd < indodaxBuyPrice ? (
                            <> Ambil via P2P lebih hemat <strong className="text-bid">{fmtRp(indodaxBuyPrice - buyAd)}/USDT</strong> dibanding beli instan di Indodax (Ask: {fmtRp(indodaxBuyPrice)}).</>
                          ) : (
                            <> Harga beli instan Indodax sedang bersaing (Ask: {fmtRp(indodaxBuyPrice)}).</>
                          );
                        })()
                      ) : null}
                    </span>
                  </div>
                </div>

              </div>
            </div>
          );
        })() : null}




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

              <button
                type="button"
                onClick={() => setActiveTab("arbitrage")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === "arbitrage"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="size-3.5" />
                Radar Arbitrase
              </button>

              {((s?.analyzed_news && s.analyzed_news.length > 0) || (s?.news_items && s.news_items.length > 0)) ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("news")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeTab === "news"
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-2 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Globe className="size-3.5" />
                  Berita & Dampak Pasar ({s?.analyzed_news?.length || s?.news_items?.length || 0})
                </button>
              ) : null}

            </div>
          </div>

          {/* ── TAB 1: LAPORAN & TRANSAKSI ──────────────────────────────────── */}
          {activeTab === "pnl" && (
            <div className="space-y-5">
              {/* ── Panel Manajemen Modal Awal & Posisi Ekuitas ─────────────── */}
              {(() => {
                const initialCapital = pnl?.initial_capital_idr ?? 0;
                const fb = fundingBalanceQuery.data;
                const useFunding = fb && fb.usdt !== null && !fb.error && !fb.not_configured;
                const stockUsdt = useFunding ? fb!.usdt! : (pnl?.open_position_usdt ?? 0);
                const avgCost = pnl && pnl.open_position_avg_cost_idr > 0 ? pnl.open_position_avg_cost_idr : 0;

                // Modal terikat di stok = stok USDT * HPP modal rata-rata
                const stockCapitalIdr = stockUsdt > 0 && avgCost > 0 ? stockUsdt * avgCost : (pnl?.open_position_total_cost_idr ?? 0);
                const allTimeProfit = pnl?.all_time_profit_idr ?? 0;

                // Sisa Kas Bebas = Modal Awal - Modal di Stok + Keuntungan Realisasi
                const freeCashIdr = initialCapital > 0
                  ? Math.max(0, initialCapital - stockCapitalIdr + allTimeProfit)
                  : 0;

                // Total Ekuitas = Modal Awal + Total Profit
                const totalEquityIdr = initialCapital > 0
                  ? initialCapital + allTimeProfit
                  : (stockCapitalIdr + allTimeProfit);

                const roiPct = initialCapital > 0 ? (allTimeProfit / initialCapital) * 100 : 0;
                const utilPct = initialCapital > 0 ? Math.min(100, Math.max(0, (stockCapitalIdr / initialCapital) * 100)) : 0;
                const cashPct = Math.max(0, 100 - utilPct);

                return (
                  <div className="panel p-4.5 border-primary/25 bg-gradient-to-br from-surface to-primary/5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="rounded-lg bg-primary/15 p-2 text-primary border border-primary/30">
                          <Landmark className="size-5" />
                        </div>
                        <div>
                          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                            Manajemen Modal Awal & Posisi Ekuitas
                            {initialCapital > 0 && (
                              <span className="rounded bg-primary/20 text-primary px-1.5 py-0.5 text-[0.65rem] font-semibold">
                                Aktif
                              </span>
                            )}
                          </h2>
                          <p className="text-xs text-muted-foreground">
                            Modal awal otomatis berkurang saat beli stok USDT, kas bertambah saat jual, dan profit otomatis diakumulasikan.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isEditingCapital ? (
                          <form onSubmit={handleSaveCapital} className="flex items-center gap-2">
                            <Input
                              type="text"
                              placeholder="contoh: 180000000 atau 180.000.000"
                              value={capitalInputStr}
                              onChange={(e) => setCapitalInputStr(e.target.value)}
                              className="h-8 w-48 sm:w-60 bg-surface-2 text-xs"
                              autoFocus
                            />
                            <Button
                              type="submit"
                              size="sm"
                              disabled={setCapitalMutation.isPending}
                              className="h-8 text-xs font-semibold px-3"
                            >
                              {setCapitalMutation.isPending ? "Menyimpan…" : "Simpan"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setIsEditingCapital(false)}
                              className="h-8 text-xs text-muted-foreground"
                            >
                              Batal
                            </Button>
                          </form>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleStartEditCapital}
                            className="h-8 gap-1.5 text-xs font-semibold bg-surface-2 hover:bg-surface-3 border-primary/30 text-primary"
                          >
                            <Edit3 className="size-3.5" />
                            {initialCapital > 0 ? "Ubah Modal Awal" : "Input Modal Awal"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* 4 Kartu Metrik Modal Utama */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {/* Kartu 1: Modal Awal */}
                      <div className="rounded-lg border border-border/70 bg-surface-2/60 p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-muted-foreground text-xs">
                          <span>Modal Awal (Bankroll)</span>
                          <PiggyBank className="size-3.5 text-primary" />
                        </div>
                        <div className="num text-xl sm:text-2xl font-bold text-foreground">
                          {initialCapital > 0 ? fmtRp(initialCapital) : "Belum diinput"}
                        </div>
                        <div className="text-[0.68rem] text-muted-foreground">
                          {initialCapital > 0 ? "Modal dasar yang diinvestasikan" : "Klik tombol 'Input Modal Awal'"}
                        </div>
                      </div>

                      {/* Kartu 2: Sisa Kas Bebas (IDR) */}
                      <div className="rounded-lg border border-border/70 bg-surface-2/60 p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-muted-foreground text-xs">
                          <span>Sisa Kas Bebas (IDR)</span>
                          <Coins className="size-3.5 text-sky-400" />
                        </div>
                        <div className="num text-xl sm:text-2xl font-bold text-sky-400">
                          {initialCapital > 0 ? fmtRp(freeCashIdr) : "—"}
                        </div>
                        <div className="text-[0.68rem] text-muted-foreground">
                          {initialCapital > 0 ? `Siap diputar (${cashPct.toFixed(1)}% dari modal)` : "Perlu input modal awal"}
                        </div>
                      </div>

                      {/* Kartu 3: Modal di Stok USDT */}
                      <div className="rounded-lg border border-border/70 bg-surface-2/60 p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-muted-foreground text-xs">
                          <span>Modal di Stok USDT</span>
                          <Wallet className="size-3.5 text-amber-400" />
                        </div>
                        <div className="num text-xl sm:text-2xl font-bold text-amber-400">
                          {fmtRp(stockCapitalIdr)}
                        </div>
                        <div className="text-[0.68rem] text-muted-foreground">
                          {stockUsdt > 0 ? `${stockUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT @ ${fmtRp2(avgCost)}` : "Stok kosong"}
                        </div>
                      </div>

                      {/* Kartu 4: Total Ekuitas & ROI */}
                      <div className="rounded-lg border border-bid/30 bg-bid/5 p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-bid text-xs font-semibold">
                          <span>Total Ekuitas Portofolio</span>
                          <TrendingUp className="size-3.5 text-bid" />
                        </div>
                        <div className="num text-xl sm:text-2xl font-bold text-bid">
                          {fmtRp(totalEquityIdr)}
                        </div>
                        <div className="text-[0.68rem] text-bid/90 font-medium">
                          {initialCapital > 0
                            ? `+${fmtRp(allTimeProfit)} akumulasi laba (${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(2)}% ROI)`
                            : `+${fmtRp(allTimeProfit)} akumulasi laba`}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar Utilitas Modal */}
                    {initialCapital > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Alokasi Modal: <strong>Kas Bebas ({cashPct.toFixed(1)}%)</strong> vs <strong>Stok USDT ({utilPct.toFixed(1)}%)</strong></span>
                          <span>Total: <strong>{fmtRp(totalEquityIdr)}</strong></span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3 flex">
                          <div
                            style={{ width: `${cashPct}%` }}
                            className="h-full bg-sky-500/80 transition-all"
                            title={`Kas Bebas: ${fmtRp(freeCashIdr)} (${cashPct.toFixed(1)}%)`}
                          />
                          <div
                            style={{ width: `${utilPct}%` }}
                            className="h-full bg-amber-500/80 transition-all"
                            title={`Stok USDT: ${fmtRp(stockCapitalIdr)} (${utilPct.toFixed(1)}%)`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

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

                {/* ── Sisa Stok & Modal: sinkron dengan Funding Wallet jika API aktif, AVCO sebagai fallback ── */}
                {(() => {
                  const fb = fundingBalanceQuery.data;
                  const useFunding = fb && fb.usdt !== null && !fb.error && !fb.not_configured;
                  const stockUsdt = useFunding ? fb!.usdt! : (pnl?.open_position_usdt ?? null);
                  const stockLabel = useFunding ? "Saldo Funding (Stok)" : "Sisa Stok (estimasi)";
                  const stockValue =
                    stockUsdt !== null
                      ? `${stockUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT`
                      : "—";

                  const avgCost = pnl && pnl.open_position_avg_cost_idr > 0 ? pnl.open_position_avg_cost_idr : 0;
                  const totalCostIdr = stockUsdt !== null && avgCost > 0
                    ? stockUsdt * avgCost
                    : (pnl?.open_position_total_cost_idr ?? 0);

                  // Subvalue: rincian modal & status inventaris
                  let stockSubvalue: string;
                  if (useFunding) {
                    const parts: string[] = [];
                    if ((fb!.free ?? 0) > 0) parts.push(`Bebas: ${fb!.free!.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`);
                    if ((fb!.locked ?? 0) > 0) parts.push(`Escrow: ${fb!.locked!.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`);
                    if (avgCost > 0) {
                      parts.push(`Modal: ${fmtRp2(avgCost)}/USDT${pnl?.is_custom_stock_cost ? " (Manual)" : ""}`);
                      if (totalCostIdr > 0) parts.push(`(${fmtRp(totalCostIdr)})`);
                    }
                    stockSubvalue = parts.length > 0 ? parts.join(" · ") : (stockUsdt === 0 ? "Stok kosong" : "Semua bebas");
                  } else if (pnl && (pnl.open_position_usdt ?? 0) > 0.001 && avgCost > 0) {
                    stockSubvalue = `Modal: ${fmtRp2(avgCost)}/USDT${pnl?.is_custom_stock_cost ? " (Manual)" : ""} · ${fmtRp(totalCostIdr)} total`;
                  } else if (avgCost > 0) {
                    stockSubvalue = `Modal ~${fmtRp2(avgCost)}/USDT${pnl?.is_custom_stock_cost ? " (Manual)" : ""} · Stok seimbang`;
                  } else {
                    stockSubvalue = "Stok seimbang";
                  }

                  // Hint: info fee & margin
                  const hintFee = `Fee beli 0.08% + jual 0.08% = 0.16% / putaran`;
                  const hintProfit = pnl && pnl.avg_profit_per_usdt_idr !== 0
                    ? `Margin avg: +${fmtRp(pnl.avg_profit_per_usdt_idr)}/USDT`
                    : "";
                  const hint = hintProfit ? `${hintFee} · ${hintProfit}` : hintFee;

                  return (
                    <StatCard
                      label={stockLabel}
                      value={stockValue}
                      subvalue={stockSubvalue}
                      tone="neutral"
                      hint={hint}
                      badge={
                        pnl?.is_custom_stock_cost
                          ? { text: "Modal Manual", variant: "primary" }
                          : useFunding
                            ? { text: "Live", variant: "bid" }
                            : fb?.error
                              ? { text: "API Error", variant: "ask" }
                              : undefined
                      }
                      action={
                        <div className="flex items-center gap-1">
                          {pnl?.is_custom_stock_cost && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResetToAutoCost();
                              }}
                              disabled={resetStockCostMutation.isPending}
                              className="h-6 px-1.5 text-[0.65rem] text-muted-foreground hover:text-foreground gap-1"
                              title="Reset ke kalkulasi otomatis (AVCO)"
                            >
                              <RotateCcw className="size-2.5" />
                              Reset
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={isEditingStockCost ? "default" : "outline"}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isEditingStockCost) {
                                setIsEditingStockCost(false);
                              } else {
                                handleStartEditStockCost();
                              }
                            }}
                            className="h-6 px-2 text-[0.65rem] font-semibold bg-surface-2 hover:bg-surface-3 border-border/80 text-foreground gap-1"
                          >
                            <Sliders className="size-2.5" />
                            {isEditingStockCost ? "Tutup" : (pnl?.is_custom_stock_cost ? "Atur Modal" : "Atur / Reset")}
                          </Button>
                        </div>
                      }
                    />
                  );
                })()}
              </div>

              {/* ── Panel Pengaturan & Reset Harga Modal Stok (HPP) ─────────── */}
              {isEditingStockCost && (() => {
                const fb = fundingBalanceQuery.data;
                const useFunding = fb && fb.usdt !== null && !fb.error && !fb.not_configured;
                const stockUsdt = useFunding ? fb!.usdt! : (pnl?.open_position_usdt ?? 0);
                const avgCost = pnl && pnl.open_position_avg_cost_idr > 0 ? pnl.open_position_avg_cost_idr : 0;
                const totalCostIdr = stockUsdt > 0 && avgCost > 0 ? stockUsdt * avgCost : (pnl?.open_position_total_cost_idr ?? 0);

                return (
                  <div className="panel p-4.5 border-primary/30 bg-surface-2/60 space-y-4 animate-in fade-in-50">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="rounded-md bg-primary/15 p-1.5 text-primary border border-primary/30">
                          <Sliders className="size-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                            Pengaturan & Reset Harga Modal Stok (HPP)
                            {pnl?.is_custom_stock_cost ? (
                              <span className="rounded bg-primary/20 text-primary px-1.5 py-0.5 text-[0.6rem] font-semibold">
                                Mode Manual Aktif
                              </span>
                            ) : (
                              <span className="rounded bg-surface-3 text-muted-foreground px-1.5 py-0.5 text-[0.6rem] font-semibold">
                                Mode Otomatis (AVCO)
                              </span>
                            )}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            Tentukan harga modal per USDT secara manual atau reset kembali ke kalkulasi otomatis transaksi riil.
                          </p>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsEditingStockCost(false)}
                        className="h-7 text-xs text-muted-foreground"
                      >
                        Tutup
                      </Button>
                    </div>

                    {/* 3 Info Metrik Stok & Modal */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                      <div className="rounded-lg border border-border/70 bg-surface p-3 space-y-1">
                        <span className="text-[0.65rem] text-muted-foreground uppercase font-semibold">Saldo Stok Aktif</span>
                        <div className="num font-bold text-foreground text-sm">
                          {stockUsdt > 0 ? `${stockUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT` : "0 USDT"}
                        </div>
                        <span className="text-[0.65rem] text-muted-foreground">
                          {useFunding ? "Sinkron Live Binance Funding Wallet" : "Estimasi Akumulasi Transaksi"}
                        </span>
                      </div>

                      <div className="rounded-lg border border-border/70 bg-surface p-3 space-y-1">
                        <span className="text-[0.65rem] text-muted-foreground uppercase font-semibold">Harga Modal Aktif Saat Ini</span>
                        <div className="num font-bold text-bid text-sm">
                          {avgCost > 0 ? fmtRp2(avgCost) : "—"} / USDT
                        </div>
                        <span className="text-[0.65rem] text-muted-foreground">
                          {pnl?.is_custom_stock_cost ? "Nilai manual yang Anda tentukan" : "Rata-rata tertimbang (AVCO riil)"}
                        </span>
                      </div>

                      <div className="rounded-lg border border-border/70 bg-surface p-3 space-y-1">
                        <span className="text-[0.65rem] text-muted-foreground uppercase font-semibold">Total Modal Terikat di Stok</span>
                        <div className="num font-bold text-foreground text-sm">
                          {fmtRp(totalCostIdr)}
                        </div>
                        <span className="text-[0.65rem] text-muted-foreground">
                          Stok USDT × Harga Modal Aktif
                        </span>
                      </div>
                    </div>

                    {/* Form & Tombol Aksi Cepat */}
                    <div className="space-y-3 pt-1">
                      <form onSubmit={handleSaveStockCost} className="flex flex-wrap items-center gap-2.5">
                        <div className="space-y-1 flex-1 min-w-[240px]">
                          <Label className="text-xs text-muted-foreground">Input Harga Modal Baru (Rp / USDT):</Label>
                          <Input
                            type="text"
                            placeholder="contoh: 16250 atau 17.650"
                            value={stockCostInputStr}
                            onChange={(e) => setStockCostInputStr(e.target.value)}
                            className="h-8.5 bg-surface text-xs font-bold num"
                            autoFocus
                          />
                        </div>

                        <div className="flex items-end gap-2 pt-5">
                          <Button
                            type="submit"
                            size="sm"
                            disabled={setStockCostMutation.isPending}
                            className="h-8.5 text-xs font-semibold px-4"
                          >
                            {setStockCostMutation.isPending ? "Menyimpan…" : "Simpan Harga Modal"}
                          </Button>
                        </div>
                      </form>

                      {/* Quick Actions Bar */}
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
                        <span className="text-xs text-muted-foreground font-medium">Aksi Cepat:</span>

                        {/* Tombol Reset ke Otomatis AVCO */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleResetToAutoCost}
                          disabled={resetStockCostMutation.isPending || !pnl?.is_custom_stock_cost}
                          className="h-7.5 text-xs gap-1.5 bg-surface hover:bg-surface-3 border-border"
                        >
                          <RotateCcw className="size-3 text-primary" />
                          Reset ke Otomatis AVCO ({pnl?.auto_stock_avg_cost_idr ? fmtRp2(pnl.auto_stock_avg_cost_idr) : "Rp 0"})
                        </Button>

                        {/* Tombol Set ke Nilai Wajar Pasar */}
                        {snapshotQuery.data?.fair_price && snapshotQuery.data.fair_price > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleSetToFairPriceCost}
                            disabled={setStockCostMutation.isPending}
                            className="h-7.5 text-xs gap-1.5 bg-surface hover:bg-surface-3 border-border"
                          >
                            <Zap className="size-3 text-amber-400" />
                            Set ke Nilai Wajar Pasar ({fmtRp2(snapshotQuery.data.fair_price)})
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

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
                        type="text"
                        placeholder="contoh: 16250 atau 16.250"
                        value={tradePrice}
                        onChange={(e) => setTradePrice(e.target.value)}
                        className="mt-1 bg-surface-2 text-xs h-8"
                      />
                    </div>

                    <div>
                      <Label className="text-[0.7rem] text-muted-foreground">Jumlah (USDT)</Label>
                      <Input
                        type="text"
                        placeholder="contoh: 1000 atau 500.5"
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

          {/* ── TAB 4: RADAR ARBITRASE LINTAS BURSA ─────────────────────────── */}
          {activeTab === "arbitrage" && (
            <ArbitrageScanner
              myBuyPrice={s?.my_buy_price || 17650}
              mySellPrice={s?.my_sell_price || 17700}
              indodaxAsk={s?.cross_platform?.indodax_ask || 0}
              indodaxBid={s?.cross_platform?.indodax_bid || 0}
              indodaxLast={s?.cross_platform?.indodax_usdt_idr_spot || 0}
              indodaxSpotPrice={s?.cross_platform?.indodax_usdt_idr_spot || 0}
              coingeckoPrice={s?.cross_platform?.coingecko_usdt_idr || 0}
              forexRate={s?.cross_platform?.forex_usd_idr || 17860}
              bybitPrice={s?.cross_platform?.bybit_usdt_idr || 0}
              okxPrice={s?.cross_platform?.okx_usdt_idr || 0}
              onRefresh={() => snapshotQuery.refetch()}
              isRefreshing={snapshotQuery.isFetching}
            />
          )}


          {/* ── TAB 5: BERITA & ANALISIS DAMPAK PASAR ───────────────────────── */}
          {activeTab === "news" && (

            <div className="space-y-4">
              {/* Barometer Sentimen Makro */}
              {s?.macro_sentiment && (
                <div className="panel p-4.5 space-y-3.5 border-primary/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
                    <div className="flex items-center gap-2">
                      <Globe className="size-4 text-primary" />
                      <div>
                        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                          Barometer Sentimen Makro USDT/IDR
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Kompilasi sentimen berita kurs Rupiah, Dolar AS, kebijakan moneter, dan pasar kripto.
                        </p>
                      </div>
                    </div>

                    <ImpactBadge impact={
                      s.macro_sentiment.overall_sentiment === "bullish"
                        ? "bullish_usdt"
                        : s.macro_sentiment.overall_sentiment === "bearish"
                          ? "bearish_usdt"
                          : s.macro_sentiment.overall_sentiment === "volatile"
                            ? "volatility"
                            : "neutral"
                    } />
                  </div>

                  {/* Summary Metric Grid */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded border border-emerald-500/25 bg-emerald-500/10 p-3">
                      <div className="text-[0.7rem] font-medium text-emerald-400">Sinyal Bullish USDT</div>
                      <div className="mt-1 text-xl font-bold text-foreground">{s.macro_sentiment.bullish_count} Berita</div>
                      <p className="mt-1 text-[0.65rem] text-muted-foreground">Pelemahan Rupiah / Permintaan Kripto Naik</p>
                    </div>

                    <div className="rounded border border-rose-500/25 bg-rose-500/10 p-3">
                      <div className="text-[0.7rem] font-medium text-rose-400">Sinyal Bearish USDT</div>
                      <div className="mt-1 text-xl font-bold text-foreground">{s.macro_sentiment.bearish_count} Berita</div>
                      <p className="mt-1 text-[0.65rem] text-muted-foreground">Penguatan Rupiah / Koreksi Dolar AS</p>
                    </div>

                    <div className="rounded border border-amber-500/25 bg-amber-500/10 p-3">
                      <div className="text-[0.7rem] font-medium text-amber-400">Volatilitas / Regulasi</div>
                      <div className="mt-1 text-xl font-bold text-foreground">{s.macro_sentiment.volatility_count} Berita</div>
                      <p className="mt-1 text-[0.65rem] text-muted-foreground">Kebijakan Moneter / OJK / Perpajakan</p>
                    </div>
                  </div>

                  {/* Merchant Action Directive */}
                  <div className="rounded border border-border bg-surface-2 p-3 text-xs flex items-start gap-2.5">
                    <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-foreground">Panduan Aksi Merchant: </span>
                      <span className="text-muted-foreground">{s.macro_sentiment.action_summary}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Feed Berita Teranalisis */}
              <div className="panel p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border pb-2.5">
                  <div>
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Analisis Dampak Berita Finansial
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Setiap berita dianalisis dampaknya secara langsung terhadap kurs & spread P2P.
                    </p>
                  </div>

                  {/* Kategori Filter */}
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { id: "all", label: "Semua" },
                        { id: "kurs_rupiah", label: "Kurs & Valas" },
                        { id: "kebijakan_fed_bi", label: "BI & The Fed" },
                        { id: "pasar_kripto", label: "Pasar Kripto" },
                      ] as const
                    ).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setNewsCategoryFilter(c.id)}
                        className={`rounded px-2.5 py-1 text-[0.7rem] font-medium transition-colors ${
                          newsCategoryFilter === c.id
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "bg-surface-2 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* News Items List */}
                <div className="space-y-3 pt-1">
                  {(s?.analyzed_news && s.analyzed_news.length > 0
                    ? s.analyzed_news
                    : (s?.news_items || []).map((n) => ({
                        title: n.title,
                        link: n.link,
                        source: "Berita Finansial",
                        published_time: "Baru saja",
                        impact: "neutral" as const,
                        impact_label: "Netral",
                        impact_level: "low" as const,
                        impact_summary: "Pergerakan kurs relatif stabil mengikuti penawaran normal pasar.",
                        merchant_advice: "Pasang iklan dengan spread standar untuk menjaga konsistensi perputaran.",
                        category: "umum" as const,
                      }))
                  )
                    .filter((n) => (newsCategoryFilter === "all" ? true : n.category === newsCategoryFilter))
                    .map((n, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-border bg-surface-2/60 p-3.5 space-y-2.5 transition-colors hover:border-border/90"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <ImpactBadge impact={n.impact} />
                            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground font-medium">
                              {n.impact_level === "high" ? "Dampak Tinggi" : n.impact_level === "medium" ? "Dampak Sedang" : "Dampak Rendah"}
                            </span>
                          </div>

                          <span className="text-[0.65rem] text-muted-foreground">
                            {n.source} • {n.published_time}
                          </span>
                        </div>

                        {/* Title */}
                        <div className="flex items-start justify-between gap-3">
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs font-semibold text-foreground hover:text-primary transition-colors flex-1"
                          >
                            {n.title}
                          </a>
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-[0.7rem] text-primary hover:underline shrink-0 font-medium"
                          >
                            Buka Sumber <ExternalLink className="size-3" />
                          </a>
                        </div>

                        {/* Analysis Box */}
                        <div className="grid grid-cols-1 gap-2 rounded bg-surface-3/50 p-2.5 sm:grid-cols-2 text-xs">
                          <div>
                            <span className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider block">
                              Dampak ke Harga USDT/IDR:
                            </span>
                            <p className="text-xs text-foreground mt-0.5 leading-relaxed">{n.impact_summary}</p>
                          </div>

                          <div>
                            <span className="text-[0.65rem] font-semibold text-primary uppercase tracking-wider block">
                              Panduan Tindakan Merchant:
                            </span>
                            <p className="text-xs text-foreground mt-0.5 leading-relaxed">{n.merchant_advice}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
