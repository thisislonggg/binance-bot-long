import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Filter,
  Info,
  Radio,
  RefreshCw,
  Scale,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import React, { useMemo, useState, useEffect } from "react";
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
  type CompetitorFilterConfig,
  type EvaluatedAd,
} from "@/lib/competitor-bot";
import { fmtPct, fmtRp, fmtRp2, type Ad } from "@/lib/p2p-engine";

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

  // Simpan perubahan config ke localStorage
  const updateConfig = (updates: Partial<CompetitorFilterConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveBotConfig(next);
      return next;
    });
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
    rawSellPrice,
    rawBuyPrice,
    sellTargetMerchant,
    buyTargetMerchant,
    sellRankUsed,
    buyRankUsed,
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
                Bot Auto-Pricing: Merchant Tracker
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
              Menghitung harga dari merchant bermodal sebanding (filter USDT) dengan batas proteksi HPP.
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
                <span className="font-medium">Kompetitor Teratas Diikuti:</span>
                {buyTargetMerchant ? (
                  <span className="font-bold text-foreground inline-flex items-center gap-1">
                    {buyTargetMerchant.merchant_name}
                    {buyTargetMerchant.is_verified && (
                      <span className="size-1.5 rounded-full bg-amber-400" title="Verified Merchant" />
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">Tidak ada yang lolos filter</span>
                )}
              </div>

              {buyTargetMerchant && (
                <div className="flex items-center justify-between text-[0.72rem] text-muted-foreground pt-0.5 border-t border-border/40">
                  <span>
                    Stok: <strong className="text-foreground">{Math.round(buyTargetMerchant.available_usdt || buyTargetMerchant.available_idr / buyTargetMerchant.price)} USDT</strong>
                  </span>
                  <span>
                    Harga Mereka: <strong className="num text-foreground">{fmtRp2(buyTargetMerchant.price)}</strong>
                  </span>
                  <span>
                    Rate: <strong className="text-foreground">{buyTargetMerchant.completion_rate ? `${buyTargetMerchant.completion_rate.toFixed(1)}%` : "—"}</strong>
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
                <span className="font-medium">Kompetitor Teratas Diikuti:</span>
                {sellTargetMerchant ? (
                  <span className="font-bold text-foreground inline-flex items-center gap-1">
                    {sellTargetMerchant.merchant_name}
                    {sellTargetMerchant.is_verified && (
                      <span className="size-1.5 rounded-full bg-amber-400" title="Verified Merchant" />
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">Tidak ada yang lolos filter</span>
                )}
              </div>

              {sellTargetMerchant && (
                <div className="flex items-center justify-between text-[0.72rem] text-muted-foreground pt-0.5 border-t border-border/40">
                  <span>
                    Stok: <strong className="text-foreground">{Math.round(sellTargetMerchant.available_usdt || sellTargetMerchant.available_idr / sellTargetMerchant.price)} USDT</strong>
                  </span>
                  <span>
                    Harga Mereka: <strong className="num text-foreground">{fmtRp2(sellTargetMerchant.price)}</strong>
                  </span>
                  <span>
                    Rate: <strong className="text-foreground">{sellTargetMerchant.completion_rate ? `${sellTargetMerchant.completion_rate.toFixed(1)}%` : "—"}</strong>
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
              <span>Radar Kompetitor ({qualifiedSellAds.length}/{evaluatedSellAds.length})</span>
              {showRadar ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </Button>
          </div>
        </div>

        {/* ── Radar Kompetitor Transparan (Inspect Evaluated Ads) ──────────────── */}
        {showRadar && (
          <div className="rounded-xl border border-border/80 bg-surface p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-primary animate-pulse" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Radar Pasar: Analisis Kelayakan Merchant
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

            <p className="text-[0.72rem] text-muted-foreground">
              Menampilkan semua iklan kompetitor di buku pesanan saat ini. Iklan bertanda hijau adalah yang lolos filter
              dan dijadikan acuan target harga oleh bot.
            </p>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-surface-2 text-[0.68rem] text-muted-foreground uppercase border-b border-border/60">
                  <tr>
                    <th className="p-2">Merchant</th>
                    <th className="p-2 text-right">Harga</th>
                    <th className="p-2 text-right">Kapasitas USDT</th>
                    <th className="p-2 text-right">Min Order</th>
                    <th className="p-2 text-center">Rate</th>
                    <th className="p-2">Status Filter Bot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {(radarTab === "sell" ? evaluatedSellAds : evaluatedBuyAds).map((item, idx) => {
                    const usdt = item.ad.available_usdt || (item.ad.price > 0 ? item.ad.available_idr / item.ad.price : 0);
                    const isTarget =
                      item.isQualified &&
                      ((radarTab === "sell" && sellTargetMerchant?.merchant_name === item.ad.merchant_name && sellTargetMerchant?.price === item.ad.price) ||
                        (radarTab === "buy" && buyTargetMerchant?.merchant_name === item.ad.merchant_name && buyTargetMerchant?.price === item.ad.price));

                    return (
                      <tr
                        key={`${item.ad.merchant_name}_${idx}`}
                        className={`transition-colors ${
                          isTarget
                            ? "bg-primary/10 font-medium"
                            : item.isQualified
                              ? "hover:bg-surface-2/40"
                              : "bg-surface-2/15 opacity-70 hover:opacity-100"
                        }`}
                      >
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground">{item.ad.merchant_name}</span>
                            {item.ad.is_verified && (
                              <span className="size-1.5 rounded-full bg-amber-400" title="Verified" />
                            )}
                            {isTarget && (
                              <Badge variant="default" className="text-[0.62rem] h-4 px-1 bg-primary text-primary-foreground">
                                Target #{radarTab === "sell" ? sellRankUsed : buyRankUsed}
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
                          {fmtRp(item.ad.min_limit_idr)}
                        </td>
                        <td className="p-2 text-center text-muted-foreground text-[0.7rem]">
                          {item.ad.completion_rate ? `${item.ad.completion_rate.toFixed(0)}%` : "—"}
                        </td>
                        <td className="p-2">
                          {item.isQualified ? (
                            <span className="inline-flex items-center gap-1 text-[0.68rem] text-bid font-semibold">
                              <CheckCircle2 className="size-3" /> Lolos Filter
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[0.65rem] text-destructive" title={item.disqualificationReasons.map((r) => r.message).join(", ")}>
                              <XCircle className="size-3" /> {item.disqualificationReasons[0]?.message ?? "Dieliminasi"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab Konfigurasi Filter & Boundaries ──────────────────────────────── */}
        <div className="rounded-xl border border-border/80 bg-surface p-3.5 space-y-3">
          <Tabs defaultValue="filter" className="w-full">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
              <div className="flex items-center gap-2">
                <Settings2 className="size-4 text-muted-foreground" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Pengaturan Bot & Filter Merchant
                </span>
              </div>
              <TabsList className="h-7 bg-surface-2">
                <TabsTrigger value="filter" className="text-xs px-2.5 h-6">
                  Filter Merchant
                </TabsTrigger>
                <TabsTrigger value="boundaries" className="text-xs px-2.5 h-6">
                  Batas Aman (Safety)
                </TabsTrigger>
                <TabsTrigger value="offset" className="text-xs px-2.5 h-6">
                  Strategi Offset
                </TabsTrigger>
              </TabsList>
            </div>

            {/* TAB 1: FILTER MERCHANT */}
            <TabsContent value="filter" className="mt-3.5 space-y-3.5">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {/* Min USDT Amount */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Min Kapasitas USDT
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
                  <div className="flex items-center gap-1 pt-1">
                    {[200, 500, 1000, 2500].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => updateConfig({ minUsdtAmount: val })}
                        className={`rounded px-1.5 py-0.5 text-[0.62rem] font-medium transition-colors ${
                          config.minUsdtAmount === val
                            ? "bg-primary text-primary-foreground"
                            : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Min Order Limit IDR */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Batas Min Transaksi
                    </Label>
                    <span className="num text-xs font-bold text-primary">
                      {config.minOrderLimitIdr === 0 ? "Bebas (Nonaktif)" : fmtRp(config.minOrderLimitIdr)}
                    </span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={1000000}
                    value={config.minOrderLimitIdr}
                    onChange={(e) => updateConfig({ minOrderLimitIdr: Math.max(0, Number(e.target.value)) })}
                    className="h-8 text-xs bg-surface-2 font-semibold"
                    placeholder="0 = Bebas / Nonaktif"
                  />
                  <div className="flex items-center gap-1 pt-1">
                    {[
                      { label: "Bebas (0)", val: 0 },
                      { label: "10 Jt", val: 10_000_000 },
                      { label: "20 Jt", val: 20_000_000 },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => updateConfig({ minOrderLimitIdr: item.val })}
                        className={`rounded px-1.5 py-0.5 text-[0.62rem] font-medium transition-colors ${
                          config.minOrderLimitIdr === item.val
                            ? "bg-primary text-primary-foreground"
                            : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">
                    Set 0 agar bot tetap mengikuti merchant berapapun batas minimalnya (misal 20 Juta).
                  </p>
                </div>

                {/* Min Completion Rate */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Min Completion Rate
                    </Label>
                    <span className="num text-xs font-bold text-primary">{config.minCompletionRate}%</span>
                  </div>
                  <div className="pt-2">
                    <Slider
                      value={[config.minCompletionRate]}
                      min={80}
                      max={99}
                      step={1}
                      onValueChange={([val]) => updateConfig({ minCompletionRate: val ?? 95 })}
                      className="py-1"
                    />
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">
                    Menyaring merchant dengan riwayat pembatalan tinggi.
                  </p>
                </div>

                {/* Target Rank */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">
                      Peringkat Target
                    </Label>
                    <span className="num text-xs font-bold text-primary">Rank #{config.targetRank}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 pt-1">
                    {[1, 2, 3].map((r) => (
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
                  <p className="text-[0.65rem] text-muted-foreground">
                    #1 untuk paling depan, #2 atau #3 untuk margin lebih aman.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-1 border-t border-border/50 text-xs">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={config.verifiedOnly}
                    onCheckedChange={(val) => updateConfig({ verifiedOnly: val })}
                    className="scale-90 data-[state=checked]:bg-primary"
                  />
                  <Label className="text-xs text-foreground cursor-pointer">
                    Verified Merchant Only (Hanya centang kuning / Pro)
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Min Order 30 Hari:</span>
                  <Input
                    type="number"
                    min={0}
                    value={config.minMonthOrders}
                    onChange={(e) => updateConfig({ minMonthOrders: Math.max(0, Number(e.target.value)) })}
                    className="h-7 w-20 text-xs bg-surface-2 font-semibold"
                  />
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
                    Mencegah bot memasang harga jual di bawah modal Anda jika kompetitor banting harga gila-gilaan.
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
                    Mencegah bot menawar beli terlalu tinggi di pucuk ketika terjadi manipulasi lonjakan harga sesaat.
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      type="button"
                      variant={config.buyCeilingMode === "auto_fair" ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ buyCeilingMode: "auto_fair" })}
                      className="h-7 text-xs font-semibold"
                    >
                      Auto dari Nilai Wajar
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
          </Tabs>
        </div>
      </div>
    </div>
  );
}
