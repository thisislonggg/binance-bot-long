import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Info,
  Layers,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  Settings2,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  UserCheck,
  UserX,
  Users,
  Wand2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  computeCompetitorPricing,
  DEFAULT_BOT_CONFIG,
  loadBotConfig,
  saveBotConfig,
  STRATEGY_PRESETS,
  type CompetitorFilterConfig,
  type DisqualificationReason,
  type EvaluatedAd,
  type StrategyPreset,
} from "@/lib/competitor-bot";
import { fmtPct, fmtRate, fmtRp, fmtRp2, type Ad } from "@/lib/p2p-engine";

const POPULAR_PAYMENT_METHODS = [
  "Bank Transfer",
  "BCA",
  "Mandiri",
  "BRI",
  "BNI",
  "SeaBank",
  "CIMB Niaga",
  "Permata",
  "DANA",
  "GoPay",
  "OVO",
];

interface AutoPricingBotPanelProps {
  sellRefAds: Ad[];
  buyRefAds: Ad[];
  fairPrice: number;
  stockHpp?: number;
  onApplyPrice?: (prices: { buyPrice: number; sellPrice: number }) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function AutoPricingBotPanel({
  sellRefAds,
  buyRefAds,
  fairPrice,
  stockHpp = 0,
  onApplyPrice,
  onRefresh,
  isRefreshing = false,
}: AutoPricingBotPanelProps) {
  // ── Konfigurasi Bot dengan LocalStorage ─────────────────────────────────────
  const [config, setConfig] = useState<CompetitorFilterConfig>(() => loadBotConfig());
  const [copiedSide, setCopiedSide] = useState<"buy" | "sell" | "both" | null>(null);
  const [showRadar, setShowRadar] = useState(false);
  const [radarTab, setRadarTab] = useState<"sell" | "buy">("sell");
  const [radarSearch, setRadarSearch] = useState("");
  const [radarFilterStatus, setRadarFilterStatus] = useState<"all" | "qualified" | "disqualified">("all");

  const [blacklistInput, setBlacklistInput] = useState("");
  const [whitelistInput, setWhitelistInput] = useState("");
  const [importJsonInput, setImportJsonInput] = useState("");
  const [showImportBox, setShowImportBox] = useState(false);

  // Simpan perubahan config ke localStorage
  const updateConfig = (updates: Partial<CompetitorFilterConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveBotConfig(next);
      return next;
    });
  };

  const applyPreset = (presetKey: StrategyPreset) => {
    const preset = STRATEGY_PRESETS[presetKey];
    if (!preset) return;
    updateConfig(preset.config);
    toast.success(`Preset "${preset.label}" diterapkan!`);
  };

  const resetToDefault = () => {
    setConfig(DEFAULT_BOT_CONFIG);
    saveBotConfig(DEFAULT_BOT_CONFIG);
    toast.success("Konfigurasi bot berhasil di-reset ke setelan awal pabrik!");
  };

  const exportConfigJson = () => {
    const jsonStr = JSON.stringify(config, null, 2);
    navigator.clipboard.writeText(jsonStr);
    toast.success("Konfigurasi bot (JSON) berhasil disalin ke clipboard!");
  };

  const importConfigFromJson = () => {
    try {
      const parsed = JSON.parse(importJsonInput);
      const merged: CompetitorFilterConfig = { ...DEFAULT_BOT_CONFIG, ...parsed };
      if (!Array.isArray(merged.filterPaymentMethods)) merged.filterPaymentMethods = [];
      if (!Array.isArray(merged.blacklistedMerchants)) merged.blacklistedMerchants = [];
      if (!Array.isArray(merged.whitelistedMerchants)) merged.whitelistedMerchants = [];
      setConfig(merged);
      saveBotConfig(merged);
      setImportJsonInput("");
      setShowImportBox(false);
      toast.success("Konfigurasi bot berhasil diimpor!");
    } catch {
      toast.error("Format JSON tidak valid! Pastikan JSON tersusun benar.");
    }
  };

  // ── Manajemen Metode Pembayaran ─────────────────────────────────────────────
  const togglePaymentMethod = (method: string) => {
    const current = config.filterPaymentMethods || [];
    const exists = current.some((m) => m.toLowerCase() === method.toLowerCase());
    const next = exists
      ? current.filter((m) => m.toLowerCase() !== method.toLowerCase())
      : [...current, method];
    updateConfig({ filterPaymentMethods: next });
  };

  const clearPaymentMethods = () => {
    updateConfig({ filterPaymentMethods: [] });
    toast.info("Filter metode pembayaran di-reset ke semua.");
  };

  // ── Manajemen Blacklist & Whitelist ─────────────────────────────────────────
  const addBlacklistedMerchant = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = config.blacklistedMerchants || [];
    if (current.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
      toast.info(`Merchant "${trimmed}" sudah ada di blacklist.`);
      return;
    }
    const next = [...current, trimmed];
    updateConfig({ blacklistedMerchants: next });
    toast.success(`"${trimmed}" ditambahkan ke blacklist.`);
    setBlacklistInput("");
  };

  const removeBlacklistedMerchant = (name: string) => {
    const current = config.blacklistedMerchants || [];
    const next = current.filter((m) => m.toLowerCase() !== name.toLowerCase());
    updateConfig({ blacklistedMerchants: next });
    toast.info(`Merchant "${name}" dihapus dari blacklist.`);
  };

  const clearBlacklist = () => {
    updateConfig({ blacklistedMerchants: [] });
    toast.info("Daftar blacklist dikosongkan.");
  };

  const addWhitelistedMerchant = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = config.whitelistedMerchants || [];
    if (current.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
      toast.info(`Merchant "${trimmed}" sudah ada di whitelist.`);
      return;
    }
    const next = [...current, trimmed];
    updateConfig({ whitelistedMerchants: next });
    toast.success(`"${trimmed}" ditambahkan ke whitelist.`);
    setWhitelistInput("");
  };

  const removeWhitelistedMerchant = (name: string) => {
    const current = config.whitelistedMerchants || [];
    const next = current.filter((m) => m.toLowerCase() !== name.toLowerCase());
    updateConfig({ whitelistedMerchants: next });
    toast.info(`Merchant "${name}" dihapus dari whitelist.`);
  };

  const clearWhitelist = () => {
    updateConfig({ whitelistedMerchants: [] });
    toast.info("Daftar whitelist dikosongkan.");
  };

  // ── Eksekusi Kalkulasi Bot ──────────────────────────────────────────────────
  const pricingResult = useMemo(() => {
    return computeCompetitorPricing({
      sellRefAds,
      buyRefAds,
      config,
      stockHpp,
      fairPrice,
    });
  }, [sellRefAds, buyRefAds, config, stockHpp, fairPrice]);

  const {
    recommendedSellPrice,
    recommendedBuyPrice,
    sellTargetMerchant,
    buyTargetMerchant,
    sellRankUsed,
    buyRankUsed,
    targetMethodDescription,
    qualifiedSellAds,
    evaluatedSellAds,
    qualifiedBuyAds,
    evaluatedBuyAds,
    sellGuard,
    buyGuard,
    spreadAbs,
    spreadPct,
    makerFeeSellPerUsdt,
    makerFeeBuyPerUsdt,
    estimatedNetProfitPerUsdt,
  } = pricingResult;

  const hasAnyGuardTriggered = sellGuard.triggered || buyGuard.triggered;

  const handleCopy = (price: number, side: "buy" | "sell") => {
    navigator.clipboard.writeText(String(Math.round(price)));
    setCopiedSide(side);
    toast.success(`Harga ${side === "buy" ? "Beli" : "Jual"} Rp ${Math.round(price).toLocaleString("id-ID")} disalin.`);
    setTimeout(() => setCopiedSide(null), 2000);
  };

  const handleApplyBoth = () => {
    if (onApplyPrice) {
      onApplyPrice({
        buyPrice: recommendedBuyPrice,
        sellPrice: recommendedSellPrice,
      });
      toast.success("Harga rekomendasi bot diterapkan ke form transaksi!");
    } else {
      navigator.clipboard.writeText(
        `BUY: ${Math.round(recommendedBuyPrice)} | SELL: ${Math.round(recommendedSellPrice)}`,
      );
      setCopiedSide("both");
      toast.success("Pasangan harga Beli & Jual disalin ke clipboard!");
      setTimeout(() => setCopiedSide(null), 2000);
    }
  };

  // ── Filter Data untuk Tabel Radar Pasar ─────────────────────────────────────
  const currentRadarAds = radarTab === "sell" ? evaluatedSellAds : evaluatedBuyAds;

  const filteredRadarAds = useMemo(() => {
    return currentRadarAds.filter((item) => {
      if (radarFilterStatus === "qualified" && !item.isQualified) return false;
      if (radarFilterStatus === "disqualified" && item.isQualified) return false;

      if (radarSearch.trim()) {
        const q = radarSearch.toLowerCase().trim();
        const matchName = item.ad.merchant_name.toLowerCase().includes(q);
        const matchPay = item.ad.pay_methods.some((p) => p.toLowerCase().includes(q));
        const matchPrice = String(item.ad.price).includes(q);
        if (!matchName && !matchPay && !matchPrice) return false;
      }
      return true;
    });
  }, [currentRadarAds, radarFilterStatus, radarSearch]);

  // Statistik Diskualifikasi untuk Radar Banner
  const disqualificationStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const item of currentRadarAds) {
      if (!item.isQualified) {
        for (const r of item.disqualificationReasons) {
          stats[r.code] = (stats[r.code] || 0) + 1;
        }
      }
    }
    return stats;
  }, [currentRadarAds]);

  return (
    <div className="panel overflow-hidden border-border/80 bg-surface/90 shadow-md">
      {/* ── Header Bot ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-surface-2/60 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex size-8 items-center justify-center rounded-lg border ${
              !config.enabled
                ? "border-muted-foreground/30 bg-muted/20 text-muted-foreground"
                : hasAnyGuardTriggered
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-500"
                  : "border-bid/40 bg-bid/15 text-bid"
            }`}
          >
            <Bot className="size-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">
                Bot Auto-Pricing: Advanced Market Engine
              </h3>
              {config.enabled ? (
                hasAnyGuardTriggered ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[0.68rem] font-semibold text-amber-500">
                    <ShieldAlert className="size-3" /> Guardrail Aktif
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-bid/30 bg-bid/10 px-2 py-0.5 text-[0.68rem] font-semibold text-bid">
                    <Sparkles className="size-3" /> Mengikuti Kompetitor
                  </span>
                )
              ) : (
                <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[0.68rem] font-medium text-muted-foreground">
                  Standby / Nonaktif
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Filter multi-kriteria: modal USDT, bank transfer, batas limit, anti-pancingan, dan proteksi modal.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">Status Bot:</span>
            <Switch
              checked={config.enabled}
              onCheckedChange={(val) => updateConfig({ enabled: val })}
              className="scale-90 data-[state=checked]:bg-bid"
            />
            <span className={`font-semibold ${config.enabled ? "text-bid" : "text-muted-foreground"}`}>
              {config.enabled ? "AKTIF" : "OFF"}
            </span>
          </div>

          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-8 gap-1.5 border-border/80 text-xs hover:bg-surface-3"
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-primary" : ""}`} />
              <span className="hidden sm:inline">Refresh Pasar</span>
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4.5">
        {/* ── Rekomendasi Harga Jual & Beli Berdampingan ───────────────────────── */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Sisi Rekomendasi BELI */}
          <div
            className={`rounded-xl border p-4 transition-all ${
              buyGuard.triggered
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-bid/35 bg-gradient-to-br from-surface to-bid/5"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-bid animate-pulse" />
                <span className="text-xs font-bold text-bid uppercase tracking-wider">
                  Target Pasang Beli (Maker Buy)
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCopy(recommendedBuyPrice, "buy")}
                className="h-6.5 gap-1 border-bid/30 bg-bid/10 text-bid hover:bg-bid/20 text-xs font-semibold px-2"
              >
                {copiedSide === "buy" ? (
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

            <div className="mt-2 flex items-baseline justify-between">
              <div>
                <div className="text-[0.68rem] text-muted-foreground font-medium uppercase tracking-wider">
                  Harga Iklan Beli Anda
                </div>
                <div className="num text-2xl sm:text-3xl font-extrabold text-foreground">
                  {fmtRp2(recommendedBuyPrice)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[0.68rem] text-muted-foreground">Offset Strategi</div>
                <div className="text-xs font-bold text-bid num">
                  {config.buyOffsetRp >= 0 ? `+Rp ${config.buyOffsetRp}` : `-Rp ${Math.abs(config.buyOffsetRp)}`}
                  {config.buyOffsetRp === 0 ? " (Match)" : " (Overcut)"}
                </div>
              </div>
            </div>

            {/* Target Merchant Acuan yang Diikuti */}
            <div className="mt-3 rounded-lg border border-border/70 bg-surface-2/80 p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-medium text-[0.72rem]">Dasar Acuan:</span>
                <span className="font-bold text-foreground inline-flex items-center gap-1">
                  {targetMethodDescription.buy}
                  {buyTargetMerchant?.is_verified && (
                    <span className="size-1.5 rounded-full bg-amber-400" title="Verified Merchant" />
                  )}
                </span>
              </div>

              {buyTargetMerchant && (
                <div className="flex items-center justify-between text-[0.72rem] text-muted-foreground pt-0.5 border-t border-border/40">
                  <span>
                    Stok: <strong className="text-foreground">{Math.round(buyTargetMerchant.available_usdt || (buyTargetMerchant.price > 0 ? buyTargetMerchant.available_idr / buyTargetMerchant.price : 0))} USDT</strong>
                  </span>
                  <span>
                    Harga Mereka: <strong className="num text-foreground">{fmtRp2(buyTargetMerchant.price)}</strong>
                  </span>
                  <span>
                    Rate: <strong className="text-foreground">{buyTargetMerchant ? fmtRate(buyTargetMerchant.completion_rate) : "—"}</strong>
                  </span>
                </div>
              )}
            </div>

            {/* Status Guardrail Beli */}
            <div className="mt-2.5 flex items-center justify-between text-[0.7rem]">
              <span className="text-muted-foreground">Batas Atas (Ceiling):</span>
              {buyGuard.triggered ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                  <ShieldAlert className="size-3" /> Terkunci Ceiling {fmtRp2(buyGuard.ceilingPrice)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <ShieldCheck className="size-3 text-bid" /> Max {fmtRp2(buyGuard.ceilingPrice)} (Aman)
                </span>
              )}
            </div>
          </div>

          {/* Sisi Rekomendasi JUAL */}
          <div
            className={`rounded-xl border p-4 transition-all ${
              sellGuard.triggered
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-ask/35 bg-gradient-to-br from-surface to-ask/5"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-ask animate-pulse" />
                <span className="text-xs font-bold text-ask uppercase tracking-wider">
                  Target Pasang Jual (Maker Sell)
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCopy(recommendedSellPrice, "sell")}
                className="h-6.5 gap-1 border-ask/30 bg-ask/10 text-ask hover:bg-ask/20 text-xs font-semibold px-2"
              >
                {copiedSide === "sell" ? (
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

            <div className="mt-2 flex items-baseline justify-between">
              <div>
                <div className="text-[0.68rem] text-muted-foreground font-medium uppercase tracking-wider">
                  Harga Iklan Jual Anda
                </div>
                <div className="num text-2xl sm:text-3xl font-extrabold text-foreground">
                  {fmtRp2(recommendedSellPrice)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[0.68rem] text-muted-foreground">Offset Strategi</div>
                <div className="text-xs font-bold text-ask num">
                  {config.sellOffsetRp <= 0 ? `-Rp ${Math.abs(config.sellOffsetRp)}` : `+Rp ${config.sellOffsetRp}`}
                  {config.sellOffsetRp === 0 ? " (Match)" : " (Undercut)"}
                </div>
              </div>
            </div>

            {/* Target Merchant Acuan yang Diikuti */}
            <div className="mt-3 rounded-lg border border-border/70 bg-surface-2/80 p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-medium text-[0.72rem]">Dasar Acuan:</span>
                <span className="font-bold text-foreground inline-flex items-center gap-1">
                  {targetMethodDescription.sell}
                  {sellTargetMerchant?.is_verified && (
                    <span className="size-1.5 rounded-full bg-amber-400" title="Verified Merchant" />
                  )}
                </span>
              </div>

              {sellTargetMerchant && (
                <div className="flex items-center justify-between text-[0.72rem] text-muted-foreground pt-0.5 border-t border-border/40">
                  <span>
                    Stok: <strong className="text-foreground">{Math.round(sellTargetMerchant.available_usdt || (sellTargetMerchant.price > 0 ? sellTargetMerchant.available_idr / sellTargetMerchant.price : 0))} USDT</strong>
                  </span>
                  <span>
                    Harga Mereka: <strong className="num text-foreground">{fmtRp2(sellTargetMerchant.price)}</strong>
                  </span>
                  <span>
                    Rate: <strong className="text-foreground">{sellTargetMerchant ? fmtRate(sellTargetMerchant.completion_rate) : "—"}</strong>
                  </span>
                </div>
              )}
            </div>

            {/* Status Guardrail Jual */}
            <div className="mt-2.5 flex items-center justify-between text-[0.7rem]">
              <span className="text-muted-foreground">Batas Bawah (Floor HPP):</span>
              {sellGuard.triggered ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                  <ShieldAlert className="size-3" /> Terkunci Floor {fmtRp2(sellGuard.floorPrice)} (Anti-Rugi)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <ShieldCheck className="size-3 text-ask" /> Min {fmtRp2(sellGuard.floorPrice)} (Aman)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Banner Ringkasan Spread & Profit ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface-2/60 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div>
              <span className="text-muted-foreground">Spread Target:</span>{" "}
              <strong className="num font-bold text-primary">+{fmtRp(spreadAbs)} ({fmtPct(spreadPct)})</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Total Fee Maker:</span>{" "}
              <strong className="num font-semibold text-foreground">Rp {fmtRp2(makerFeeSellPerUsdt + makerFeeBuyPerUsdt)}/USDT</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Estimasi Laba Bersih:</span>{" "}
              <strong className={`num font-bold ${estimatedNetProfitPerUsdt > 0 ? "text-bid" : "text-destructive"}`}>
                +{fmtRp2(estimatedNetProfitPerUsdt)}/USDT
              </strong>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={handleApplyBoth}
              className="h-7 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold px-3 shadow-sm"
            >
              {copiedSide === "both" ? <Check className="size-3.5" /> : <Zap className="size-3.5" />}
              {onApplyPrice ? "Terapkan ke Order" : "Salin Pasangan Harga"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowRadar(!showRadar)}
              className="h-7 gap-1 border-border/80 text-xs hover:bg-surface-3"
            >
              <Filter className="size-3.5" />
              <span>Radar Pasar ({radarTab === "sell" ? qualifiedSellAds.length : qualifiedBuyAds.length}/{currentRadarAds.length})</span>
              {showRadar ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </Button>
          </div>
        </div>

        {/* ── Radar Kompetitor Transparan (Inspect Evaluated Ads) ──────────────── */}
        {showRadar && (
          <div className="rounded-xl border border-border/80 bg-surface p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-primary animate-pulse" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Radar Pasar: Analisis Kelayakan Kompetitor
                </h4>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={radarTab === "sell" ? "default" : "ghost"}
                  onClick={() => setRadarTab("sell")}
                  className="h-6 text-[0.7rem] px-2.5"
                >
                  Iklan JUAL ({evaluatedSellAds.length})
                </Button>
                <Button
                  size="sm"
                  variant={radarTab === "buy" ? "default" : "ghost"}
                  onClick={() => setRadarTab("buy")}
                  className="h-6 text-[0.7rem] px-2.5"
                >
                  Iklan BELI ({evaluatedBuyAds.length})
                </Button>
              </div>
            </div>

            {/* Baris Kontrol Radar: Search & Quick Status Filter */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 flex-1 min-w-[220px] max-w-sm">
                <div className="relative w-full">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Cari merchant, bank, atau harga..."
                    value={radarSearch}
                    onChange={(e) => setRadarSearch(e.target.value)}
                    className="h-7 pl-8 text-xs bg-surface-2"
                  />
                  {radarSearch && (
                    <button
                      type="button"
                      onClick={() => setRadarSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground text-[0.7rem]">Filter Status:</span>
                <button
                  type="button"
                  onClick={() => setRadarFilterStatus("all")}
                  className={`rounded px-2 py-0.5 text-[0.68rem] font-semibold transition-colors ${
                    radarFilterStatus === "all"
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                  }`}
                >
                  Semua ({currentRadarAds.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRadarFilterStatus("qualified")}
                  className={`rounded px-2 py-0.5 text-[0.68rem] font-semibold transition-colors ${
                    radarFilterStatus === "qualified"
                      ? "bg-bid text-white"
                      : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                  }`}
                >
                  ✅ Lolos ({(radarTab === "sell" ? qualifiedSellAds : qualifiedBuyAds).length})
                </button>
                <button
                  type="button"
                  onClick={() => setRadarFilterStatus("disqualified")}
                  className={`rounded px-2 py-0.5 text-[0.68rem] font-semibold transition-colors ${
                    radarFilterStatus === "disqualified"
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                  }`}
                >
                  ❌ Tereliminasi ({currentRadarAds.length - (radarTab === "sell" ? qualifiedSellAds : qualifiedBuyAds).length})
                </button>
              </div>
            </div>

            {/* Ringkasan Alasan Diskualifikasi */}
            {Object.keys(disqualificationStats).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[0.68rem]">
                <span className="text-muted-foreground font-medium">Alasan Eliminasi:</span>
                {disqualificationStats.USDT_TOO_LOW && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-amber-500/30 text-amber-500">
                    Stok &lt; Min ({disqualificationStats.USDT_TOO_LOW})
                  </Badge>
                )}
                {disqualificationStats.USDT_TOO_HIGH && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-purple-500/30 text-purple-400">
                    Akun Whale ({disqualificationStats.USDT_TOO_HIGH})
                  </Badge>
                )}
                {disqualificationStats.MIN_LIMIT_TOO_HIGH && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-rose-500/30 text-rose-400">
                    Min Limit &ge; Batas ({disqualificationStats.MIN_LIMIT_TOO_HIGH})
                  </Badge>
                )}
                {disqualificationStats.UNVERIFIED && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-border text-muted-foreground">
                    Non-Verified ({disqualificationStats.UNVERIFIED})
                  </Badge>
                )}
                {disqualificationStats.PAYMENT_METHOD_MISMATCH && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-blue-500/30 text-blue-400">
                    Bank Beda ({disqualificationStats.PAYMENT_METHOD_MISMATCH})
                  </Badge>
                )}
                {disqualificationStats.ONLY_EWALLET && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-orange-500/30 text-orange-400">
                    Hanya E-Wallet ({disqualificationStats.ONLY_EWALLET})
                  </Badge>
                )}
                {disqualificationStats.PRICE_OUTLIER && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-destructive/40 text-destructive">
                    Pancingan Ekstrem ({disqualificationStats.PRICE_OUTLIER})
                  </Badge>
                )}
                {disqualificationStats.BLACKLISTED && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-destructive/40 text-destructive">
                    Blacklist ({disqualificationStats.BLACKLISTED})
                  </Badge>
                )}
                {disqualificationStats.NOT_IN_WHITELIST && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-border text-muted-foreground">
                    Bukan Whitelist ({disqualificationStats.NOT_IN_WHITELIST})
                  </Badge>
                )}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-surface-2 text-[0.68rem] text-muted-foreground uppercase border-b border-border/60 z-10">
                  <tr>
                    <th className="p-2">Merchant</th>
                    <th className="p-2 text-right">Harga</th>
                    <th className="p-2 text-right">Kapasitas USDT</th>
                    <th className="p-2 text-right">Batas Limit Transaksi</th>
                    <th className="p-2 text-left">Metode Bayar</th>
                    <th className="p-2 text-center">Rate</th>
                    <th className="p-2">Status Filter Bot</th>
                    <th className="p-2 text-center">Aksi Cepat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredRadarAds.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-xs text-muted-foreground italic">
                        Tidak ada iklan yang sesuai dengan kriteria pencarian radar.
                      </td>
                    </tr>
                  ) : (
                    filteredRadarAds.map((item, idx) => {
                      const usdt = item.ad.available_usdt || (item.ad.price > 0 ? item.ad.available_idr / item.ad.price : 0);
                      const isTarget =
                        item.isQualified &&
                        ((radarTab === "sell" && sellTargetMerchant?.merchant_name === item.ad.merchant_name && sellTargetMerchant?.price === item.ad.price) ||
                          (radarTab === "buy" && buyTargetMerchant?.merchant_name === item.ad.merchant_name && buyTargetMerchant?.price === item.ad.price));

                      const isBlacklisted = config.blacklistedMerchants?.some(
                        (b) => b && b.toLowerCase() === item.ad.merchant_name.toLowerCase(),
                      );
                      const isWhitelisted = config.whitelistedMerchants?.some(
                        (w) => w && w.toLowerCase() === item.ad.merchant_name.toLowerCase(),
                      );

                      return (
                        <tr
                          key={`${item.ad.merchant_name}_${idx}`}
                          className={`group transition-colors ${
                            isTarget
                              ? "bg-primary/10 font-medium"
                              : isBlacklisted
                                ? "bg-destructive/5 opacity-60 hover:opacity-100"
                                : item.isQualified
                                  ? "hover:bg-surface-2/40"
                                  : "bg-surface-2/15 opacity-75 hover:opacity-100"
                          }`}
                        >
                          <td className="p-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-foreground">{item.ad.merchant_name}</span>
                              {item.ad.is_verified && (
                                <span className="size-1.5 rounded-full bg-amber-400" title="Verified Merchant" />
                              )}
                              {isTarget && (
                                <Badge variant="default" className="text-[0.62rem] h-4 px-1 bg-primary text-primary-foreground font-bold">
                                  Target #{radarTab === "sell" ? sellRankUsed : buyRankUsed}
                                </Badge>
                              )}
                              {isBlacklisted && (
                                <Badge variant="destructive" className="text-[0.6rem] h-4 px-1">
                                  Blacklist
                                </Badge>
                              )}
                              {isWhitelisted && (
                                <Badge variant="outline" className="text-[0.6rem] h-4 px-1 border-primary/40 text-primary">
                                  Whitelist
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-right num font-bold text-foreground">
                            {fmtRp2(item.ad.price)}
                          </td>
                          <td className="p-2 text-right num">
                            <span className={usdt < config.minUsdtAmount ? "text-amber-500 font-semibold" : "text-foreground"}>
                              {Math.round(usdt).toLocaleString("id-ID")} USDT
                            </span>
                          </td>
                          <td className="p-2 text-right num text-muted-foreground text-[0.7rem]">
                            <div>{fmtRp(item.ad.min_limit_idr)}</div>
                            {item.ad.max_limit_idr > 0 && (
                              <div className="text-[0.65rem] opacity-75">s/d {fmtRp(item.ad.max_limit_idr)}</div>
                            )}
                          </td>
                          <td className="p-2 text-muted-foreground text-[0.68rem] max-w-[120px] truncate" title={item.ad.pay_methods.join(", ")}>
                            {item.ad.pay_methods.length > 0 ? item.ad.pay_methods.slice(0, 2).join(", ") : "—"}
                            {item.ad.pay_methods.length > 2 && ` +${item.ad.pay_methods.length - 2}`}
                          </td>
                          <td className="p-2 text-center text-muted-foreground text-[0.7rem] font-medium">
                            {fmtRate(item.ad.completion_rate)}
                          </td>
                          <td className="p-2">
                            {item.isQualified ? (
                              <span className="inline-flex items-center gap-1 text-[0.68rem] text-bid font-semibold">
                                <CheckCircle2 className="size-3" /> Lolos Filter
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-[0.65rem] text-destructive"
                                title={item.disqualificationReasons.map((r) => r.message).join(", ")}
                              >
                                <XCircle className="size-3" /> {item.disqualificationReasons[0]?.message ?? "Dieliminasi"}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {/* Tombol Blacklist 1-klik */}
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => {
                                  if (isBlacklisted) {
                                    removeBlacklistedMerchant(item.ad.merchant_name);
                                  } else {
                                    addBlacklistedMerchant(item.ad.merchant_name);
                                  }
                                }}
                                className={`h-6 w-6 p-0 text-xs ${
                                  isBlacklisted
                                    ? "text-destructive hover:bg-destructive/15"
                                    : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                }`}
                                title={isBlacklisted ? "Hapus dari blacklist" : "Blacklist merchant ini"}
                              >
                                {isBlacklisted ? <Ban className="size-3 text-destructive" /> : <UserX className="size-3" />}
                              </Button>

                              {/* Tombol Whitelist 1-klik */}
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => {
                                  if (isWhitelisted) {
                                    removeWhitelistedMerchant(item.ad.merchant_name);
                                  } else {
                                    addWhitelistedMerchant(item.ad.merchant_name);
                                  }
                                }}
                                className={`h-6 w-6 p-0 text-xs ${
                                  isWhitelisted
                                    ? "text-primary hover:bg-primary/15"
                                    : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                                }`}
                                title={isWhitelisted ? "Hapus dari whitelist" : "Tambahkan ke whitelist"}
                              >
                                <UserCheck className={`size-3 ${isWhitelisted ? "text-primary" : ""}`} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab Konfigurasi Filter, Presets, Boundaries & Manajemen Merchant ── */}
        <div className="rounded-xl border border-border/80 bg-surface p-3.5 space-y-3.5">
          <Tabs defaultValue="presets" className="w-full">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
              <div className="flex items-center gap-2">
                <Settings2 className="size-4 text-primary" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Pengaturan Bot & Filter Pasar
                </span>
              </div>
              <TabsList className="h-7 bg-surface-2 flex flex-wrap max-w-full overflow-x-auto">
                <TabsTrigger value="presets" className="text-xs px-2.5 h-6">
                  ⚡ Preset
                </TabsTrigger>
                <TabsTrigger value="filter" className="text-xs px-2.5 h-6">
                  ⚙️ Akun & Modal
                </TabsTrigger>
                <TabsTrigger value="targeting" className="text-xs px-2.5 h-6">
                  🎯 Target Acuan
                </TabsTrigger>
                <TabsTrigger value="payment" className="text-xs px-2.5 h-6">
                  💳 Bank & Bayar {config.filterPaymentMethods?.length > 0 ? `(${config.filterPaymentMethods.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="anti_spoof" className="text-xs px-2.5 h-6">
                  🛡️ Anti-Pancingan
                </TabsTrigger>
                <TabsTrigger value="merchants" className="text-xs px-2.5 h-6">
                  👥 Blacklist & Whitelist
                </TabsTrigger>
                <TabsTrigger value="boundaries" className="text-xs px-2.5 h-6">
                  🔒 Batas Aman
                </TabsTrigger>
                <TabsTrigger value="offset" className="text-xs px-2.5 h-6">
                  🎯 Offset
                </TabsTrigger>
                <TabsTrigger value="backup" className="text-xs px-2.5 h-6">
                  💾 Cadangan & Reset
                </TabsTrigger>
              </TabsList>
            </div>

            {/* TAB PRESETS: PRESET STRATEGI 1-KLIK */}
            <TabsContent value="presets" className="mt-3.5 space-y-3">
              <div>
                <h4 className="text-xs font-bold text-foreground">Preset Profil Strategi Instan</h4>
                <p className="text-[0.7rem] text-muted-foreground">
                  Pilih salah satu profil yang sudah dikalibrasi untuk menerapkan konfigurasi lengkap dalam 1-klik.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {(Object.entries(STRATEGY_PRESETS) as [StrategyPreset, typeof STRATEGY_PRESETS[StrategyPreset]][]).map(([key, item]) => {
                  return (
                    <div
                      key={key}
                      className="rounded-lg border border-border/70 bg-surface-2/60 p-3 space-y-2 flex flex-col justify-between transition-colors hover:border-primary/40"
                    >
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          {key === "balanced" && "🎯"}
                          {key === "conservative" && "🛡️"}
                          {key === "aggressive" && "⚡"}
                          {key === "whale" && "🐋"}
                          {item.label}
                        </span>
                        <p className="text-[0.68rem] text-muted-foreground leading-relaxed">
                          {item.desc}
                        </p>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => applyPreset(key)}
                        className="w-full text-xs h-7 font-semibold mt-2 border-primary/30 text-primary hover:bg-primary/15"
                      >
                        <Wand2 className="size-3 mr-1" /> Terapkan Preset
                      </Button>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            {/* TAB 1: FILTER AKUN, MODAL & REPUTASI */}
            <TabsContent value="filter" className="mt-3.5 space-y-3.5">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {/* Min USDT Amount */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Min Modal USDT
                    </Label>
                    <span className="num text-xs font-bold text-primary">{config.minUsdtAmount} USDT</span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={config.minUsdtAmount}
                    onChange={(e) => updateConfig({ minUsdtAmount: Math.max(0, Number(e.target.value)) })}
                    className="h-8 text-xs bg-surface-2 font-semibold"
                    placeholder="Contoh: 500"
                  />
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    {[0, 200, 500, 1000, 2500].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => updateConfig({ minUsdtAmount: val })}
                        className={`rounded px-1.5 py-0.5 text-[0.62rem] font-medium transition-colors ${
                          config.minUsdtAmount === val
                            ? "bg-primary text-primary-foreground font-bold"
                            : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                        }`}
                      >
                        {val === 0 ? "Bebas" : val}
                      </button>
                    ))}
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">
                    Abaikan merchant yang hanya punya saldo sisa kecil.
                  </p>
                </div>

                {/* Max USDT Amount (Anti-Whale Cap) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Batas Maks USDT (Anti-Whale)
                    </Label>
                    <span className="num text-xs font-bold text-primary">
                      {config.maxUsdtAmount === 0 ? "Bebas" : `${config.maxUsdtAmount} USDT`}
                    </span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={1000}
                    value={config.maxUsdtAmount}
                    onChange={(e) => updateConfig({ maxUsdtAmount: Math.max(0, Number(e.target.value)) })}
                    className="h-8 text-xs bg-surface-2 font-semibold"
                    placeholder="0 = Bebas / Nonaktif"
                  />
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    {[
                      { label: "Bebas", val: 0 },
                      { label: "10k", val: 10_000 },
                      { label: "25k", val: 25_000 },
                      { label: "50k", val: 50_000 },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => updateConfig({ maxUsdtAmount: item.val })}
                        className={`rounded px-1.5 py-0.5 text-[0.62rem] font-medium transition-colors ${
                          config.maxUsdtAmount === item.val
                            ? "bg-primary text-primary-foreground font-bold"
                            : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">
                    Kecualikan akun institusi/whale bermodal raksasa.
                  </p>
                </div>

                {/* Min Order Limit IDR (Plafon Toleransi Syarat Min Transaksi Kompetitor) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-semibold text-foreground">
                        Toleransi Maks Min-Limit (Filter Min Order)
                      </Label>
                      <p className="text-[0.65rem] text-muted-foreground">
                        Filter iklan jika kompetitor mensyaratkan min. order &ge; plafon ini
                      </p>
                    </div>
                    <span className="num text-xs font-bold text-primary">
                      {config.minOrderLimitIdr === 0 ? "Bebas (0)" : `< ${fmtRp(config.minOrderLimitIdr)}`}
                    </span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={5000000}
                    value={config.minOrderLimitIdr}
                    onChange={(e) => updateConfig({ minOrderLimitIdr: Math.max(0, Number(e.target.value)) })}
                    className="h-8 text-xs bg-surface-2 font-semibold"
                    placeholder="Contoh: 50000000 (50 Juta)"
                  />
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    {[
                      { label: "Bebas (0)", val: 0 },
                      { label: "10 Jt", val: 10_000_000 },
                      { label: "25 Jt", val: 25_000_000 },
                      { label: "50 Jt (Anti-Jumbo)", val: 50_000_000 },
                      { label: "100 Jt", val: 100_000_000 },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => updateConfig({ minOrderLimitIdr: item.val })}
                        className={`rounded px-1.5 py-0.5 text-[0.62rem] font-medium transition-colors ${
                          config.minOrderLimitIdr === item.val
                            ? "bg-primary text-primary-foreground font-bold"
                            : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">
                    Kompetitor yang pasang buy/sell dengan syarat minimal transaksi &ge; nilai ini (misal 50 Jt) otomatis terfilter agar bot Anda tidak ikut perang harga melawan order partai besar/grosir.
                  </p>
                </div>

                {/* Min Max Limit IDR (Kapasitas Order Maksimal) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Kapasitas Maks Transaksi
                    </Label>
                    <span className="num text-xs font-bold text-primary">
                      {config.minMaxLimitIdr === 0 ? "Bebas (0)" : fmtRp(config.minMaxLimitIdr)}
                    </span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={5000000}
                    value={config.minMaxLimitIdr}
                    onChange={(e) => updateConfig({ minMaxLimitIdr: Math.max(0, Number(e.target.value)) })}
                    className="h-8 text-xs bg-surface-2 font-semibold"
                    placeholder="0 = Bebas"
                  />
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    {[
                      { label: "Bebas", val: 0 },
                      { label: "10 Jt", val: 10_000_000 },
                      { label: "25 Jt", val: 25_000_000 },
                      { label: "50 Jt", val: 50_000_000 },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => updateConfig({ minMaxLimitIdr: item.val })}
                        className={`rounded px-1.5 py-0.5 text-[0.62rem] font-medium transition-colors ${
                          config.minMaxLimitIdr === item.val
                            ? "bg-primary text-primary-foreground font-bold"
                            : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">
                    Hanya ikuti merchant yang mampu melayani pesanan hingga nominal ini.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 pt-2 border-t border-border/50 text-xs">
                {/* Min Completion Rate */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Min Completion Rate 30 Hari
                    </Label>
                    <span className="num text-xs font-bold text-primary">{config.minCompletionRate}%</span>
                  </div>
                  <Slider
                    value={[config.minCompletionRate]}
                    min={80}
                    max={99}
                    step={1}
                    onValueChange={([val]) => updateConfig({ minCompletionRate: val ?? 95 })}
                    className="py-1"
                  />
                  <p className="text-[0.65rem] text-muted-foreground">
                    Menyaring merchant dengan tingkat pembatalan pesanan tinggi.
                  </p>
                </div>

                {/* Min Order 30 Hari */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Min Total Order 30 Hari
                    </Label>
                    <span className="num text-xs font-bold text-primary">{config.minMonthOrders} Order</span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    value={config.minMonthOrders}
                    onChange={(e) => updateConfig({ minMonthOrders: Math.max(0, Number(e.target.value)) })}
                    className="h-7 text-xs bg-surface-2 font-semibold"
                  />
                  <p className="text-[0.65rem] text-muted-foreground">
                    Hanya ikuti merchant yang sudah aktif menyelesaikan pesanan.
                  </p>
                </div>

                {/* Verified Only & User Type */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-foreground cursor-pointer font-semibold">
                      Verified Merchant Only
                    </Label>
                    <Switch
                      checked={config.verifiedOnly}
                      onCheckedChange={(val) => updateConfig({ verifiedOnly: val })}
                      className="scale-90 data-[state=checked]:bg-primary"
                    />
                  </div>

                  <div className="space-y-1 pt-1">
                    <span className="text-[0.68rem] text-muted-foreground">Target Tipe Akun:</span>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { label: "Semua", val: "all" },
                        { label: "PRO Only", val: "merchant_only" },
                        { label: "User Only", val: "user_only" },
                      ].map((item) => (
                        <button
                          key={item.val}
                          type="button"
                          onClick={() => updateConfig({ userTypeFilter: item.val as CompetitorFilterConfig["userTypeFilter"] })}
                          className={`rounded px-1.5 py-1 text-[0.62rem] font-semibold transition-colors border ${
                            config.userTypeFilter === item.val
                              ? "border-primary bg-primary/20 text-primary"
                              : "border-border/60 bg-surface-2 text-muted-foreground hover:bg-surface-3"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* TAB TARGETING: STRATEGI PENENTUAN HARGA ACUAN */}
            <TabsContent value="targeting" className="mt-3.5 space-y-3.5">
              <div>
                <h4 className="text-xs font-bold text-foreground">Metode Penentuan Harga Acuan Kompetitor</h4>
                <p className="text-[0.7rem] text-muted-foreground">
                  Pilih apakah bot harus meniru peringkat spesifik (Rank 1, 2, dll) atau menghitung rata-rata/median dari Top N kompetitor.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {/* Mode 1: Rank Tertentu */}
                <div
                  onClick={() => updateConfig({ targetMode: "rank" })}
                  className={`cursor-pointer rounded-lg border p-3 space-y-2 transition-all ${
                    config.targetMode === "rank"
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/70 bg-surface-2/60 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Target className="size-3.5 text-primary" /> Target Rank Spesifik
                    </span>
                    {config.targetMode === "rank" && <Check className="size-3.5 text-primary" />}
                  </div>
                  <p className="text-[0.68rem] text-muted-foreground">
                    Mengikuti 1 merchant acuan pada urutan peringkat tertentu yang lolos filter.
                  </p>
                </div>

                {/* Mode 2: Rata-rata Top N */}
                <div
                  onClick={() => updateConfig({ targetMode: "average_top" })}
                  className={`cursor-pointer rounded-lg border p-3 space-y-2 transition-all ${
                    config.targetMode === "average_top"
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/70 bg-surface-2/60 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Scale className="size-3.5 text-primary" /> Rata-Rata Top {config.targetTopCount || 3}
                    </span>
                    {config.targetMode === "average_top" && <Check className="size-3.5 text-primary" />}
                  </div>
                  <p className="text-[0.68rem] text-muted-foreground">
                    Menghitung rata-rata harga dari N kompetitor teratas. Lebih stabil & kebal manipulasi 1 akun.
                  </p>
                </div>

                {/* Mode 3: Median Top N */}
                <div
                  onClick={() => updateConfig({ targetMode: "median_top" })}
                  className={`cursor-pointer rounded-lg border p-3 space-y-2 transition-all ${
                    config.targetMode === "median_top"
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/70 bg-surface-2/60 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Sliders className="size-3.5 text-primary" /> Median Top {config.targetTopCount || 3}
                    </span>
                    {config.targetMode === "median_top" && <Check className="size-3.5 text-primary" />}
                  </div>
                  <p className="text-[0.68rem] text-muted-foreground">
                    Mengambil titik tengah nilai (median) dari N kompetitor teratas.
                  </p>
                </div>
              </div>

              {/* Kontrol Parameter Mode yang Dipilih */}
              <div className="rounded-lg border border-border/70 bg-surface-2/40 p-3 space-y-3">
                {config.targetMode === "rank" ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground">
                        Peringkat yang Ditargetkan (Rank Target)
                      </Label>
                      <span className="num text-xs font-bold text-primary">Rank #{config.targetRank}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-2 max-w-sm">
                      {[1, 2, 3, 4, 5].map((r) => (
                        <Button
                          key={r}
                          type="button"
                          variant={config.targetRank === r ? "default" : "outline"}
                          size="sm"
                          onClick={() => updateConfig({ targetRank: r })}
                          className="h-8 text-xs font-semibold"
                        >
                          #{r}
                        </Button>
                      ))}
                    </div>
                    <p className="text-[0.68rem] text-muted-foreground">
                      Rank #1 = Paling atas. Rank #2 / #3 = Mengincar margin lebih aman di antrean kedua/ketiga.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground">
                        Jumlah Top Merchant yang Diagregasi (Top N Pool)
                      </Label>
                      <span className="num text-xs font-bold text-primary">Top {config.targetTopCount || 3} Merchant</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {[2, 3, 4, 5].map((num) => (
                        <Button
                          key={num}
                          type="button"
                          variant={(config.targetTopCount || 3) === num ? "default" : "outline"}
                          size="sm"
                          onClick={() => updateConfig({ targetTopCount: num })}
                          className="h-8 text-xs font-semibold px-4"
                        >
                          Top {num}
                        </Button>
                      ))}
                    </div>
                    <p className="text-[0.68rem] text-muted-foreground">
                      Bot akan menghitung {config.targetMode === "average_top" ? "rata-rata" : "median"} harga dari {config.targetTopCount || 3} kompetitor teratas yang lolos semua filter.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* TAB METODE PEMBAYARAN */}
            <TabsContent value="payment" className="mt-3.5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-foreground">Filter Metode Pembayaran & Rekening Bank</h4>
                  <p className="text-[0.7rem] text-muted-foreground">
                    Saring kompetitor berdasarkan rekening bank yang mereka terima.
                  </p>
                </div>

                {config.filterPaymentMethods?.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearPaymentMethods}
                    className="h-7 text-xs text-destructive hover:bg-destructive/10"
                  >
                    Reset (Ikuti Semua Bank)
                  </Button>
                )}
              </div>

              {/* Opsi Tolak E-Wallet & Match Mode */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-border/70 bg-surface-2/60 p-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-foreground cursor-pointer">
                      Tolak Iklan yang Hanya E-Wallet
                    </Label>
                    <p className="text-[0.68rem] text-muted-foreground">
                      Diskualifikasi merchant yang HANYA menerima DANA/OVO/GoPay tanpa transfer bank.
                    </p>
                  </div>
                  <Switch
                    checked={config.excludeEwallets}
                    onCheckedChange={(val) => updateConfig({ excludeEwallets: val })}
                    className="scale-90 data-[state=checked]:bg-primary ml-2"
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border/70 bg-surface-2/60 p-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold text-foreground">
                      Mode Pencocokan Bank (Match Mode)
                    </Label>
                    <p className="text-[0.68rem] text-muted-foreground">
                      {config.paymentMatchMode === "all" ? "Wajib menyediakan semua bank terpilih" : "Cukup sediakan salah satu bank"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      type="button"
                      onClick={() => updateConfig({ paymentMatchMode: "any" })}
                      className={`rounded px-2 py-1 text-[0.68rem] font-semibold transition-colors ${
                        config.paymentMatchMode === "any"
                          ? "bg-primary text-primary-foreground"
                          : "bg-surface text-muted-foreground hover:bg-surface-3"
                      }`}
                    >
                      ANY
                    </button>
                    <button
                      type="button"
                      onClick={() => updateConfig({ paymentMatchMode: "all" })}
                      className={`rounded px-2 py-1 text-[0.68rem] font-semibold transition-colors ${
                        config.paymentMatchMode === "all"
                          ? "bg-primary text-primary-foreground"
                          : "bg-surface text-muted-foreground hover:bg-surface-3"
                      }`}
                    >
                      ALL
                    </button>
                  </div>
                </div>
              </div>

              {/* Multi-Select Bank Chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {POPULAR_PAYMENT_METHODS.map((bank) => {
                  const isSelected = config.filterPaymentMethods?.some(
                    (m) => m.toLowerCase() === bank.toLowerCase(),
                  );
                  return (
                    <button
                      key={bank}
                      type="button"
                      onClick={() => togglePaymentMethod(bank)}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all border ${
                        isSelected
                          ? "border-primary bg-primary/20 text-primary shadow-sm"
                          : "border-border/70 bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                      }`}
                    >
                      <CreditCard className="size-3" />
                      {bank}
                      {isSelected && <Check className="size-3 ml-0.5" />}
                    </button>
                  );
                })}
              </div>

              <div className="rounded-md border border-border/60 bg-surface-2/40 p-2.5 text-[0.72rem] text-muted-foreground">
                {config.filterPaymentMethods?.length > 0 ? (
                  <span>
                    Bank terpilih: <strong className="text-foreground">{config.filterPaymentMethods.join(", ")}</strong> ({config.paymentMatchMode === "all" ? "Wajib Semua" : "Salah Satu"}).
                  </span>
                ) : (
                  <span>Semua metode pembayaran diterima (tidak ada filter bank spesifik yang dibatasi).</span>
                )}
              </div>
            </TabsContent>

            {/* TAB ANTI-SPOOFING & HARGA PASAR */}
            <TabsContent value="anti_spoof" className="mt-3.5 space-y-3.5">
              <div>
                <h4 className="text-xs font-bold text-foreground">Proteksi Anti-Spoofing & Rentang Harga Pasar</h4>
                <p className="text-[0.7rem] text-muted-foreground">
                  Mencegah bot terkecoh menurunkan harga jika ada kompetitor memasang harga pancingan fake di luar klaster wajar.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-surface-2/60 p-3 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-foreground cursor-pointer">
                      Abaikan Lonjakan Pancingan Ekstrem (Outlier Gap)
                    </Label>
                    <Switch
                      checked={config.ignoreOutlierSpikes}
                      onCheckedChange={(val) => updateConfig({ ignoreOutlierSpikes: val })}
                      className="scale-90 data-[state=checked]:bg-primary"
                    />
                  </div>

                  <p className="text-[0.68rem] text-muted-foreground">
                    Jika harga merchant teratas berselisih terlalu jauh dari merchant berikutnya, bot menandainya sebagai pancingan dan mengabaikannya.
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                    <span className="text-muted-foreground">Ambang Batas Selisih Lonjakan:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold">Rp</span>
                      <Input
                        type="number"
                        min={10}
                        step={5}
                        value={config.maxOutlierGapRp || 40}
                        onChange={(e) => updateConfig({ maxOutlierGapRp: Math.max(10, Number(e.target.value)) })}
                        className="h-6.5 w-20 text-xs bg-surface text-right font-bold"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/70 bg-surface-2/60 p-3 space-y-2.5 text-xs">
                  <div>
                    <Label className="font-semibold text-foreground">
                      Maksimal Perubahan Harga Per Siklus
                    </Label>
                    <p className="text-[0.68rem] text-muted-foreground mt-0.5">
                      Membatasi pergerakan lompatan harga rekomendasi bot dalam 1 kali refresh.
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-muted-foreground">Max Step Change:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold">Rp</span>
                      <Input
                        type="number"
                        min={10}
                        step={10}
                        value={config.maxPriceStepRp || 50}
                        onChange={(e) => updateConfig({ maxPriceStepRp: Math.max(10, Number(e.target.value)) })}
                        className="h-6.5 w-20 text-xs bg-surface text-right font-bold"
                      />
                      <span className="text-[0.68rem] text-muted-foreground">/siklus</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rentang Harga Pasar Absolut (Bounds) */}
              <div className="rounded-lg border border-border/70 bg-surface-2/40 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold text-foreground">
                    Rentang Harga Pasar Absolut (Price Range Bounds)
                  </Label>
                  <span className="text-[0.68rem] text-muted-foreground">
                    Abaikan iklan kompetitor jika harganya di luar rentang wajar (mencegah typo/error).
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Batas Minimum Harga Iklan:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold">Rp</span>
                      <Input
                        type="number"
                        min={0}
                        step={100}
                        value={config.minPriceBoundRp || 0}
                        onChange={(e) => updateConfig({ minPriceBoundRp: Math.max(0, Number(e.target.value)) })}
                        className="h-6.5 w-24 text-xs bg-surface text-right font-bold"
                        placeholder="0 = Bebas"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Batas Maksimum Harga Iklan:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold">Rp</span>
                      <Input
                        type="number"
                        min={0}
                        step={100}
                        value={config.maxPriceBoundRp || 0}
                        onChange={(e) => updateConfig({ maxPriceBoundRp: Math.max(0, Number(e.target.value)) })}
                        className="h-6.5 w-24 text-xs bg-surface text-right font-bold"
                        placeholder="0 = Bebas"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* TAB BLACKLIST & WHITELIST MERCHANT */}
            <TabsContent value="merchants" className="mt-3.5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-foreground">Kelola Blacklist & Whitelist Merchant</h4>
                  <p className="text-[0.7rem] text-muted-foreground">
                    Atur nama-nama merchant yang ingin diabaikan sepenuhnya atau merchant yang khusus ingin dipantau.
                  </p>
                </div>

                {/* Switch Mode Filter */}
                <div className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-surface-2 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => updateConfig({ merchantFilterMode: "all_except_blacklist" })}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                      config.merchantFilterMode === "all_except_blacklist"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Kecualikan Blacklist
                  </button>
                  <button
                    type="button"
                    onClick={() => updateConfig({ merchantFilterMode: "whitelist_only" })}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition-all ${
                      config.merchantFilterMode === "whitelist_only"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Hanya Pantau Whitelist
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Panel Blacklist */}
                <div className="rounded-lg border border-border/70 bg-surface-2/40 p-3 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground flex items-center gap-1.5">
                      <UserX className="size-3.5 text-destructive" /> Daftar Blacklist ({config.blacklistedMerchants?.length || 0})
                    </span>
                    {config.blacklistedMerchants?.length > 0 && (
                      <button
                        type="button"
                        onClick={clearBlacklist}
                        className="text-[0.68rem] text-destructive hover:underline"
                      >
                        Kosongkan
                      </button>
                    )}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addBlacklistedMerchant(blacklistInput);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      type="text"
                      placeholder="Ketik nickname merchant..."
                      value={blacklistInput}
                      onChange={(e) => setBlacklistInput(e.target.value)}
                      className="h-7 text-xs bg-surface"
                    />
                    <Button type="submit" size="sm" className="h-7 text-xs font-semibold px-2.5">
                      <Plus className="size-3 mr-1" /> Blacklist
                    </Button>
                  </form>

                  <div className="flex flex-wrap gap-1.5 min-h-[48px] max-h-36 overflow-y-auto pt-1">
                    {config.blacklistedMerchants && config.blacklistedMerchants.length > 0 ? (
                      config.blacklistedMerchants.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => removeBlacklistedMerchant(name)}
                            className="rounded-full p-0.5 hover:bg-destructive/20 ml-0.5"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))
                    ) : (
                      <p className="text-[0.7rem] text-muted-foreground italic py-1">
                        Belum ada merchant di blacklist. Klik [🚫] pada tabel radar di atas untuk blacklist instan.
                      </p>
                    )}
                  </div>
                </div>

                {/* Panel Whitelist */}
                <div className="rounded-lg border border-border/70 bg-surface-2/40 p-3 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground flex items-center gap-1.5">
                      <UserCheck className="size-3.5 text-primary" /> Daftar Whitelist ({config.whitelistedMerchants?.length || 0})
                    </span>
                    {config.whitelistedMerchants?.length > 0 && (
                      <button
                        type="button"
                        onClick={clearWhitelist}
                        className="text-[0.68rem] text-muted-foreground hover:underline"
                      >
                        Kosongkan
                      </button>
                    )}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addWhitelistedMerchant(whitelistInput);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      type="text"
                      placeholder="Ketik nickname merchant..."
                      value={whitelistInput}
                      onChange={(e) => setWhitelistInput(e.target.value)}
                      className="h-7 text-xs bg-surface"
                    />
                    <Button type="submit" size="sm" variant="outline" className="h-7 text-xs font-semibold px-2.5 border-primary/40 text-primary">
                      <Plus className="size-3 mr-1" /> Whitelist
                    </Button>
                  </form>

                  <div className="flex flex-wrap gap-1.5 min-h-[48px] max-h-36 overflow-y-auto pt-1">
                    {config.whitelistedMerchants && config.whitelistedMerchants.length > 0 ? (
                      config.whitelistedMerchants.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => removeWhitelistedMerchant(name)}
                            className="rounded-full p-0.5 hover:bg-primary/20 ml-0.5"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))
                    ) : (
                      <p className="text-[0.7rem] text-muted-foreground italic py-1">
                        Belum ada merchant di whitelist. Aktifkan mode "Hanya Pantau Whitelist" jika ingin bersaing eksklusif.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: BATAS AMAN (BOUNDARIES) */}
            <TabsContent value="boundaries" className="mt-3.5 space-y-3.5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Batas Bawah Jual (Floor Guard) */}
                <div className="rounded-lg border border-ask/30 bg-surface-2/60 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ask uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5" /> Proteksi Batas Bawah Jual (Sell Floor)
                    </span>
                    <span className="num font-bold text-ask">{fmtRp2(sellGuard.floorPrice)}</span>
                  </div>

                  <p className="text-[0.72rem] text-muted-foreground">
                    Mencegah bot memasang harga jual di bawah modal Anda jika kompetitor banting harga.
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      type="button"
                      variant={config.sellFloorMode === "auto_hpp" ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ sellFloorMode: "auto_hpp" })}
                      className="h-7 text-xs font-semibold"
                    >
                      Auto dari HPP Stok
                    </Button>
                    <Button
                      type="button"
                      variant={config.sellFloorMode === "manual" ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ sellFloorMode: "manual" })}
                      className="h-7 text-xs font-semibold"
                    >
                      Nominal Manual
                    </Button>
                  </div>

                  {config.sellFloorMode === "auto_hpp" ? (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-muted-foreground">Target Min Margin Laba:</span>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold">+Rp</span>
                        <Input
                          type="number"
                          min={0}
                          value={config.minProfitMarginRp}
                          onChange={(e) => updateConfig({ minProfitMarginRp: Math.max(0, Number(e.target.value)) })}
                          className="h-6.5 w-20 text-xs bg-surface text-right font-bold"
                        />
                        <span className="text-[0.7rem] text-muted-foreground">/USDT</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-muted-foreground">Nominal Floor Tetap:</span>
                      <Input
                        type="number"
                        min={0}
                        value={config.manualSellFloorRp}
                        onChange={(e) => updateConfig({ manualSellFloorRp: Math.max(0, Number(e.target.value)) })}
                        className="h-6.5 w-28 text-xs bg-surface text-right font-bold"
                      />
                    </div>
                  )}
                </div>

                {/* Batas Atas Beli (Ceiling Guard) */}
                <div className="rounded-lg border border-bid/30 bg-surface-2/60 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-bid uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5" /> Proteksi Batas Atas Beli (Buy Ceiling)
                    </span>
                    <span className="num font-bold text-bid">{fmtRp2(buyGuard.ceilingPrice)}</span>
                  </div>

                  <p className="text-[0.72rem] text-muted-foreground">
                    Mencegah bot menawar beli terlalu tinggi di pucuk yang mengikis spread keuntungan.
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      type="button"
                      variant={config.buyCeilingMode === "auto_fair" ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ buyCeilingMode: "auto_fair" })}
                      className="h-7 text-xs font-semibold"
                    >
                      Auto dari Harga Jual - Min Spread
                    </Button>
                    <Button
                      type="button"
                      variant={config.buyCeilingMode === "manual" ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ buyCeilingMode: "manual" })}
                      className="h-7 text-xs font-semibold"
                    >
                      Nominal Manual
                    </Button>
                  </div>

                  {config.buyCeilingMode === "manual" && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-muted-foreground">Nominal Ceiling Tetap:</span>
                      <Input
                        type="number"
                        min={0}
                        value={config.manualBuyCeilingRp}
                        onChange={(e) => updateConfig({ manualBuyCeilingRp: Math.max(0, Number(e.target.value)) })}
                        className="h-6.5 w-28 text-xs bg-surface text-right font-bold"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                    <span className="text-muted-foreground">Min Spread Guard (Jual - Beli):</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold">Rp</span>
                      <Input
                        type="number"
                        min={5}
                        value={config.minSpreadRp}
                        onChange={(e) => updateConfig({ minSpreadRp: Math.max(5, Number(e.target.value)) })}
                        className="h-6.5 w-20 text-xs bg-surface text-right font-bold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* TAB 3: STRATEGI OFFSET */}
            <TabsContent value="offset" className="mt-3.5 space-y-3.5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Offset Jual */}
                <div className="rounded-lg border border-border/70 bg-surface-2/60 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-foreground">Offset Harga Jual vs Kompetitor</Label>
                    <span className="num font-bold text-ask">
                      {config.sellOffsetRp <= 0 ? `-Rp ${Math.abs(config.sellOffsetRp)}` : `+Rp ${config.sellOffsetRp}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <Button
                      type="button"
                      variant={config.sellOffsetRp === -1 ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ sellOffsetRp: -1 })}
                      className="h-7 text-xs font-semibold"
                    >
                      -Rp 1 (Undercut)
                    </Button>
                    <Button
                      type="button"
                      variant={config.sellOffsetRp === 0 ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ sellOffsetRp: 0 })}
                      className="h-7 text-xs font-semibold"
                    >
                      Rp 0 (Match)
                    </Button>
                    <Button
                      type="button"
                      variant={config.sellOffsetRp === 1 ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ sellOffsetRp: 1 })}
                      className="h-7 text-xs font-semibold"
                    >
                      +Rp 1 (Pasif)
                    </Button>
                  </div>
                  <p className="text-[0.68rem] text-muted-foreground">
                    -Rp 1 akan menempatkan iklan Anda 1 rupiah lebih murah agar berada di atas kompetitor target.
                  </p>
                </div>

                {/* Offset Beli */}
                <div className="rounded-lg border border-border/70 bg-surface-2/60 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-foreground">Offset Harga Beli vs Kompetitor</Label>
                    <span className="num font-bold text-bid">
                      {config.buyOffsetRp >= 0 ? `+Rp ${config.buyOffsetRp}` : `-Rp ${Math.abs(config.buyOffsetRp)}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <Button
                      type="button"
                      variant={config.buyOffsetRp === 1 ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ buyOffsetRp: 1 })}
                      className="h-7 text-xs font-semibold"
                    >
                      +Rp 1 (Overcut)
                    </Button>
                    <Button
                      type="button"
                      variant={config.buyOffsetRp === 0 ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ buyOffsetRp: 0 })}
                      className="h-7 text-xs font-semibold"
                    >
                      Rp 0 (Match)
                    </Button>
                    <Button
                      type="button"
                      variant={config.buyOffsetRp === -1 ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ buyOffsetRp: -1 })}
                      className="h-7 text-xs font-semibold"
                    >
                      -Rp 1 (Pasif)
                    </Button>
                  </div>
                  <p className="text-[0.68rem] text-muted-foreground">
                    +Rp 1 akan menempatkan iklan beli Anda 1 rupiah lebih tinggi agar berada di atas kompetitor target.
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* TAB CADANGAN & RESET */}
            <TabsContent value="backup" className="mt-3.5 space-y-3.5">
              <div>
                <h4 className="text-xs font-bold text-foreground">Cadangan & Pemulihan Konfigurasi Filter</h4>
                <p className="text-[0.7rem] text-muted-foreground">
                  Simpan cadangan pengaturan Anda atau pulihkan setelan default awal pabrik.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={exportConfigJson}
                  className="h-9 text-xs font-semibold justify-center gap-1.5"
                >
                  <Copy className="size-3.5" /> Salin JSON Konfigurasi
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowImportBox(!showImportBox)}
                  className="h-9 text-xs font-semibold justify-center gap-1.5"
                >
                  <Upload className="size-3.5" /> Impor dari JSON
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetToDefault}
                  className="h-9 text-xs font-semibold text-destructive hover:bg-destructive/10 justify-center gap-1.5"
                >
                  <RotateCcw className="size-3.5" /> Reset ke Default Pabrik
                </Button>
              </div>

              {showImportBox && (
                <div className="rounded-lg border border-border/80 bg-surface-2/60 p-3 space-y-2">
                  <Label className="text-xs font-semibold text-foreground">Tempel (Paste) JSON Konfigurasi:</Label>
                  <textarea
                    rows={4}
                    value={importJsonInput}
                    onChange={(e) => setImportJsonInput(e.target.value)}
                    placeholder='{"minUsdtAmount": 500, "verifiedOnly": true, ...}'
                    className="w-full rounded-md border border-border bg-surface p-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowImportBox(false)}
                      className="h-7 text-xs"
                    >
                      Batal
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={importConfigFromJson}
                      className="h-7 text-xs font-semibold"
                    >
                      Terapkan Konfigurasi
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
