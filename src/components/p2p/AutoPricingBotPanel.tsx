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
  Globe,
  Key,
  Send,
  Terminal,
  Wallet,
  PiggyBank,
  Coins,
  Clock,
  Activity,
  Play,
  Server,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  saveBotConfigToServer,
  getBotConfigFromServer,
  triggerBackgroundBotTickServer,
  getBackgroundBotStatusServer,
} from "@/lib/background-bot-engine";
import {
  pushPriceToBinanceAd,
  toggleMerchantAdStatus,
  type PushPriceResult,
} from "@/lib/binance-merchant";
import { getActiveP2pOrdersSummary } from "@/lib/payment-verifier";
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
  bankBalanceIdr?: number;
  initialCapitalIdr?: number;
  liveStockUsdt?: number;
  stockCapitalIdr?: number;
  sessionToken?: string | null;
  onApplyPrice?: (payload: {
    buyPrice: number;
    sellPrice: number;
    buyAmountUsdt?: number;
    sellAmountUsdt?: number;
    maxBuyLimitIdr?: number;
    targetSide?: "buy" | "sell";
  }) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function AutoPricingBotPanel({
  sellRefAds,
  buyRefAds,
  fairPrice,
  stockHpp = 0,
  bankBalanceIdr = 0,
  initialCapitalIdr = 0,
  liveStockUsdt = 0,
  stockCapitalIdr = 0,
  sessionToken,
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
  const [radarLevelFilter, setRadarLevelFilter] = useState<"all" | "gold" | "silver" | "bronze" | "regular">("all");

  const [blacklistInput, setBlacklistInput] = useState("");
  const [whitelistInput, setWhitelistInput] = useState("");
  const [importJsonInput, setImportJsonInput] = useState("");
  const [showImportBox, setShowImportBox] = useState(false);

  // Token autentikasi sesi
  const effectiveToken =
    sessionToken ||
    (typeof window !== "undefined" ? sessionStorage.getItem("p2p_session_token") : null) ||
    undefined;

  // Server functions untuk background engine 24/7
  const saveConfigToServerFn = useServerFn(saveBotConfigToServer);
  const getConfigFromServerFn = useServerFn(getBotConfigFromServer);
  const triggerTickFn = useServerFn(triggerBackgroundBotTickServer);
  const getStatusFn = useServerFn(getBackgroundBotStatusServer);
  const [isTriggeringServerTick, setIsTriggeringServerTick] = useState(false);

  // Polling status background runner dari server setiap 5 detik
  const { data: serverBotStatus, refetch: refetchServerStatus } = useQuery({
    queryKey: ["p2p-background-bot-status"],
    queryFn: async () => {
      const res = await getStatusFn({ data: { sessionToken: effectiveToken } });
      return res.ok ? res.lastRun : null;
    },
    refetchInterval: 5000,
  });

  // Sync initial config from server if available
  useEffect(() => {
    getConfigFromServerFn({ data: { sessionToken: effectiveToken } })
      .then((res) => {
        if (res.ok && res.config) {
          setConfig((prev) => {
            const merged = { ...prev, ...res.config };
            saveBotConfig(merged);
            return merged;
          });
        }
      })
      .catch(() => {});
  }, [getConfigFromServerFn, effectiveToken]);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Simpan perubahan config ke localStorage & Supabase
  const updateConfig = (updates: Partial<CompetitorFilterConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveBotConfig(next);

      // Debounce sync ke server Supabase agar background runner 24/7 selalu sinkron
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveConfigToServerFn({
          data: {
            sessionToken: effectiveToken,
            config: next as Record<string, unknown>,
          },
        }).catch(() => {});
      }, 500);

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

  // ── Query Order P2P Aktif Real-Time (BUY & SELL) ───────────────────────────
  const getActiveOrdersFn = useServerFn(getActiveP2pOrdersSummary);
  const effectiveSessionToken =
    sessionToken ||
    (typeof window !== "undefined" ? sessionStorage.getItem("p2p_session_token") : null) ||
    undefined;

  const activeOrdersQuery = useQuery({
    queryKey: ["active-p2p-orders-summary", effectiveSessionToken],
    queryFn: () => getActiveOrdersFn({ data: { sessionToken: effectiveSessionToken } }),
    enabled: Boolean(effectiveSessionToken),
    refetchInterval: 2_500,
  });

  const activeBuyOrdersUsdt = activeOrdersQuery.data?.totalActiveBuyUsdt || 0;
  const activeBuyOrdersIdr = activeOrdersQuery.data?.totalActiveBuyIdr || 0;
  const activeBuyOrdersList = activeOrdersQuery.data?.activeBuyOrders || [];

  // Jika pesanan beli aktif selesai/berubah, picu sinkronisasi data saldo dan PnL
  const prevActiveBuyCountRef = useRef<number | null>(null);
  useEffect(() => {
    const curCount = activeBuyOrdersList.length;
    if (prevActiveBuyCountRef.current !== null && curCount < prevActiveBuyCountRef.current) {
      toast.info("Pesanan beli P2P selesai/di-release! Memperbarui data saldo...", { duration: 4000 });
      onRefresh?.();
    }
    prevActiveBuyCountRef.current = curCount;
  }, [activeBuyOrdersList.length, onRefresh]);

  // ── Eksekusi Kalkulasi Bot ──────────────────────────────────────────────────
  const pricingResult = useMemo(() => {
    return computeCompetitorPricing({
      sellRefAds,
      buyRefAds,
      config,
      stockHpp,
      fairPrice,
      bankBalanceIdr,
      initialCapitalIdr,
      liveStockUsdt,
      stockCapitalIdr,
      activeBuyOrdersUsdt,
      activeBuyOrdersIdr,
    });
  }, [
    sellRefAds,
    buyRefAds,
    config,
    stockHpp,
    fairPrice,
    bankBalanceIdr,
    initialCapitalIdr,
    liveStockUsdt,
    stockCapitalIdr,
    activeBuyOrdersUsdt,
    activeBuyOrdersIdr,
  ]);

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
    bankAllocation,
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
        buyAmountUsdt: bankAllocation.autoBuyStockUsdt,
        maxBuyLimitIdr: bankAllocation.autoBuyMaxLimitIdr,
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

  const handleApplyBuyOnly = () => {
    if (onApplyPrice) {
      onApplyPrice({
        buyPrice: recommendedBuyPrice,
        sellPrice: recommendedSellPrice,
        buyAmountUsdt: bankAllocation.autoBuyStockUsdt,
        maxBuyLimitIdr: bankAllocation.autoBuyMaxLimitIdr,
        targetSide: "buy",
      });
      toast.success(
        bankAllocation.autoBuyStockUsdt > 0
          ? `Iklan Beli: Rp ${Math.round(recommendedBuyPrice).toLocaleString("id-ID")} & Stok ${bankAllocation.autoBuyStockUsdt.toLocaleString("id-ID")} USDT diterapkan ke form!`
          : `Harga Beli Rp ${Math.round(recommendedBuyPrice).toLocaleString("id-ID")} diterapkan ke form!`
      );
    } else {
      handleCopyBuyDetails();
    }
  };

  // Kalkulasi Max Available Stok Jual persis sesuai kalkulator "Max. available: ... USDT All" di Binance P2P
  // Binance memotong maker reserved fee (0.05%) saat posting iklan sell dari Funding Wallet
  const maxAvailableSellStockUsdt = useMemo(() => {
    if (!liveStockUsdt || liveStockUsdt <= 0) return 0;
    const safeAvailable = Math.floor((liveStockUsdt / 1.0005) * 100) / 100;
    return Math.max(0, safeAvailable);
  }, [liveStockUsdt]);

  const reservedFeeSellUsdt = useMemo(() => {
    if (!liveStockUsdt || liveStockUsdt <= 0) return 0;
    return Math.max(0, Math.round((liveStockUsdt - maxAvailableSellStockUsdt) * 100) / 100);
  }, [liveStockUsdt, maxAvailableSellStockUsdt]);

  const handleApplySellOnly = () => {
    const effectiveStock =
      config.manualSellStockUsdt && config.manualSellStockUsdt > 0
        ? config.manualSellStockUsdt
        : maxAvailableSellStockUsdt > 0
        ? maxAvailableSellStockUsdt
        : undefined;

    if (onApplyPrice) {
      onApplyPrice({
        buyPrice: recommendedBuyPrice,
        sellPrice: recommendedSellPrice,
        sellAmountUsdt: effectiveStock,
        targetSide: "sell",
      });
      toast.success(
        effectiveStock
          ? `Iklan Jual: Rp ${Math.round(recommendedSellPrice).toLocaleString("id-ID")} & Max Available ${effectiveStock.toLocaleString("id-ID")} USDT diterapkan ke form!`
          : `Harga Jual Rp ${Math.round(recommendedSellPrice).toLocaleString("id-ID")} diterapkan ke form!`
      );
    } else {
      handleCopy(recommendedSellPrice, "sell");
    }
  };

  const handleCopySellDetails = () => {
    const effectiveStock =
      config.manualSellStockUsdt && config.manualSellStockUsdt > 0
        ? config.manualSellStockUsdt
        : maxAvailableSellStockUsdt > 0
        ? maxAvailableSellStockUsdt
        : undefined;

    const text =
      effectiveStock && recommendedSellPrice > 0
        ? `Harga Jual: Rp ${Math.round(recommendedSellPrice).toLocaleString("id-ID")}\nMax Available Stok: ${effectiveStock.toLocaleString("id-ID")} USDT (All)\nPlafon Max Limit: Rp ${Math.round(effectiveStock * recommendedSellPrice).toLocaleString("id-ID")}`
        : `Harga Jual: Rp ${Math.round(recommendedSellPrice).toLocaleString("id-ID")}`;
    navigator.clipboard.writeText(text);
    toast.success("Rincian iklan jual disalin ke clipboard!");
  };

  const handleCopyBuyDetails = () => {
    const minLimit = config.manualBuyMinLimitIdr || 50_000_000;
    const maxLimit = config.manualBuyMaxLimitIdr || 500_000_000;
    const text =
      bankAllocation.autoBuyStockUsdt > 0
        ? `Harga Beli: Rp ${Math.round(recommendedBuyPrice).toLocaleString("id-ID")}\nStok USDT: ${bankAllocation.autoBuyStockUsdt.toLocaleString("id-ID")} USDT\nMin Limit: Rp ${minLimit.toLocaleString("id-ID")}\nMax Limit: Rp ${maxLimit.toLocaleString("id-ID")}`
        : `Harga Beli: Rp ${Math.round(recommendedBuyPrice).toLocaleString("id-ID")}\nMin Limit: Rp ${minLimit.toLocaleString("id-ID")}\nMax Limit: Rp ${maxLimit.toLocaleString("id-ID")}`;
    navigator.clipboard.writeText(text);
    toast.success("Rincian iklan beli disalin ke clipboard!");
  };

  // ── Integrasi Eksekusi C2C Merchant API ─────────────────────────────────────
  const pushPriceFn = useServerFn(pushPriceToBinanceAd);
  const toggleStatusFn = useServerFn(toggleMerchantAdStatus);
  const buyAdOfflinedRef = useRef(false);
  const [isPushingBuy, setIsPushingBuy] = useState(false);
  const [isPushingSell, setIsPushingSell] = useState(false);
  const isPushingBuyRef = useRef(false);
  const isPushingSellRef = useRef(false);
  const [lastPushLog, setLastPushLog] = useState<PushPriceResult | null>(null);

  const handlePushPrice = async (side: "buy" | "sell") => {
    if (side === "buy") {
      if (isPushingBuyRef.current) return;
      isPushingBuyRef.current = true;
      setIsPushingBuy(true);
    } else {
      if (isPushingSellRef.current) return;
      isPushingSellRef.current = true;
      setIsPushingSell(true);
    }

    const advNo = side === "buy" ? config.merchantBuyAdvNo : config.merchantSellAdvNo;
    if (!advNo || !advNo.trim()) {
      toast.error(
        `Nomor Iklan ${side === "buy" ? "Beli" : "Jual"} (advNo) belum diisi. Buka tab "🔌 C2C Merchant API" di bawah untuk mengisinya.`
      );
      if (side === "buy") {
        isPushingBuyRef.current = false;
        setIsPushingBuy(false);
      } else {
        isPushingSellRef.current = false;
        setIsPushingSell(false);
      }
      return;
    }

    // Proteksi Kas Beli: jika sisi Beli dan menggunakan hitungan kas otomatis (bukan override manual)
    if (side === "buy" && (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0)) {
      if (bankAllocation.isBelowMinLimit || bankAllocation.autoBuyStockUsdt <= 0) {
        toast.warning(
          `Kas bank tersisa (Rp ${bankAllocation.usableBankIdr.toLocaleString("id-ID")}) di bawah batas minimal transaksi Rp ${bankAllocation.minBuyLimitIdr.toLocaleString("id-ID")}${
            bankAllocation.lockedActiveBuyIdr > 0
              ? ` karena Rp ${bankAllocation.lockedActiveBuyIdr.toLocaleString("id-ID")} (${bankAllocation.activeBuyOrdersUsdt} USDT) sedang berjalan di pesanan beli aktif`
              : ""
          }. Iklan beli ditahan & otomatis di-OFFLINE-kan di Binance agar tidak over-budget.`,
          { duration: 7000 }
        );
        toggleStatusFn({
          data: {
            sessionToken: effectiveToken,
            advNo: advNo.trim(),
            advStatus: "OFFLINE",
          },
        }).catch(() => {});
        if (side === "buy") {
          isPushingBuyRef.current = false;
          setIsPushingBuy(false);
        }
        return;
      }
    }

    // Proteksi Mock / Offline Orderbook: JANGAN izinkan push jika orderbook Binance adalah mock
    const refAds = side === "sell" ? sellRefAds : buyRefAds;
    const isMock = Array.isArray(refAds) && refAds.some((a) => a.adv_no?.startsWith("mock_"));
    if (isMock) {
      toast.error(
        "Data pasar orderbook Binance P2P saat ini adalah mock / offline fallback. Push ke Binance dibatalkan demi keamanan harga riil."
      );
      if (side === "buy") {
        isPushingBuyRef.current = false;
        setIsPushingBuy(false);
      } else {
        isPushingSellRef.current = false;
        setIsPushingSell(false);
      }
      return;
    }

    const rawPrice = side === "buy" ? recommendedBuyPrice : recommendedSellPrice;
    let price = Math.round(rawPrice);

    // Proteksi Batas Bawah Jual (Sell Floor & Min Price Bound):
    const effectiveSellFloor = Math.max(
      pricingResult.sellGuard.floorPrice || 0,
      config.sellFloorMode === "manual" && config.manualSellFloorRp ? config.manualSellFloorRp : 0,
      config.minPriceBoundRp || 0
    );
    if (side === "sell" && effectiveSellFloor > 0 && price < effectiveSellFloor) {
      price = effectiveSellFloor;
      toast.info(
        `Harga jual otomatis dikunci di Batas Bawah Aman (Rp ${effectiveSellFloor.toLocaleString("id-ID")}) agar tidak memasang harga di bawah batas yang Anda set.`
      );
    }

    // Proteksi Batas Bawah Beli (Buy Floor & Min Price Bound):
    const effectiveBuyFloor = Math.max(
      pricingResult.buyGuard.floorPrice || 0,
      config.buyFloorMode === "manual" && config.manualBuyFloorRp ? config.manualBuyFloorRp : 0,
      config.minPriceBoundRp || 0
    );
    if (side === "buy" && effectiveBuyFloor > 0 && price < effectiveBuyFloor) {
      price = effectiveBuyFloor;
      toast.info(
        `Harga beli dikunci di Batas Bawah Beli (Rp ${effectiveBuyFloor.toLocaleString("id-ID")}) agar tidak menawar di bawah batas minimal.`
      );
    }

    // Proteksi Batas Atas Beli (Buy Ceiling):
    const effectiveBuyCeiling =
      config.buyCeilingMode === "manual" && config.manualBuyCeilingRp > 0 && config.manualBuyCeilingRp < 999_999
        ? config.manualBuyCeilingRp
        : (pricingResult.buyGuard.ceilingPrice || 0);
    if (side === "buy" && effectiveBuyCeiling > 0 && price > effectiveBuyCeiling) {
      price = effectiveBuyCeiling;
      toast.info(
        `Harga beli dikunci di Batas Atas Beli (Rp ${effectiveBuyCeiling.toLocaleString("id-ID")}) agar tidak membeli kemahalan.`
      );
    }

    // Proteksi Batas Maksimum Pasar (Max Price Bound):
    if (config.maxPriceBoundRp && config.maxPriceBoundRp > 0 && price > config.maxPriceBoundRp) {
      if (side === "sell" && effectiveSellFloor > 0 && config.maxPriceBoundRp < effectiveSellFloor) {
        price = effectiveSellFloor;
      } else {
        price = config.maxPriceBoundRp;
      }
    }

    const effectiveBuyStock =
      side === "buy"
        ? config.manualBuyStockUsdt && config.manualBuyStockUsdt > 0
          ? config.manualBuyStockUsdt
          : bankAllocation.autoBuyStockUsdt > 0
          ? bankAllocation.autoBuyStockUsdt
          : undefined
        : undefined;

    const effectiveSellStock =
      side === "sell"
        ? config.manualSellStockUsdt && config.manualSellStockUsdt > 0
          ? config.manualSellStockUsdt
          : maxAvailableSellStockUsdt > 0
          ? maxAvailableSellStockUsdt
          : undefined
        : undefined;

    const effectiveStock = side === "buy" ? effectiveBuyStock : effectiveSellStock;

    const effectiveBuyMaxLimit =
      side === "buy"
        ? config.manualBuyMaxLimitIdr && config.manualBuyMaxLimitIdr > 0
          ? config.manualBuyMaxLimitIdr
          : 500_000_000
        : undefined;

    const effectiveSellMaxLimit =
      side === "sell"
        ? config.manualSellMaxLimitIdr && config.manualSellMaxLimitIdr > 0
          ? config.manualSellMaxLimitIdr
          : effectiveSellStock && price > 0
          ? Math.floor(effectiveSellStock * price)
          : undefined
        : undefined;

    const effectiveMaxLimit = side === "buy" ? effectiveBuyMaxLimit : effectiveSellMaxLimit;

    const effectiveBuyMinLimit =
      side === "buy"
        ? config.manualBuyMinLimitIdr && config.manualBuyMinLimitIdr > 0
          ? config.manualBuyMinLimitIdr
          : 50_000_000
        : undefined;

    const effectiveSellMinLimit =
      side === "sell" && config.manualSellMinLimitIdr && config.manualSellMinLimitIdr > 0
        ? config.manualSellMinLimitIdr
        : undefined;

    const effectiveMinLimit = side === "buy" ? effectiveBuyMinLimit : effectiveSellMinLimit;

    try {
      const res = await pushPriceFn({
        data: {
          sessionToken: effectiveToken,
          advNo: advNo.trim(),
          side,
          price,
          amountUsdt: effectiveStock,
          maxLimitIdr: effectiveMaxLimit,
          minLimitIdr: effectiveMinLimit,
          floorPrice:
            side === "sell"
              ? effectiveSellFloor > 0
                ? effectiveSellFloor
                : undefined
              : effectiveBuyFloor > 0
              ? effectiveBuyFloor
              : undefined,
          ceilingPrice:
            side === "buy" && effectiveBuyCeiling > 0
              ? effectiveBuyCeiling
              : undefined,
        },
      });

      setLastPushLog(res);
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message, {
          duration: 9000,
          action: {
            label: "Terapkan ke Form",
            onClick: () => {
              if (side === "buy") handleApplyBuyOnly();
              else handleApplySellOnly();
            },
          },
        });
      }
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      toast.error(`Gagal mengirim update ke Binance: ${errStr}`);
    } finally {
      if (side === "buy") {
        isPushingBuyRef.current = false;
        setIsPushingBuy(false);
      } else {
        isPushingSellRef.current = false;
        setIsPushingSell(false);
      }
    }
  };

  // Auto-Push ke Binance jika opsi autoPushToBinance aktif
  const lastPushedPricesRef = useRef<{ buy?: number; sell?: number }>({});
  const lastPushedStockRef = useRef<{ buy?: number; sell?: number }>({});
  const lastPushTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!config.autoPushToBinance) return;
    const minIntervalMs = Math.max(1, config.autoPushMinIntervalSec ?? 1) * 1000;

    const checkAndPush = () => {
      const now = Date.now();
      if (now - lastPushTimeRef.current < minIntervalMs) return;

      let buyTriggered = false;

      if (config.merchantBuyAdvNo && recommendedBuyPrice > 0 && !isPushingBuyRef.current) {
        // Cek proteksi kas beli: jika kas tidak cukup atau di bawah minimal limit, JANGAN buat/push iklan beli!
        const isBuyBlocked =
          (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0) &&
          (bankAllocation.isBelowMinLimit || bankAllocation.autoBuyStockUsdt <= 0);

        if (isBuyBlocked) {
          // Kas tidak cukup / 0: Otomatis matikan (OFFLINE) iklan di Binance agar tidak mengambil order di luar modal!
          if (!buyAdOfflinedRef.current) {
            buyAdOfflinedRef.current = true;
            toggleStatusFn({
              data: {
                sessionToken: effectiveToken,
                advNo: config.merchantBuyAdvNo.trim(),
                advStatus: "OFFLINE",
              },
            })
              .then((res) => {
                if (res.ok) {
                  toast.warning(
                    `Saldo kas beli Rp ${bankAllocation.usableBankIdr.toLocaleString("id-ID")} di bawah batas minimal Rp ${bankAllocation.minBuyLimitIdr.toLocaleString("id-ID")}. Iklan beli #${config.merchantBuyAdvNo} otomatis di-OFFLINE-kan di Binance!`,
                    { duration: 8000 }
                  );
                }
              })
              .catch(() => {});
          }
        } else {
          // Kas tersedia: jika sebelumnya pernah di-offline-kan, pulihkan izin online
          if (buyAdOfflinedRef.current) {
            buyAdOfflinedRef.current = false;
            toggleStatusFn({
              data: {
                sessionToken: effectiveToken,
                advNo: config.merchantBuyAdvNo.trim(),
                advStatus: "ONLINE",
              },
            }).catch(() => {});
          }

          const roundedPrice = Math.round(recommendedBuyPrice);
          const effectiveBuyFloor = Math.max(
            pricingResult.buyGuard.floorPrice || 0,
            config.manualBuyFloorRp || 0,
            config.minPriceBoundRp || 0
          );
          if (effectiveBuyFloor > 0 && roundedPrice < effectiveBuyFloor) {
            return; // JANGAN PUSH JIKA DI BAWAH BUY FLOOR
          }

          const currentBuyStock =
            config.manualBuyStockUsdt && config.manualBuyStockUsdt > 0
              ? config.manualBuyStockUsdt
              : bankAllocation.autoBuyStockUsdt;

          const priceChanged = lastPushedPricesRef.current.buy !== roundedPrice;
          const stockChanged = lastPushedStockRef.current.buy !== currentBuyStock;

          if (priceChanged || stockChanged) {
            lastPushedPricesRef.current.buy = roundedPrice;
            lastPushedStockRef.current.buy = currentBuyStock;
            lastPushTimeRef.current = now;
            buyTriggered = true;
            handlePushPrice("buy");
          }
        }
      }

      if (config.merchantSellAdvNo && recommendedSellPrice > 0 && !isPushingSellRef.current) {
        const effectiveSellFloor = Math.max(
          pricingResult.sellGuard.floorPrice || 0,
          config.manualSellFloorRp || 0,
          config.minPriceBoundRp || 0
        );
        let roundedSellPrice = Math.round(recommendedSellPrice);
        if (effectiveSellFloor > 0 && roundedSellPrice < effectiveSellFloor) {
          roundedSellPrice = effectiveSellFloor;
        }

        const currentSellStock =
          config.manualSellStockUsdt && config.manualSellStockUsdt > 0
            ? config.manualSellStockUsdt
            : maxAvailableSellStockUsdt > 0
            ? maxAvailableSellStockUsdt
            : undefined;

        const sellPriceChanged = lastPushedPricesRef.current.sell !== roundedSellPrice;
        const sellStockChanged = lastPushedStockRef.current.sell !== currentSellStock;

        if (sellPriceChanged || sellStockChanged) {
          lastPushedPricesRef.current.sell = roundedSellPrice;
          lastPushedStockRef.current.sell = currentSellStock;
          lastPushTimeRef.current = now;

          if (buyTriggered) {
            // Beri jeda 1000ms jika BUY baru saja dipicu agar request tidak bertabrakan di Binance SAPI
            setTimeout(() => {
              if (!isPushingSellRef.current) {
                handlePushPrice("sell");
              }
            }, 1000);
          } else {
            handlePushPrice("sell");
          }
        }
      }
    };

    checkAndPush();
    const timer = setInterval(checkAndPush, Math.max(1000, minIntervalMs));
    return () => clearInterval(timer);
  }, [
    config.autoPushToBinance,
    config.autoPushMinIntervalSec,
    recommendedBuyPrice,
    recommendedSellPrice,
    config.merchantBuyAdvNo,
    config.merchantSellAdvNo,
    config.manualBuyStockUsdt,
    config.manualSellStockUsdt,
    maxAvailableSellStockUsdt,
    bankAllocation.isBelowMinLimit,
    bankAllocation.autoBuyStockUsdt,
  ]);

  // ── Filter Data untuk Tabel Radar Pasar ─────────────────────────────────────
  const currentRadarAds = radarTab === "sell" ? evaluatedSellAds : evaluatedBuyAds;

  const filteredRadarAds = useMemo(() => {
    return currentRadarAds.filter((item) => {
      if (radarFilterStatus === "qualified" && !item.isQualified) return false;
      if (radarFilterStatus === "disqualified" && item.isQualified) return false;

      if (radarLevelFilter !== "all") {
        const adLevel = item.ad.merchant_level ?? (item.ad.is_verified ? "bronze" : "regular");
        if (adLevel !== radarLevelFilter) return false;
      }

      if (radarSearch.trim()) {
        const q = radarSearch.toLowerCase().trim();
        const matchName = item.ad.merchant_name.toLowerCase().includes(q);
        const matchPay = item.ad.pay_methods.some((p) => p.toLowerCase().includes(q));
        const matchPrice = String(item.ad.price).includes(q);
        const matchLevel = (item.ad.merchant_level || "").toLowerCase().includes(q);
        if (!matchName && !matchPay && !matchPrice && !matchLevel) return false;
      }
      return true;
    });
  }, [currentRadarAds, radarFilterStatus, radarLevelFilter, radarSearch]);

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
                <div className="text-[0.68rem] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                  <span>Harga Iklan Beli Anda</span>
                  {config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0 ? (
                    <Badge variant="outline" className="text-[0.58rem] py-0 px-1 border-bid/40 text-bid font-bold">
                      Override Manual
                    </Badge>
                  ) : null}
                </div>
                <div className="num text-2xl sm:text-3xl font-extrabold text-foreground">
                  {fmtRp2(recommendedBuyPrice)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[0.68rem] text-muted-foreground">Offset Strategi</div>
                <div className="text-xs font-bold text-bid num">
                  {config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0
                    ? "Harga Tetap"
                    : config.buyOffsetRp >= 0
                    ? `+Rp ${config.buyOffsetRp} ${config.buyOffsetRp === 0 ? "(Match)" : "(Overcut)"}`
                    : `-Rp ${Math.abs(config.buyOffsetRp)} (Undercut)`}
                </div>
              </div>
            </div>

            {/* Target Merchant Acuan yang Diikuti */}
            <div className="mt-3 rounded-lg border border-border/70 bg-surface-2/80 p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-medium text-[0.72rem]">Dasar Acuan:</span>
                <span className="font-bold text-foreground inline-flex items-center gap-1">
                  {config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0
                    ? `Manual Override (Rp ${config.manualBuyPriceOverrideRp.toLocaleString("id-ID")})`
                    : targetMethodDescription.buy}
                  {buyTargetMerchant?.is_verified && (
                    <span className="size-1.5 rounded-full bg-amber-400" title="Verified Merchant" />
                  )}
                </span>
              </div>

              {buyTargetMerchant && !config.manualBuyPriceOverrideRp && (
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

            {/* Status Guardrail Beli (Ceiling & Floor) */}
            <div className="mt-2.5 space-y-1 text-[0.7rem]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Batas Atas (Ceiling):</span>
                {buyGuard.triggered ? (
                  buyGuard.autoSwitched ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-sky-400" title={buyGuard.reason}>
                      <ArrowRight className="size-3" /> Mengikuti Iklan Lain (Rank #{buyRankUsed})
                    </span>
                  ) : buyGuard.ceilingPrice === recommendedBuyPrice ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-500" title={buyGuard.reason}>
                      <ShieldAlert className="size-3" /> Mentok Ceiling {fmtRp2(buyGuard.ceilingPrice)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ShieldCheck className="size-3 text-bid" /> Max {fmtRp2(buyGuard.ceilingPrice)} (Aman)
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <ShieldCheck className="size-3 text-bid" /> Max {fmtRp2(buyGuard.ceilingPrice)} (Aman)
                  </span>
                )}
              </div>
              {buyGuard.floorPrice && buyGuard.floorPrice > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Batas Bawah (Floor):</span>
                  {buyGuard.triggered && buyGuard.floorPrice === recommendedBuyPrice ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                      <ShieldAlert className="size-3" /> Terkunci Floor {fmtRp2(buyGuard.floorPrice)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ShieldCheck className="size-3 text-bid" /> Min {fmtRp2(buyGuard.floorPrice)} (Aman)
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            {/* Fitur Otomatis Pasang Stok Sesuai Sisa Saldo Bank */}
            <div className="mt-3 rounded-lg border border-bid/30 bg-bid/5 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <CreditCard className="size-3.5 text-bid" />
                  <span className="text-[0.72rem] font-bold text-foreground">
                    Pasang Stok dari Sisa Saldo Bank
                  </span>
                  <Badge
                    variant="outline"
                    className="h-4.5 px-1.5 text-[0.6rem] border-bid/30 text-bid bg-bid/10 font-semibold"
                  >
                    {config.bankBalanceSource === "auto" ? "Kas PnL (Auto)" : "Rekening (Manual)"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-[0.68rem] text-muted-foreground">
                  <span>Alokasi:</span>
                  <span className="font-bold text-foreground">{config.bankAllocationPct || 100}%</span>
                </div>
              </div>

              {/* Pantauan Live Stock USDT & Pengurangan Modal */}
              {bankAllocation.liveStockUsdt > 0 && (
                <div className="rounded-md border border-amber-500/35 bg-amber-500/10 p-2.5 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-500 flex items-center gap-1.5 text-[0.72rem]">
                      <Wallet className="size-3.5" /> Live Stock USDT Terpantau
                    </span>
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/20 text-amber-400 font-bold text-[0.62rem]">
                      {bankAllocation.liveStockUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[0.68rem] pt-0.5">
                    <div className="text-muted-foreground">
                      Nilai Terikat: <strong className="text-foreground">{fmtRp(bankAllocation.stockCapitalValuationIdr)}</strong>
                    </div>
                    <div className="text-right text-muted-foreground">
                      Total Modal: <strong className="text-foreground">{fmtRp(bankAllocation.totalBudgetIdr > 0 ? bankAllocation.totalBudgetIdr : (initialCapitalIdr || 180_000_000))}</strong>
                    </div>
                  </div>
                  <div className="text-[0.62rem] text-amber-600 dark:text-amber-400 border-t border-amber-500/20 pt-1 flex items-center justify-between">
                    <span>
                      {config.deductLiveStockFromBudget !== false
                        ? `✓ Modal beli otomatis dipotong Rp ${bankAllocation.stockCapitalValuationIdr.toLocaleString("id-ID")}`
                        : "✕ Pemotongan modal dari stok dinonaktifkan"}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateConfig({ deductLiveStockFromBudget: !config.deductLiveStockFromBudget })}
                      className="underline font-semibold hover:text-foreground text-[0.6rem]"
                    >
                      {config.deductLiveStockFromBudget !== false ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  </div>
                </div>
              )}

              {/* Alert jika modal terkunci di pesanan beli aktif */}
              {bankAllocation.lockedActiveBuyIdr > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/15 p-2 space-y-1 text-[0.7rem]">
                  <div className="flex items-center gap-1 text-amber-500 font-semibold">
                    <Clock className="size-3 shrink-0 animate-spin" />
                    <span>Pesanan Beli Aktif di Binance: -{bankAllocation.activeBuyOrdersUsdt} USDT (-{fmtRp(bankAllocation.lockedActiveBuyIdr)})</span>
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                    Kas modal otomatis dipotong sementara untuk orderan beli yang sedang berjalan di Binance P2P agar tidak membuat iklan beli berlebih.
                  </p>
                </div>
              )}

              {/* Alert jika seluruh modal terserap di stok */}
              {bankAllocation.usableBankIdr === 0 && bankAllocation.liveStockUsdt > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/15 p-2 space-y-1 text-[0.7rem]">
                  <div className="flex items-center gap-1 text-amber-500 font-semibold">
                    <AlertTriangle className="size-3 shrink-0" />
                    <span>Modal Beli Terserap di Stok USDT</span>
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                    Seluruh modal Anda ({fmtRp(bankAllocation.totalBudgetIdr)}) saat ini terikat di {bankAllocation.liveStockUsdt.toLocaleString("id-ID")} USDT. Jual stok via Iklan Jual (Maker Sell) sebelum menambah pembelian baru.
                  </p>
                </div>
              )}

              {/* Detail Sisa Saldo & Kalkulasi Stok */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-border/60 bg-surface-2/80 p-2 space-y-0.5">
                  <div className="text-[0.65rem] text-muted-foreground">Sisa Modal Siap Beli:</div>
                  <div className="num font-bold text-foreground truncate" title={fmtRp(bankAllocation.usableBankIdr)}>
                    {bankAllocation.usableBankIdr > 0
                      ? fmtRp(bankAllocation.usableBankIdr)
                      : "Rp 0"}
                  </div>
                  <div className="text-[0.6rem] text-muted-foreground truncate">
                    {bankAllocation.totalBudgetIdr > 0 ? `Dari modal ${fmtRp(bankAllocation.totalBudgetIdr)}` : `Dari modal Rp ${(initialCapitalIdr || 180_000_000).toLocaleString("id-ID")}`}
                  </div>
                </div>

                <div className="rounded-md border border-bid/40 bg-bid/10 p-2 space-y-0.5">
                  <div className="text-[0.65rem] text-bid font-medium">Stok Iklan Beli:</div>
                  <div className="num font-extrabold text-bid text-sm truncate">
                    {bankAllocation.autoBuyStockUsdt > 0
                      ? `${bankAllocation.autoBuyStockUsdt.toLocaleString("id-ID")} USDT`
                      : "0 USDT"}
                  </div>
                  <div className="text-[0.6rem] text-muted-foreground truncate">
                    Plafon Limit: {bankAllocation.autoBuyMaxLimitIdr > 0 ? fmtRp(bankAllocation.autoBuyMaxLimitIdr) : "—"}
                  </div>
                </div>
              </div>

              {/* Quick Input / Preset Saldo jika Saldo Rp 0 (Mode Manual) */}
              {config.bankBalanceSource === "manual" && bankAllocation.effectiveBankBalance === 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 space-y-1.5 text-[0.7rem]">
                  <div className="flex items-center gap-1 text-amber-500 font-semibold">
                    <Info className="size-3 shrink-0" />
                    <span>Saldo bank belum terisi. Pilih nominal sisa uang Anda:</span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap pt-0.5">
                    {[
                      { label: "5 Jt", val: 5_000_000 },
                      { label: "10 Jt", val: 10_000_000 },
                      { label: "25 Jt", val: 25_000_000 },
                      { label: "50 Jt", val: 50_000_000 },
                      { label: "100 Jt", val: 100_000_000 },
                    ].map((chip) => (
                      <button
                        key={chip.val}
                        type="button"
                        onClick={() =>
                          updateConfig({
                            bankBalanceSource: "manual",
                            manualBankBalanceIdr: chip.val,
                          })
                        }
                        className="rounded bg-surface px-1.5 py-0.5 text-[0.62rem] font-bold border border-amber-500/30 text-foreground hover:bg-amber-500/20 transition-colors"
                      >
                        +{chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick chips penyesuaian jika saldo sudah ada */}
              {bankAllocation.effectiveBankBalance > 0 && (
                <div className="flex items-center justify-between text-[0.65rem] text-muted-foreground pt-0.5">
                  <span>Quick Ganti Saldo:</span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {[
                      { label: "5 Jt", val: 5_000_000 },
                      { label: "10 Jt", val: 10_000_000 },
                      { label: "25 Jt", val: 25_000_000 },
                      { label: "50 Jt", val: 50_000_000 },
                    ].map((chip) => (
                      <button
                        key={chip.val}
                        type="button"
                        onClick={() =>
                          updateConfig({
                            bankBalanceSource: "manual",
                            manualBankBalanceIdr: chip.val,
                          })
                        }
                        className={`rounded px-1.5 py-0.5 text-[0.6rem] font-semibold transition-colors ${
                          config.bankBalanceSource === "manual" && config.manualBankBalanceIdr === chip.val
                            ? "bg-bid text-bid-foreground font-bold"
                            : "bg-surface-2 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {chip.label}
                      </button>
                    ))}
                    {bankBalanceIdr >= 0 && (
                      <button
                        type="button"
                        onClick={() => updateConfig({ bankBalanceSource: "auto" })}
                        className={`rounded px-1.5 py-0.5 text-[0.6rem] font-semibold transition-colors ${
                          config.bankBalanceSource === "auto"
                            ? "bg-primary text-primary-foreground font-bold"
                            : "bg-surface-2 text-muted-foreground hover:text-foreground"
                        }`}
                        title="Gunakan Saldo Kas Bebas PnL (Total Modal Rp 180 Juta)"
                      >
                        Auto Kas (180 Jt)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons: Terapkan ke Form Beli, Salin Rincian Iklan Beli, & Push API */}
              <div className="flex items-center gap-1.5 pt-1">
                <Button
                  size="sm"
                  type="button"
                  onClick={handleApplyBuyOnly}
                  className="flex-1 h-7 text-xs font-semibold bg-bid text-bid-foreground hover:bg-bid/90 gap-1.5 shadow-sm"
                >
                  <Zap className="size-3.5" />
                  <span>Terapkan ke Form Beli</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => handlePushPrice("buy")}
                  disabled={isPushingBuy}
                  className="h-7 text-xs px-2.5 border-bid/40 text-bid hover:bg-bid/10 gap-1 font-semibold"
                  title="Update harga & stok iklan langsung ke Binance C2C via API"
                >
                  <Send className={`size-3 ${isPushingBuy ? "animate-pulse" : ""}`} />
                  <span>{isPushingBuy ? "Kirim..." : "Push API"}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={handleCopyBuyDetails}
                  className="h-7 text-xs px-2.5 border-border/80 text-muted-foreground hover:text-foreground hover:bg-surface-2"
                  title="Salin Harga Beli, Stok USDT, dan Plafon Limit IDR"
                >
                  <Copy className="size-3 mr-1" />
                  <span>Salin</span>
                </Button>
              </div>
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
                <div className="flex items-center gap-1.5">
                  <div className="text-[0.68rem] text-muted-foreground font-medium uppercase tracking-wider">
                    Harga Iklan Jual Anda
                  </div>
                  {config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0 ? (
                    <Badge variant="outline" className="text-[0.58rem] py-0 px-1 border-ask/40 text-ask font-bold">
                      Override Manual
                    </Badge>
                  ) : null}
                </div>
                <div className="num text-2xl sm:text-3xl font-extrabold text-foreground">
                  {fmtRp2(recommendedSellPrice)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[0.68rem] text-muted-foreground">Offset Strategi</div>
                <div className="text-xs font-bold text-ask num">
                  {config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0
                    ? "Harga Tetap"
                    : config.sellOffsetRp <= 0
                    ? `-Rp ${Math.abs(config.sellOffsetRp)} ${config.sellOffsetRp === 0 ? "(Match)" : "(Undercut)"}`
                    : `+Rp ${config.sellOffsetRp} (Markup)`}
                </div>
              </div>
            </div>

            {/* Target Merchant Acuan yang Diikuti */}
            <div className="mt-3 rounded-lg border border-border/70 bg-surface-2/80 p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-medium text-[0.72rem]">Dasar Acuan:</span>
                <span className="font-bold text-foreground inline-flex items-center gap-1">
                  {config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0
                    ? `Manual Override (Rp ${config.manualSellPriceOverrideRp.toLocaleString("id-ID")})`
                    : targetMethodDescription.sell}
                  {sellTargetMerchant?.is_verified && (
                    <span className="size-1.5 rounded-full bg-amber-400" title="Verified Merchant" />
                  )}
                </span>
              </div>

              {sellTargetMerchant && !config.manualSellPriceOverrideRp && (
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
                sellGuard.autoSwitched ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-sky-400" title={sellGuard.reason}>
                    <ArrowRight className="size-3" /> Mengikuti Iklan Lain (Rank #{sellRankUsed})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-500" title={sellGuard.reason}>
                    <ShieldAlert className="size-3" /> Terkunci Floor {fmtRp2(sellGuard.floorPrice)} (Anti-Rugi)
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <ShieldCheck className="size-3 text-ask" /> Min {fmtRp2(sellGuard.floorPrice)} (Aman)
                </span>
              )}
            </div>

            {/* Fitur Otomatis Pasang Stok Jual dari Saldo Live */}
            <div className="mt-3 rounded-lg border border-ask/30 bg-ask/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Wallet className="size-3.5 text-ask" />
                  <span className="text-[0.72rem] font-bold text-foreground">
                    Max Available Stok Siap Jual
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className="h-4.5 px-1.5 text-[0.6rem] border-ask/30 text-ask bg-ask/10 font-bold"
                >
                  {maxAvailableSellStockUsdt > 0
                    ? `${maxAvailableSellStockUsdt.toLocaleString("id-ID")} USDT (Max All)`
                    : "0 USDT"}
                </Badge>
              </div>

              <div className="flex items-center justify-between text-[0.65rem] text-muted-foreground">
                <span>Saldo Funding: {liveStockUsdt.toLocaleString("id-ID")} USDT</span>
                <span>Reserved Fee Binance: ~{reservedFeeSellUsdt} USDT</span>
              </div>

              <div className="flex items-center justify-between text-[0.68rem] text-muted-foreground">
                <span>Plafon Kapasitas Penjualan:</span>
                <strong className="num text-foreground">
                  {maxAvailableSellStockUsdt > 0 && recommendedSellPrice > 0
                    ? fmtRp(Math.floor(maxAvailableSellStockUsdt * recommendedSellPrice))
                    : "—"}
                </strong>
              </div>

              {/* Action Buttons: Terapkan ke Form Jual, Push API, & Salin */}
              <div className="flex items-center gap-1.5 pt-1">
                <Button
                  size="sm"
                  type="button"
                  onClick={handleApplySellOnly}
                  className="flex-1 h-7 text-xs font-semibold bg-ask text-ask-foreground hover:bg-ask/90 gap-1.5 shadow-sm"
                >
                  <Zap className="size-3.5" />
                  <span>Terapkan ke Form Jual</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => handlePushPrice("sell")}
                  disabled={isPushingSell}
                  className="h-7 text-xs px-2.5 border-ask/40 text-ask hover:bg-ask/10 gap-1 font-semibold"
                  title="Update harga & all stok iklan langsung ke Binance C2C via API"
                >
                  <Send className={`size-3 ${isPushingSell ? "animate-pulse" : ""}`} />
                  <span>{isPushingSell ? "Kirim..." : "Push API"}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={handleCopySellDetails}
                  className="h-7 text-xs px-2.5 border-border/80 text-muted-foreground hover:text-foreground hover:bg-surface-2"
                  title="Salin Harga Jual, Stok USDT, dan Plafon Limit IDR"
                >
                  <Copy className="size-3 mr-1" />
                  <span>Salin</span>
                </Button>
              </div>
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
              <div className="flex items-center gap-2 flex-wrap">
                <Radio className="size-4 text-primary animate-pulse" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Radar Pasar: Analisis Kelayakan Kompetitor ({currentRadarAds.length} User Teratas)
                </h4>
                <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-emerald-500/30 text-emerald-400 bg-emerald-500/10 gap-1 font-semibold">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Binance P2P
                </Badge>
                {onRefresh && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-surface-2"
                    title="Segarkan data live Binance sekarang"
                  >
                    <RefreshCw className={`size-3 ${isRefreshing ? "animate-spin text-primary" : ""}`} />
                  </Button>
                )}
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

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground text-[0.7rem]">Status:</span>
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

                <div className="flex items-center gap-1 border-l border-border/60 pl-2">
                  <span className="text-muted-foreground text-[0.7rem]">Level:</span>
                  {[
                    { id: "all" as const, label: "Semua Tier" },
                    { id: "gold" as const, label: "🥇 Gold" },
                    { id: "silver" as const, label: "🥈 Silver" },
                    { id: "bronze" as const, label: "🥉 Bronze" },
                    { id: "regular" as const, label: "👤 User" },
                  ].map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setRadarLevelFilter(tier.id)}
                      className={`rounded px-1.5 py-0.5 text-[0.65rem] font-semibold transition-colors ${
                        radarLevelFilter === tier.id
                          ? "bg-primary text-primary-foreground font-bold shadow-xs"
                          : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                      }`}
                    >
                      {tier.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 border-l border-border/60 pl-2">
                  <span className="text-muted-foreground text-[0.7rem]">Scan:</span>
                  {[
                    { val: 20, label: "20 User" },
                    { val: 50, label: "50 User" },
                    { val: 100, label: "100 User" },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => updateConfig({ scanAdLimit: opt.val })}
                      className={`rounded px-1.5 py-0.5 text-[0.65rem] font-semibold transition-colors ${
                        (config.scanAdLimit ?? 100) === opt.val
                          ? "bg-primary text-primary-foreground font-bold shadow-xs"
                          : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                      }`}
                      title={`Ambil hingga ${opt.val} user/iklan dari Binance orderbook`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Ringkasan Alasan Diskualifikasi */}
            {Object.keys(disqualificationStats).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[0.68rem]">
                <span className="text-muted-foreground font-medium">Alasan Eliminasi:</span>
                {disqualificationStats.MERCHANT_LEVEL_FILTERED && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-amber-500/40 text-amber-500 bg-amber-500/10 font-semibold">
                    Level Terfilter ({disqualificationStats.MERCHANT_LEVEL_FILTERED})
                  </Badge>
                )}
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
                {disqualificationStats.MAX_LIMIT_TOO_LOW && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-amber-500/30 text-amber-400">
                    Kapasitas &lt; Min ({disqualificationStats.MAX_LIMIT_TOO_LOW})
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
                    <th className="p-2 text-right">Batas Limit Transaksi (Live)</th>
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
                              {item.ad.merchant_level === "gold" && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 border border-amber-500/50 px-1 py-0.2 text-[0.6rem] font-bold text-amber-300 shadow-xs" title="Gold Merchant (VIP 3 / Volume > 60 BTC)">
                                  🥇 Gold
                                </span>
                              )}
                              {item.ad.merchant_level === "silver" && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-slate-400/20 border border-slate-300/50 px-1 py-0.2 text-[0.6rem] font-bold text-slate-200" title="Silver Merchant (VIP 2 / Volume > 6 BTC)">
                                  🥈 Silver
                                </span>
                              )}
                              {item.ad.merchant_level === "bronze" && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-amber-800/20 border border-amber-700/50 px-1 py-0.2 text-[0.6rem] font-bold text-amber-500" title="Bronze Merchant (VIP 1 / Verified Merchant)">
                                  🥉 Bronze
                                </span>
                              )}
                              {item.ad.merchant_level === "regular" && !item.ad.is_verified && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-surface-2 border border-border px-1 py-0.2 text-[0.58rem] font-medium text-muted-foreground" title="Regular User (Non-Merchant)">
                                  👤 User
                                </span>
                              )}
                              {item.ad.is_pro && (
                                <span className="rounded bg-primary/20 border border-primary/40 px-1 py-0.2 text-[0.55rem] font-bold tracking-wider text-primary uppercase">
                                  PRO
                                </span>
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
                          <td className="p-2 text-right num text-[0.7rem]">
                            <div className="font-semibold text-foreground">
                              {fmtRp(item.ad.min_limit_idr)}
                            </div>
                            {item.ad.max_limit_idr > 0 && (
                              <div className="text-[0.65rem] text-muted-foreground">
                                s/d {fmtRp(item.ad.max_limit_idr)}
                              </div>
                            )}
                            {item.ad.raw_max_limit_idr && item.ad.raw_max_limit_idr > item.ad.max_limit_idr && (
                              <div
                                className="text-[0.58rem] text-muted-foreground/60 italic"
                                title={`Plafon konfigurasi merchant: ${fmtRp(item.ad.raw_max_limit_idr)} (dibatasi sisa kuota/stok live)`}
                              >
                                Plafon: {fmtRp(item.ad.raw_max_limit_idr)}
                              </div>
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
                <TabsTrigger value="c2c_api" className="text-xs px-2.5 h-6 font-semibold border-primary/30 text-primary">
                  🔌 C2C Merchant API {config.autoPushToBinance ? "(Auto)" : ""}
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

                {/* Min Max Limit IDR (Min Transaksi yang bisa dilayani) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-semibold text-foreground">
                        Min Transaksi
                      </Label>
                      <p className="text-[0.65rem] text-muted-foreground">
                        Kapasitas merchant harus sanggup melayani minimal nominal ini
                      </p>
                    </div>
                    <span className="num text-xs font-bold text-primary">
                      {config.minMaxLimitIdr === 0 ? "Bebas (0)" : `≥ ${fmtRp(config.minMaxLimitIdr)}`}
                    </span>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={5000000}
                    value={config.minMaxLimitIdr}
                    onChange={(e) => updateConfig({ minMaxLimitIdr: Math.max(0, Number(e.target.value)) })}
                    className="h-8 text-xs bg-surface-2 font-semibold"
                    placeholder="0 = Bebas (Nonaktif)"
                  />
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    {[
                      { label: "Bebas (0)", val: 0 },
                      { label: "5 Jt", val: 5_000_000 },
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
                    Otomatis mengabaikan merchant dengan kapasitas maksimal di bawah nominal ini (hanya ikuti lawan yang mampu memenuhi target pesanan Anda).
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

              {/* Filter Level Merchant (Gold, Silver, Bronze, Regular) */}
              <div className="rounded-lg border border-border/70 bg-surface-2/40 p-3 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        Filter Level Merchant (Tier)
                      </Label>
                      <span className="text-[0.65rem] text-primary font-medium">
                        ({(config.allowedMerchantLevels ?? ["gold", "silver", "bronze", "regular"]).length} dari 4 aktif)
                      </span>
                    </div>
                    <p className="text-[0.68rem] text-muted-foreground">
                      Pilih level merchant yang diperbolehkan menjadi acuan bot. Iklan dari level yang dimatikan akan otomatis diabaikan.
                    </p>
                  </div>

                  {/* Preset Cepat */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[0.65rem] text-muted-foreground mr-1">Preset:</span>
                    <button
                      type="button"
                      onClick={() => updateConfig({ allowedMerchantLevels: ["gold", "silver", "bronze", "regular"] })}
                      className="rounded border border-border/60 bg-surface-2 px-1.5 py-0.5 text-[0.62rem] font-semibold text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
                    >
                      Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => updateConfig({ allowedMerchantLevels: ["gold", "silver", "bronze"] })}
                      className="rounded border border-border/60 bg-surface-2 px-1.5 py-0.5 text-[0.62rem] font-semibold text-amber-500 hover:bg-surface-3 transition-colors"
                    >
                      Merchant Saja
                    </button>
                    <button
                      type="button"
                      onClick={() => updateConfig({ allowedMerchantLevels: ["gold", "silver"] })}
                      className="rounded border border-border/60 bg-surface-2 px-1.5 py-0.5 text-[0.62rem] font-semibold text-primary hover:bg-surface-3 transition-colors"
                    >
                      Gold & Silver
                    </button>
                    <button
                      type="button"
                      onClick={() => updateConfig({ allowedMerchantLevels: ["gold"] })}
                      className="rounded border border-border/60 bg-surface-2 px-1.5 py-0.5 text-[0.62rem] font-semibold text-amber-400 hover:bg-surface-3 transition-colors"
                    >
                      Gold Saja
                    </button>
                  </div>
                </div>

                {/* Grid 4 Level Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    {
                      id: "gold" as const,
                      name: "Gold Merchant",
                      badge: "🥇 Gold",
                      desc: "VIP 3 / Vol >60 BTC / 98%+",
                      activeBorder: "border-amber-500 bg-amber-500/15",
                    },
                    {
                      id: "silver" as const,
                      name: "Silver Merchant",
                      badge: "🥈 Silver",
                      desc: "VIP 2 / Vol >6 BTC / 98%+",
                      activeBorder: "border-slate-300 bg-slate-300/15",
                    },
                    {
                      id: "bronze" as const,
                      name: "Bronze Merchant",
                      badge: "🥉 Bronze",
                      desc: "VIP 1 / Verified Merchant",
                      activeBorder: "border-amber-600 bg-amber-600/15",
                    },
                    {
                      id: "regular" as const,
                      name: "Regular User",
                      badge: "👤 Regular",
                      desc: "Retail / User tanpa badge",
                      activeBorder: "border-foreground/50 bg-surface-3",
                    },
                  ].map((tier) => {
                    const currentLevels = config.allowedMerchantLevels ?? ["gold", "silver", "bronze", "regular"];
                    const isSelected = currentLevels.includes(tier.id);
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => {
                          let nextLevels: ("gold" | "silver" | "bronze" | "regular")[];
                          if (isSelected) {
                            if (currentLevels.length === 1) return;
                            nextLevels = currentLevels.filter((lvl) => lvl !== tier.id);
                          } else {
                            nextLevels = [...currentLevels, tier.id];
                          }
                          updateConfig({ allowedMerchantLevels: nextLevels });
                        }}
                        className={`flex flex-col text-left p-2 rounded-md border transition-all ${
                          isSelected
                            ? `${tier.activeBorder} ring-1 ring-primary/40`
                            : "border-border/50 bg-surface-1/50 opacity-50 hover:opacity-80"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <span className="font-semibold text-xs text-foreground flex items-center gap-1">
                            {tier.badge}
                          </span>
                          <span
                            className={`size-3 rounded-full border flex items-center justify-center text-[0.55rem] ${
                              isSelected
                                ? "bg-primary border-primary text-primary-foreground font-bold"
                                : "border-border bg-surface-2"
                            }`}
                          >
                            {isSelected ? "✓" : ""}
                          </span>
                        </div>
                        <span className="text-[0.65rem] text-muted-foreground font-medium leading-tight">
                          {tier.name}
                        </span>
                        <span className="text-[0.58rem] text-muted-foreground/80 mt-0.5">
                          {tier.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Kedalaman Scan Orderbook / Limit Jumlah User */}
              <div className="rounded-lg border border-border/70 bg-surface-2/40 p-3 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        Kedalaman Scan Orderbook (Batas User/Iklan yang Dianalisis)
                      </Label>
                      <Badge variant="outline" className="h-4.5 px-1.5 text-[0.62rem] border-primary/40 text-primary bg-primary/10 font-bold">
                        {config.scanAdLimit ?? 100} User / Iklan
                      </Badge>
                    </div>
                    <p className="text-[0.68rem] text-muted-foreground">
                      Tentukan berapa banyak iklan/user teratas dari pasar Binance P2P yang ditarik untuk difilter (20, 50, atau hingga 100 user).
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    {[
                      { val: 20, label: "20 User" },
                      { val: 50, label: "50 User" },
                      { val: 100, label: "100 User (Maksimal)" },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => updateConfig({ scanAdLimit: opt.val })}
                        className={`rounded border px-2 py-1 text-[0.65rem] font-semibold transition-colors ${
                          (config.scanAdLimit ?? 100) === opt.val
                            ? "border-primary bg-primary text-primary-foreground shadow-xs font-bold"
                            : "border-border/60 bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
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

            {/* TAB METODE PEMBAYARAN & SALDO BANK */}
            <TabsContent value="payment" className="mt-3.5 space-y-3.5">
              {/* Fitur Auto-Sync Stok Beli dengan Saldo Bank */}
              <div className="rounded-xl border border-border/80 bg-surface-2/60 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <CreditCard className="size-4 text-primary" />
                      <h4 className="text-xs font-bold text-foreground">
                        Otomatisasi Pasang Stok Beli Sesuai Sisa Uang Bank
                      </h4>
                      <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-bid/30 text-bid bg-bid/10 font-semibold">
                        Auto-Limit IDR
                      </Badge>
                    </div>
                    <p className="text-[0.68rem] text-muted-foreground">
                      Bot otomatis menghitung jumlah USDT yang mau dibeli (<span className="text-foreground font-semibold">Sisa Uang Bank &divide; Harga Rekomendasi Beli</span>) dan membatasi plafon batas maksimal transaksi agar order masuk tidak melebihi uang di rekening.
                    </p>
                  </div>
                  <Switch
                    checked={config.autoSyncBuyStockWithBank}
                    onCheckedChange={(val) => updateConfig({ autoSyncBuyStockWithBank: val })}
                    className="scale-90 data-[state=checked]:bg-bid"
                  />
                </div>

                {config.autoSyncBuyStockWithBank && (
                  <div className="space-y-3 pt-1">
                    {/* Pemilihan Sumber Saldo Bank: Auto (PnL) vs Manual */}
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div
                        onClick={() => updateConfig({ bankBalanceSource: "auto" })}
                        className={`cursor-pointer rounded-lg border p-2.5 space-y-1 transition-all ${
                          config.bankBalanceSource === "auto"
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border/60 bg-surface/80 hover:bg-surface"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <Zap className="size-3 text-primary" /> Otomatis (Kas Bebas PnL)
                          </span>
                          {config.bankBalanceSource === "auto" && <Check className="size-3.5 text-primary" />}
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="num text-base sm:text-lg font-extrabold text-primary">
                            Rp 180.000.000
                          </div>
                          <Badge variant="outline" className="border-primary/40 bg-primary/20 text-primary text-[0.62rem] font-bold">
                            Total Value
                          </Badge>
                        </div>
                        <div className="rounded bg-surface-2/60 p-2 text-[0.68rem] space-y-1 border border-border/40">
                          <div className="flex items-center justify-between text-muted-foreground">
                            <span>Modal Sisa Stok ({liveStockUsdt > 0 ? `${liveStockUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT` : "0 USDT"}):</span>
                            <span className="font-semibold text-amber-500">
                              -{fmtRp(stockCapitalIdr || bankAllocation.stockCapitalValuationIdr)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between font-bold text-foreground pt-1 border-t border-border/40">
                            <span>Sisa Kas Siap Beli:</span>
                            <span className="text-bid font-extrabold">
                              {fmtRp(bankAllocation.usableBankIdr)}
                            </span>
                          </div>
                        </div>
                        <p className="text-[0.62rem] text-muted-foreground leading-tight">
                          Total modal Rp 180.000.000 otomatis dipotong modal terikat sisa stok USDT yang sedang berjalan.
                        </p>
                      </div>

                      <div
                        onClick={() => updateConfig({ bankBalanceSource: "manual" })}
                        className={`cursor-pointer rounded-lg border p-2.5 space-y-1 transition-all ${
                          config.bankBalanceSource === "manual"
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border/60 bg-surface/80 hover:bg-surface"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <CreditCard className="size-3 text-primary" /> Input Manual Saldo Bank
                          </span>
                          {config.bankBalanceSource === "manual" && <Check className="size-3.5 text-primary" />}
                        </div>
                        <div className="num text-sm font-extrabold text-foreground">
                          {config.manualBankBalanceIdr > 0 ? fmtRp(config.manualBankBalanceIdr) : "Rp 0"}
                        </div>
                        <p className="text-[0.65rem] text-muted-foreground leading-tight">
                          Masukkan nominal saldo rekening fisik Anda secara langsung jika berbeda dari pembukuan PnL.
                        </p>
                      </div>
                    </div>

                    {/* Breakdown Perhitungan Otomatis Kas Bebas PnL */}
                    {config.bankBalanceSource === "auto" && (
                      <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
                        <div className="flex items-center justify-between text-muted-foreground text-[0.7rem]">
                          <span className="font-semibold text-foreground flex items-center gap-1">
                            <Coins className="size-3 text-primary" /> Perhitungan Kas Bebas PnL:
                          </span>
                          <span className="font-bold text-primary">
                            Total Modal: Rp {(initialCapitalIdr || 180_000_000).toLocaleString("id-ID")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between font-medium text-[0.7rem] text-muted-foreground">
                          <span>
                            - Modal Terikat di Sisa Stok ({liveStockUsdt > 0 ? `${liveStockUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT` : "0 USDT"}):
                          </span>
                          <span className="text-amber-500 font-bold">
                            -{fmtRp(stockCapitalIdr || bankAllocation.stockCapitalValuationIdr)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between border-t border-primary/20 pt-1 font-bold text-xs text-foreground">
                          <span>= Sisa Kas Bebas Siap Beli:</span>
                          <span className="text-bid font-extrabold">{fmtRp(bankBalanceIdr)}</span>
                        </div>
                      </div>
                    )}

                    {/* Input Nominal Saldo Manual & Quick Chips jika mode manual */}
                    {config.bankBalanceSource === "manual" && (
                      <div className="space-y-1.5 rounded-lg border border-border/70 bg-surface p-2.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-foreground">
                            Nominal Saldo Rekening Bank (IDR)
                          </Label>
                          <span className="num text-xs font-bold text-primary">
                            {fmtRp(config.manualBankBalanceIdr || 0)}
                          </span>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step={1000000}
                          value={config.manualBankBalanceIdr || ""}
                          onChange={(e) =>
                            updateConfig({
                              manualBankBalanceIdr: Math.max(0, Number(e.target.value)),
                              bankBalanceSource: "manual",
                            })
                          }
                          className="h-8 text-xs bg-surface-2 font-semibold"
                          placeholder="Masukkan sisa uang di rekening bank, misal: 25000000"
                        />
                        <div className="flex items-center gap-1 pt-1 flex-wrap">
                          {[
                            { label: "5 Jt", val: 5_000_000 },
                            { label: "10 Jt", val: 10_000_000 },
                            { label: "25 Jt", val: 25_000_000 },
                            { label: "50 Jt", val: 50_000_000 },
                            { label: "100 Jt", val: 100_000_000 },
                          ].map((item) => (
                            <button
                              key={item.val}
                              type="button"
                              onClick={() =>
                                updateConfig({
                                  manualBankBalanceIdr: item.val,
                                  bankBalanceSource: "manual",
                                })
                              }
                              className={`rounded px-2 py-0.5 text-[0.65rem] font-semibold transition-colors ${
                                config.manualBankBalanceIdr === item.val
                                  ? "bg-primary text-primary-foreground font-bold"
                                  : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Alokasi Persentase & Buffer Cadangan */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5 rounded-lg border border-border/70 bg-surface p-2.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-foreground">
                            Persentase Alokasi Beli
                          </Label>
                          <span className="num text-xs font-bold text-bid">
                            {config.bankAllocationPct || 100}%
                          </span>
                        </div>
                        <Slider
                          value={[config.bankAllocationPct || 100]}
                          min={10}
                          max={100}
                          step={5}
                          onValueChange={(val) => updateConfig({ bankAllocationPct: val[0] })}
                          className="py-1"
                        />
                        <div className="flex items-center justify-between text-[0.62rem] text-muted-foreground pt-0.5">
                          {[25, 50, 75, 100].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => updateConfig({ bankAllocationPct: pct })}
                              className={`rounded px-1.5 py-0.5 ${
                                (config.bankAllocationPct || 100) === pct
                                  ? "bg-bid text-bid-foreground font-bold"
                                  : "hover:text-foreground"
                              }`}
                            >
                              {pct}%
                            </button>
                          ))}
                        </div>
                        <p className="text-[0.62rem] text-muted-foreground">
                          Gunakan 100% untuk pasang stok maksimal sesuai seluruh uang di bank.
                        </p>
                      </div>

                      <div className="space-y-1.5 rounded-lg border border-border/70 bg-surface p-2.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-foreground">
                            Cadangan Saldo Mengendap (Buffer)
                          </Label>
                          <span className="num text-xs font-bold text-primary">
                            {config.bankReserveBufferIdr ? fmtRp(config.bankReserveBufferIdr) : "Rp 0"}
                          </span>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step={200000}
                          value={config.bankReserveBufferIdr || ""}
                          onChange={(e) =>
                            updateConfig({
                              bankReserveBufferIdr: Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="h-8 text-xs bg-surface-2 font-semibold"
                          placeholder="0 (Habiskan semua)"
                        />
                        <div className="flex items-center gap-1 pt-1 flex-wrap">
                          {[
                            { label: "0 (Semua)", val: 0 },
                            { label: "250 Rb", val: 250_000 },
                            { label: "500 Rb", val: 500_000 },
                            { label: "1 Jt", val: 1_000_000 },
                          ].map((item) => (
                            <button
                              key={item.val}
                              type="button"
                              onClick={() => updateConfig({ bankReserveBufferIdr: item.val })}
                              className={`rounded px-1.5 py-0.5 text-[0.62rem] font-semibold transition-colors ${
                                (config.bankReserveBufferIdr || 0) === item.val
                                  ? "bg-primary text-primary-foreground font-bold"
                                  : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-[0.62rem] text-muted-foreground">
                          Uang minimal yang disisakan di rekening dan tidak dipakai pasang stok beli.
                        </p>
                      </div>
                    </div>

                    {/* Pemotongan Modal dari Live Stok USDT */}
                    <div className="rounded-lg border border-border/70 bg-surface p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Wallet className="size-3.5 text-amber-500" />
                            Otomatis Kurangi Modal dengan Live Stok USDT
                          </Label>
                          <p className="text-[0.65rem] text-muted-foreground">
                            Memotong alokasi uang kas beli jika di akun Anda sudah ada stok USDT berjalan (Funding Wallet / PnL).
                          </p>
                        </div>
                        <Switch
                          checked={config.deductLiveStockFromBudget !== false}
                          onCheckedChange={(val) => updateConfig({ deductLiveStockFromBudget: val })}
                          className="scale-90 data-[state=checked]:bg-bid"
                        />
                      </div>

                      {/* Info Live Stok Terpantau */}
                      <div className="rounded-md border border-border/60 bg-surface-2/80 p-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-[0.65rem] text-muted-foreground">Live Stok USDT:</div>
                          <div className="num font-bold text-foreground">
                            {bankAllocation.liveStockUsdt.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT
                          </div>
                        </div>
                        <div>
                          <div className="text-[0.65rem] text-muted-foreground">Nilai Modal Terikat:</div>
                          <div className="num font-bold text-amber-500">
                            {fmtRp(bankAllocation.stockCapitalValuationIdr)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[0.65rem] text-muted-foreground">Status Pemotongan:</div>
                          <div className="font-semibold text-[0.7rem] text-foreground">
                            {config.deductLiveStockFromBudget !== false && bankAllocation.stockCapitalValuationIdr > 0 ? (
                              <span className="text-bid flex items-center gap-1">
                                <CheckCircle2 className="size-3" /> Memotong Kas Beli
                              </span>
                            ) : bankAllocation.liveStockUsdt === 0 ? (
                              <span className="text-muted-foreground">Stok Kosong (0 USDT)</span>
                            ) : (
                              <span className="text-muted-foreground">Non-Aktif</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Kotak Ringkasan Hasil Kalkulasi Stok */}
                    <div className="rounded-lg border border-bid/40 bg-bid/10 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground">Hasil Kalkulasi Stok Beli Otomatis:</span>
                        <Badge variant="outline" className="border-bid/40 bg-bid/20 text-bid font-bold text-[0.65rem]">
                          Live Sync
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                        <div className="rounded bg-surface/80 p-2 border border-border/50">
                          <div className="text-[0.65rem] text-muted-foreground">Sisa Uang Siap Beli:</div>
                          <div className="num font-bold text-foreground">{fmtRp(bankAllocation.usableBankIdr)}</div>
                        </div>
                        <div className="rounded bg-surface/80 p-2 border border-border/50">
                          <div className="text-[0.65rem] text-bid font-semibold">Target Pasang Stok USDT:</div>
                          <div className="num font-extrabold text-bid text-sm">{bankAllocation.autoBuyStockUsdt.toLocaleString("id-ID")} USDT</div>
                        </div>
                        <div className="rounded bg-surface/80 p-2 border border-border/50">
                          <div className="text-[0.65rem] text-muted-foreground">Plafon Max Limit Pesanan:</div>
                          <div className="num font-bold text-foreground">{fmtRp(bankAllocation.autoBuyMaxLimitIdr)}</div>
                        </div>
                      </div>
                      {bankAllocation.lockedActiveBuyIdr > 0 && (
                        <div className="flex items-center justify-between text-[0.68rem] bg-amber-500/15 border border-amber-500/30 text-amber-500 px-2.5 py-1 rounded">
                          <span className="flex items-center gap-1 font-semibold">
                            <Clock className="size-3 shrink-0 animate-spin" /> Terkunci Pesanan Beli Aktif:
                          </span>
                          <strong className="font-mono">
                            -{bankAllocation.activeBuyOrdersUsdt} USDT (-{fmtRp(bankAllocation.lockedActiveBuyIdr)})
                          </strong>
                        </div>
                      )}
                      <p className="text-[0.65rem] text-muted-foreground pt-0.5">
                        Formula: {fmtRp(bankAllocation.usableBankIdr)} &divide; {fmtRp2(recommendedBuyPrice)} = <strong className="text-foreground">{bankAllocation.autoBuyStockUsdt} USDT</strong>
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
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
                      onClick={() => updateConfig({ sellFloorMode: "auto_hpp", manualSellFloorRp: 0 })}
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
                      onClick={() => updateConfig({ buyCeilingMode: "auto_fair", manualBuyCeilingRp: 0 })}
                      className="h-7 text-xs font-semibold"
                    >
                      Auto dari Harga Jual - Min Spread
                    </Button>
                    <Button
                      type="button"
                      variant={config.buyCeilingMode === "manual" ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        updateConfig({
                          buyCeilingMode: "manual",
                          manualBuyCeilingRp: config.manualBuyCeilingRp || buyGuard.ceilingPrice || 17825,
                        })
                      }
                      className="h-7 text-xs font-semibold"
                    >
                      Nominal Manual
                    </Button>
                  </div>

                  {config.buyCeilingMode === "manual" ? (
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
                  ) : (
                    <div className="flex items-center justify-between pt-1 text-[0.68rem] text-muted-foreground">
                      <span>Formula Ceiling Auto:</span>
                      <strong className="num text-bid font-bold">
                        {fmtRp2(pricingResult.recommendedSellPrice)} - Rp {config.minSpreadRp} = {fmtRp2(buyGuard.ceilingPrice)}
                      </strong>
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

                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-foreground">Auto-Follow Iklan Lain Saat Batas Tercapai:</span>
                      <span className="text-[0.65rem] text-muted-foreground">
                        Jika target melampaui limit atas/bawah, bot otomatis beralih mengikuti iklan lain di dalam batas aman.
                      </span>
                    </div>
                    <Switch
                      checked={config.autoFollowNextWhenLimitReached !== false}
                      onCheckedChange={(v) => updateConfig({ autoFollowNextWhenLimitReached: v })}
                    />
                  </div>
                </div>

                {/* Batas Bawah Beli (Buy Floor Guard) */}
                <div className="rounded-lg border border-bid/30 bg-surface-2/60 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-bid uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5" /> Proteksi Batas Bawah Beli (Buy Floor)
                    </span>
                    <span className="num font-bold text-bid">
                      {config.manualBuyFloorRp && config.manualBuyFloorRp > 0
                        ? fmtRp2(config.manualBuyFloorRp)
                        : "Bebas (Tanpa Floor)"}
                    </span>
                  </div>

                  <p className="text-[0.72rem] text-muted-foreground">
                    Mencegah bot memasang harga beli di bawah ambang batas ini (misal mencegah tawar terlalu murah jika kompetitor dump harga).
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      type="button"
                      variant={!config.manualBuyFloorRp ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ buyFloorMode: "disabled", manualBuyFloorRp: 0 })}
                      className="h-7 text-xs font-semibold"
                    >
                      Bebas (Tanpa Floor)
                    </Button>
                    <Button
                      type="button"
                      variant={config.manualBuyFloorRp && config.manualBuyFloorRp > 0 ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateConfig({ buyFloorMode: "manual", manualBuyFloorRp: config.manualBuyFloorRp || 17_500 })}
                      className="h-7 text-xs font-semibold"
                    >
                      Nominal Manual (Floor)
                    </Button>
                  </div>

                  {Boolean(config.manualBuyFloorRp && config.manualBuyFloorRp > 0) && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-muted-foreground">Nominal Floor Beli Tetap:</span>
                      <Input
                        type="number"
                        min={0}
                        value={config.manualBuyFloorRp}
                        onChange={(e) => updateConfig({ manualBuyFloorRp: Math.max(0, Number(e.target.value)) })}
                        className="h-6.5 w-28 text-xs bg-surface text-right font-bold"
                      />
                    </div>
                  )}
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

            {/* TAB INTEGRASI KHUSUS C2C MERCHANT API BINANCE */}
            <TabsContent value="c2c_api" className="mt-3.5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Terminal className="size-4 text-primary" />
                    <h4 className="text-xs font-bold text-foreground">
                      Integrasi Khusus Binance C2C Merchant Open API
                    </h4>
                    <Badge variant="outline" className="h-5 px-1.5 text-[0.62rem] border-primary/40 text-primary bg-primary/10 font-bold">
                      Direct SAPI
                    </Badge>
                  </div>
                  <p className="text-[0.7rem] text-muted-foreground pt-0.5">
                    Hubungkan nomor iklan Binance P2P Anda (<span className="text-foreground font-semibold">advNo</span>) agar bot dapat langsung mengubah harga, stok USDT, dan batas limit pesanan secara real-time via API resmi Binance.
                  </p>
                </div>
              </div>

              {/* Status Autentikasi & Syarat Akses */}
              <div className="rounded-xl border border-border/80 bg-surface-2/60 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Key className="size-4 text-amber-500" />
                    <span className="text-xs font-bold text-foreground">Status Kredensial Binance API</span>
                  </div>
                  <Badge variant="outline" className="border-border text-foreground text-[0.65rem] font-semibold">
                    HMAC-SHA256 (USER_DATA)
                  </Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded bg-surface p-2 border border-border/50">
                    <div className="text-[0.65rem] text-muted-foreground">Endpoint Target:</div>
                    <div className="font-mono text-[0.7rem] text-foreground font-semibold truncate">/sapi/v1/c2c/ads/update</div>
                  </div>
                  <div className="rounded bg-surface p-2 border border-border/50">
                    <div className="text-[0.65rem] text-muted-foreground">Kebutuhan Akun:</div>
                    <div className="text-[0.7rem] font-semibold text-amber-500">P2P Verified Merchant</div>
                  </div>
                  <div className="rounded bg-surface p-2 border border-border/50">
                    <div className="text-[0.65rem] text-muted-foreground">Koneksi Server:</div>
                    <div className="text-[0.7rem] font-semibold text-emerald-500 flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> Ready & Signed
                    </div>
                  </div>
                </div>
                <p className="text-[0.68rem] text-muted-foreground leading-relaxed">
                  💡 <strong>Cara Mengetahui Nomor Iklan (advNo):</strong> Buka Binance App atau Web &rarr; masuk ke menu <strong>P2P &rarr; Iklan Saya (My Ads)</strong> &rarr; buka rincian iklan Beli dan Jual Anda &rarr; salin deretan angka nomor iklan (biasanya 19 digit angka unik).
                </p>
              </div>

              {/* Form Input Nomor Iklan Beli & Jual */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {/* Iklan Beli (Maker Buy) */}
                <div className="rounded-xl border border-bid/40 bg-bid/5 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-bid" />
                      <span className="text-xs font-bold text-bid uppercase tracking-wider">
                        Iklan Beli Anda (Maker Buy)
                      </span>
                    </div>
                    <Badge variant="outline" className="border-bid/40 text-bid text-[0.62rem] font-bold">
                      BUY IDR
                    </Badge>
                  </div>

                  {/* 1. Nomor Iklan advNo */}
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-foreground">
                      Nomor Iklan Beli Binance (advNo)
                    </Label>
                    <Input
                      type="text"
                      value={config.merchantBuyAdvNo || ""}
                      onChange={(e) => updateConfig({ merchantBuyAdvNo: e.target.value.trim() })}
                      placeholder="Contoh: 112233445566778899"
                      className="h-8 text-xs font-mono bg-surface font-semibold"
                    />
                    <p className="text-[0.65rem] text-muted-foreground">
                      Nomor ID unik iklan beli USDT Anda di Binance P2P.
                    </p>
                  </div>

                  {/* 2. Pengaturan Harga Beli & Limit Atas/Bawah (Ceiling/Floor) */}
                  <div className="space-y-2 rounded-lg border border-bid/25 bg-surface/70 p-2.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold text-bid flex items-center gap-1">
                        <Sliders className="size-3.5" /> Setting Harga Beli & Batas Aman
                      </Label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateConfig({
                              manualBuyPriceOverrideRp:
                                config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0
                                  ? 0
                                  : Math.round(recommendedBuyPrice || 17_800),
                            })
                          }
                          className={`text-[0.62rem] px-1.5 py-0.5 rounded font-bold transition-colors ${
                            config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-surface-2 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0
                            ? "Mode: Harga Tetap"
                            : "Mode: Auto Bot"}
                        </button>
                      </div>
                    </div>

                    {/* Jika Mode Harga Tetap (Override) */}
                    {config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0 ? (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between text-[0.68rem]">
                          <span className="text-muted-foreground font-semibold">Harga Beli Tetap (Rp):</span>
                          <button
                            type="button"
                            onClick={() => updateConfig({ manualBuyPriceOverrideRp: 0 })}
                            className="text-bid hover:underline text-[0.62rem]"
                          >
                            Kembali ke Auto Bot
                          </button>
                        </div>
                        <div className="relative">
                          <Input
                            type="number"
                            min={0}
                            value={config.manualBuyPriceOverrideRp}
                            onChange={(e) =>
                              updateConfig({ manualBuyPriceOverrideRp: Math.max(0, Number(e.target.value)) })
                            }
                            className="h-8 text-xs font-bold bg-surface text-foreground font-mono pr-12"
                            placeholder="Contoh: 17850"
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.68rem] text-muted-foreground font-semibold">
                            IDR
                          </span>
                        </div>
                        <p className="text-[0.62rem] text-amber-500">
                          Iklan beli akan selalu dikirim dengan harga tetap Rp {config.manualBuyPriceOverrideRp.toLocaleString("id-ID")} tanpa mengikuti kompetitor.
                        </p>
                      </div>
                    ) : (
                      /* Jika Mode Auto Bot: Tampilkan Batas Bawah & Batas Atas */
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[0.65rem]">
                            <span className="text-muted-foreground font-semibold">Limit Bawah (Min Rp):</span>
                          </div>
                          <Input
                            type="number"
                            min={0}
                            value={config.manualBuyFloorRp && config.manualBuyFloorRp > 0 ? config.manualBuyFloorRp : ""}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              updateConfig({
                                manualBuyFloorRp: Number.isFinite(val) && val > 0 ? val : 0,
                                buyFloorMode: val > 0 ? "manual" : "disabled",
                              });
                            }}
                            placeholder="0 (Bebas)"
                            className="h-7 text-xs bg-surface font-mono text-right"
                          />
                          <p className="text-[0.6rem] text-muted-foreground">
                            {config.manualBuyFloorRp && config.manualBuyFloorRp > 0
                              ? `Min: Rp ${config.manualBuyFloorRp.toLocaleString("id-ID")}`
                              : "Tanpa batas bawah"}
                          </p>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[0.65rem]">
                            <span className="text-muted-foreground font-semibold">Limit Atas (Max Rp):</span>
                            {config.buyCeilingMode === "auto_fair" ? (
                              <span className="text-bid font-bold text-[0.6rem]">Auto ({fmtRp2(buyGuard.ceilingPrice)})</span>
                            ) : null}
                          </div>
                          <Input
                            type="number"
                            min={0}
                            value={config.manualBuyCeilingRp && config.manualBuyCeilingRp > 0 ? config.manualBuyCeilingRp : ""}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              updateConfig({
                                manualBuyCeilingRp: Number.isFinite(val) && val > 0 ? val : 0,
                                buyCeilingMode: Number.isFinite(val) && val > 0 ? "manual" : "auto_fair",
                              });
                            }}
                            placeholder={buyGuard.ceilingPrice > 0 ? `Auto (${buyGuard.ceilingPrice})` : "Auto"}
                            className="h-7 text-xs bg-surface font-mono text-right"
                          />
                          <p className="text-[0.6rem] text-muted-foreground">
                            {config.buyCeilingMode === "manual" && config.manualBuyCeilingRp && config.manualBuyCeilingRp > 0
                              ? `Manual Max: Rp ${config.manualBuyCeilingRp.toLocaleString("id-ID")}`
                              : `Auto dari Harga Jual: ${fmtRp2(buyGuard.ceilingPrice)} (Jual - Rp ${config.minSpreadRp})`}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. Target Pasang Stok Beli (USDT) */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground">
                        Target Pasang Stok Beli (USDT)
                      </Label>
                      <div className="flex items-center gap-1.5">
                        {bankAllocation.activeBuyOrdersUsdt > 0 && (
                          <span
                            className="text-[0.6rem] font-semibold text-amber-500 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1"
                            title={`Terkunci pesanan beli aktif: -${bankAllocation.activeBuyOrdersUsdt} USDT (-${fmtRp(bankAllocation.lockedActiveBuyIdr)})`}
                          >
                            <Clock className="size-2.5 animate-spin" />
                            Order Aktif: -{bankAllocation.activeBuyOrdersUsdt} USDT
                          </span>
                        )}
                        {bankAllocation.autoBuyStockUsdt > 0 ? (
                          <button
                            type="button"
                            onClick={() => updateConfig({ manualBuyStockUsdt: bankAllocation.autoBuyStockUsdt })}
                            className="text-[0.62rem] text-bid hover:underline font-semibold"
                          >
                            Hitung Kas: {bankAllocation.autoBuyStockUsdt} USDT
                          </button>
                        ) : bankAllocation.isBelowMinLimit ? (
                          <span className="text-[0.62rem] text-amber-500 font-semibold">
                            Kas &lt; Min Limit Rp 50 Jt
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="relative">
                      <Input
                        type="number"
                        step="any"
                        value={config.manualBuyStockUsdt && config.manualBuyStockUsdt > 0 ? config.manualBuyStockUsdt : ""}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          updateConfig({ manualBuyStockUsdt: Number.isFinite(val) && val > 0 ? val : 0 });
                        }}
                        placeholder={
                          bankAllocation.autoBuyStockUsdt > 0
                            ? `Otomatis: ${bankAllocation.autoBuyStockUsdt} USDT`
                            : bankAllocation.isBelowMinLimit
                            ? "0 USDT (Kas < Min Limit Rp 50 Jt)"
                            : "Contoh: 100 USDT"
                        }
                        className="h-8 text-xs font-mono bg-surface font-semibold pr-14"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.68rem] text-muted-foreground font-semibold">
                        USDT
                      </span>
                    </div>
                    <p className="text-[0.65rem] text-muted-foreground">
                      {config.manualBuyStockUsdt && config.manualBuyStockUsdt > 0
                        ? `Menggunakan stok manual: ${config.manualBuyStockUsdt} USDT. Hapus untuk pakai hitungan kas bank.`
                        : bankAllocation.isBelowMinLimit
                        ? `⚠️ Sisa kas bank (Rp ${bankAllocation.usableBankIdr.toLocaleString("id-ID")}) kurang dari batas minimum order Rp ${bankAllocation.minBuyLimitIdr.toLocaleString("id-ID")}${bankAllocation.lockedActiveBuyIdr > 0 ? ` karena ada pesanan aktif Rp ${bankAllocation.lockedActiveBuyIdr.toLocaleString("id-ID")}` : ""}. Iklan beli otomatis dihentikan.`
                        : bankAllocation.autoBuyStockUsdt > 0
                        ? `Otomatis dari kas bank: ${bankAllocation.autoBuyStockUsdt} USDT${bankAllocation.lockedActiveBuyIdr > 0 ? ` (Telah otomatis dikurangi pesanan beli aktif: ${bankAllocation.activeBuyOrdersUsdt} USDT / Rp ${bankAllocation.lockedActiveBuyIdr.toLocaleString("id-ID")})` : ""}.`
                        : "Jumlah USDT yang akan dipasang di iklan beli Anda."}
                    </p>
                  </div>

                  {/* 4. Limit Transaksi Pesanan di Binance (Min & Max Limit IDR) */}
                  <div className="space-y-1.5 rounded-lg border border-border/70 bg-surface/60 p-2.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground flex items-center gap-1">
                        <Coins className="size-3.5 text-primary" /> Batas Limit Transaksi Iklan (IDR)
                      </Label>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[0.65rem] text-muted-foreground font-semibold">
                            Limit Bawah (Min IDR):
                          </span>
                          <span className="text-[0.58rem] font-bold text-bid bg-bid/10 border border-bid/25 px-1 rounded">
                            Min 50 Juta
                          </span>
                        </div>
                        <Input
                          type="number"
                          min={10000}
                          value={config.manualBuyMinLimitIdr && config.manualBuyMinLimitIdr > 0 ? config.manualBuyMinLimitIdr : 50_000_000}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            updateConfig({ manualBuyMinLimitIdr: Number.isFinite(val) && val > 0 ? val : 50_000_000 });
                          }}
                          placeholder="50.000.000"
                          className="h-7 text-xs bg-surface font-mono text-right"
                        />
                        <div className="flex items-center justify-between text-[0.6rem] text-muted-foreground">
                          <span>Min Rp {(config.manualBuyMinLimitIdr || 50_000_000).toLocaleString("id-ID")}</span>
                          <button
                            type="button"
                            onClick={() => updateConfig({ manualBuyMinLimitIdr: 50_000_000 })}
                            className="text-primary hover:underline font-semibold"
                          >
                            Reset 50 Juta
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[0.65rem] text-muted-foreground font-semibold">
                            Limit Atas (Max IDR):
                          </span>
                          <span className="text-[0.58rem] font-bold text-bid bg-bid/10 border border-bid/25 px-1 rounded">
                            Tetap 500 Juta
                          </span>
                        </div>
                        <Input
                          type="number"
                          min={50_000_000}
                          value={config.manualBuyMaxLimitIdr && config.manualBuyMaxLimitIdr > 0 ? config.manualBuyMaxLimitIdr : 500_000_000}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            updateConfig({ manualBuyMaxLimitIdr: Number.isFinite(val) && val > 0 ? val : 500_000_000 });
                          }}
                          placeholder="500.000.000"
                          className="h-7 text-xs bg-surface font-mono text-right"
                        />
                        <p className="text-[0.6rem] text-muted-foreground">
                          Tetap Rp 500.000.000 (Binance otomatis melimit pesanan sesuai kapasitas sisa stok yang ingin dibeli).
                        </p>
                      </div>
                    </div>

                    {Boolean(
                      config.manualBuyMinLimitIdr &&
                      config.manualBuyMaxLimitIdr &&
                      config.manualBuyMinLimitIdr >= config.manualBuyMaxLimitIdr
                    ) && (
                      <div className="text-[0.62rem] text-destructive flex items-center gap-1 font-semibold pt-0.5">
                        <AlertTriangle className="size-3 shrink-0" />
                        <span>Perhatian: Limit Bawah harus lebih kecil dari Limit Atas!</span>
                      </div>
                    )}
                  </div>

                  {/* 5. Live Summary Data Terkirim ke Binance */}
                  <div className="rounded bg-surface/80 p-2.5 border border-border/60 space-y-1 text-xs">
                    <div className="flex justify-between text-muted-foreground text-[0.68rem]">
                      <span>Harga Kirim Binance:</span>
                      <strong className="num text-foreground">{fmtRp2(recommendedBuyPrice)}</strong>
                    </div>
                    <div className="flex justify-between text-muted-foreground text-[0.68rem]">
                      <span>Stok USDT Terkirim:</span>
                      <strong className="num text-bid">
                        {config.manualBuyStockUsdt && config.manualBuyStockUsdt > 0
                          ? `${config.manualBuyStockUsdt} USDT (Manual)`
                          : bankAllocation.autoBuyStockUsdt > 0
                          ? `${bankAllocation.autoBuyStockUsdt} USDT (Kas Bank)`
                          : bankAllocation.isBelowMinLimit
                          ? "0 USDT (Kas < Min Limit Rp 50 Jt)"
                          : "—"}
                      </strong>
                    </div>
                    {bankAllocation.lockedActiveBuyIdr > 0 && (
                      <div className="flex justify-between text-amber-500 text-[0.65rem] bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        <span>Terkunci Pesanan Beli Aktif:</span>
                        <strong className="font-mono">
                          -{bankAllocation.activeBuyOrdersUsdt} USDT (-{fmtRp(bankAllocation.lockedActiveBuyIdr)})
                        </strong>
                      </div>
                    )}
                    <div className="flex justify-between text-muted-foreground text-[0.68rem]">
                      <span>Rentang Limit Transaksi:</span>
                      <strong className="num text-foreground">
                        {`Rp ${(config.manualBuyMinLimitIdr || 50_000_000).toLocaleString("id-ID")} - ${fmtRp(
                          config.manualBuyMaxLimitIdr || 500_000_000
                        )}`}
                      </strong>
                    </div>
                  </div>

                  {bankAllocation.isBelowMinLimit && (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0) && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-400 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold">
                        <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                        <span>Iklan Beli Otomatis Ditahan (Batas Kas Minimal Terpenuhi)</span>
                      </div>
                      <p className="text-[0.68rem] text-amber-300/90 leading-relaxed">
                        Sisa kas bank tersedia <strong>Rp {bankAllocation.usableBankIdr.toLocaleString("id-ID")}</strong> berada di bawah batas minimum order <strong>Rp {bankAllocation.minBuyLimitIdr.toLocaleString("id-ID")}</strong>{bankAllocation.lockedActiveBuyIdr > 0 ? ` karena ${bankAllocation.activeBuyOrdersUsdt} USDT (Rp ${bankAllocation.lockedActiveBuyIdr.toLocaleString("id-ID")}) sedang diproses di pesanan beli aktif.` : "."} Bot tidak akan memasang iklan beli sampai pesanan selesai atau kas bertambah.
                      </p>
                    </div>
                  )}

                  <Button
                    type="button"
                    onClick={() => handlePushPrice("buy")}
                    disabled={
                      isPushingBuy ||
                      !config.merchantBuyAdvNo ||
                      (bankAllocation.isBelowMinLimit && (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0))
                    }
                    className={`w-full h-8 text-xs font-semibold gap-1.5 shadow-sm ${
                      bankAllocation.isBelowMinLimit && (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0)
                        ? "bg-muted text-muted-foreground cursor-not-allowed hover:bg-muted"
                        : "bg-bid text-bid-foreground hover:bg-bid/90"
                    }`}
                  >
                    {bankAllocation.isBelowMinLimit && (!config.manualBuyStockUsdt || config.manualBuyStockUsdt <= 0) ? (
                      <>
                        <AlertTriangle className="size-3.5 text-amber-500" />
                        <span>Kas &lt; Min Limit Rp 50 Jt (Iklan Ditahan)</span>
                      </>
                    ) : (
                      <>
                        <Send className={`size-3.5 ${isPushingBuy ? "animate-pulse" : ""}`} />
                        <span>{isPushingBuy ? "Mengirim ke Binance..." : "Push Harga, Stok, & Limit Beli ke Binance"}</span>
                      </>
                    )}
                  </Button>
                </div>

                {/* Iklan Jual (Maker Sell) */}
                <div className="rounded-xl border border-ask/40 bg-ask/5 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-ask" />
                      <span className="text-xs font-bold text-ask uppercase tracking-wider">
                        Iklan Jual Anda (Maker Sell)
                      </span>
                    </div>
                    <Badge variant="outline" className="border-ask/40 text-ask text-[0.62rem] font-bold">
                      SELL IDR
                    </Badge>
                  </div>

                  {/* 1. Nomor Iklan advNo */}
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-foreground">
                      Nomor Iklan Jual Binance (advNo)
                    </Label>
                    <Input
                      type="text"
                      value={config.merchantSellAdvNo || ""}
                      onChange={(e) => updateConfig({ merchantSellAdvNo: e.target.value.trim() })}
                      placeholder="Contoh: 112233445566778800"
                      className="h-8 text-xs font-mono bg-surface font-semibold"
                    />
                    <p className="text-[0.65rem] text-muted-foreground">
                      Nomor ID unik iklan jual USDT Anda di Binance P2P.
                    </p>
                  </div>

                  {/* 2. Pengaturan Harga Jual & Batas Aman */}
                  <div className="space-y-2 rounded-lg border border-ask/25 bg-surface/70 p-2.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold text-ask flex items-center gap-1">
                        <Sliders className="size-3.5" /> Setting Harga Jual & Batas Aman
                      </Label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateConfig({
                              manualSellPriceOverrideRp:
                                config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0
                                  ? 0
                                  : Math.round(recommendedSellPrice || 17_850),
                            })
                          }
                          className={`text-[0.62rem] px-1.5 py-0.5 rounded font-bold transition-colors ${
                            config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-surface-2 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0
                            ? "Mode: Harga Tetap"
                            : "Mode: Auto Bot"}
                        </button>
                      </div>
                    </div>

                    {/* Jika Mode Harga Tetap (Override) */}
                    {config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0 ? (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-[0.68rem]">
                          <span className="text-muted-foreground font-semibold">Harga Jual Tetap (Rp):</span>
                          <button
                            type="button"
                            onClick={() => updateConfig({ manualSellPriceOverrideRp: 0 })}
                            className="text-ask hover:underline text-[0.62rem]"
                          >
                            Kembali ke Auto Bot
                          </button>
                        </div>
                        <div className="relative">
                          <Input
                            type="number"
                            min={0}
                            value={config.manualSellPriceOverrideRp}
                            onChange={(e) =>
                              updateConfig({ manualSellPriceOverrideRp: Math.max(0, Number(e.target.value)) })
                            }
                            className="h-8 text-xs font-bold bg-surface text-foreground font-mono pr-12"
                            placeholder="Contoh: 17850"
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.68rem] text-muted-foreground font-semibold">
                            IDR
                          </span>
                        </div>
                        <p className="text-[0.62rem] text-amber-500">
                          Iklan jual akan dikirim dengan harga tetap Rp {config.manualSellPriceOverrideRp.toLocaleString("id-ID")}.
                        </p>
                      </div>
                    ) : (
                      /* Mode Auto Bot */
                      <div className="space-y-2 pt-1 text-xs">
                        <div className="flex justify-between items-center text-muted-foreground text-[0.68rem]">
                          <span>Floor Margin HPP Otomatis:</span>
                          <strong className="num text-ask font-bold">{fmtRp2(sellGuard.floorPrice)}</strong>
                        </div>
                        <div className="flex justify-between items-center text-muted-foreground text-[0.68rem]">
                          <span>Strategi Offset:</span>
                          <strong className="text-foreground">{config.sellOffsetRp} Rp Undercut</strong>
                        </div>
                      </div>
                    )}

                    {/* Input Batas Bawah Jual Aman (Sell Floor) Langsung */}
                    <div className="border-t border-border/50 pt-2 space-y-1.5">
                      <div className="flex items-center justify-between text-[0.68rem]">
                        <span className="font-semibold text-ask flex items-center gap-1">
                          <ShieldCheck className="size-3 text-emerald-500" />
                          <span>Batas Bawah Jual Aman (Floor):</span>
                        </span>
                        <span className="num font-bold text-emerald-400 text-[0.68rem]">
                          {config.manualSellFloorRp && config.manualSellFloorRp > 0
                            ? `Terkunci ≥ Rp ${config.manualSellFloorRp.toLocaleString("id-ID")}`
                            : `Auto ≥ ${fmtRp2(sellGuard.floorPrice)}`}
                        </span>
                      </div>
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          value={config.manualSellFloorRp || ""}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value));
                            updateConfig({
                              manualSellFloorRp: val,
                              sellFloorMode: val > 0 ? "manual" : "auto_hpp",
                            });
                          }}
                          placeholder={`0 = Auto HPP (${Math.round(sellGuard.floorPrice || 17850)})`}
                          className="h-7 text-xs bg-surface text-foreground font-mono font-bold pr-12"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.65rem] text-muted-foreground font-semibold">
                          IDR
                        </span>
                      </div>
                      <p className="text-[0.62rem] text-muted-foreground leading-tight">
                        🛡️ Proteksi Mutlak: Bot TIDAK AKAN PERNAH memasang harga jual di bawah batas ini.
                      </p>
                    </div>
                  </div>

                  {/* 3. Otomatis Pasang All Stok Saldo USDT */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground flex items-center gap-1">
                        <Wallet className="size-3.5 text-ask" />
                        <span>Stok USDT Jual (Max Available All)</span>
                      </Label>
                      {maxAvailableSellStockUsdt > 0 && (
                        <div className="flex items-center gap-1.5">
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[0.6rem] font-bold">
                            Max. available: {maxAvailableSellStockUsdt.toLocaleString("id-ID")} USDT All
                          </Badge>
                          <span className="text-[0.6rem] text-muted-foreground">
                            (Fee: {reservedFeeSellUsdt} USDT)
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        type="number"
                        step="any"
                        value={config.manualSellStockUsdt && config.manualSellStockUsdt > 0 ? config.manualSellStockUsdt : ""}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          updateConfig({ manualSellStockUsdt: Number.isFinite(val) && val > 0 ? val : 0 });
                        }}
                        placeholder={
                          maxAvailableSellStockUsdt > 0
                            ? `Otomatis All: ${maxAvailableSellStockUsdt} USDT (Max Available)`
                            : "0 USDT (Tidak ada saldo)"
                        }
                        className="h-8 text-xs font-mono bg-surface font-semibold pr-14"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.68rem] text-muted-foreground font-semibold">
                        USDT
                      </span>
                    </div>
                    <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                      {config.manualSellStockUsdt && config.manualSellStockUsdt > 0
                        ? `Menggunakan stok manual: ${config.manualSellStockUsdt} USDT. Kosongkan untuk otomatis pakai Max. available dari Binance.`
                        : maxAvailableSellStockUsdt > 0
                        ? `✓ Otomatis mengambil Max. available (${maxAvailableSellStockUsdt} USDT All) persis seperti di Binance setelah dipotong Reserved Fee (${reservedFeeSellUsdt} USDT) sehingga tidak pernah error insufficient balance!`
                        : "Saldo USDT saat ini 0. Bot akan otomatis memasukkan seluruh saldo jika stok masuk."}
                    </p>
                  </div>

                  {/* 4. Limit Transaksi Pesanan di Binance (Min & Max Limit IDR) */}
                  <div className="space-y-1.5 rounded-lg border border-border/70 bg-surface/60 p-2.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground flex items-center gap-1">
                        <Coins className="size-3.5 text-primary" /> Batas Limit Transaksi Iklan (IDR)
                      </Label>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <span className="text-[0.65rem] text-muted-foreground font-semibold">
                          Limit Bawah (Min IDR):
                        </span>
                        <Input
                          type="number"
                          min={0}
                          value={config.manualSellMinLimitIdr && config.manualSellMinLimitIdr > 0 ? config.manualSellMinLimitIdr : ""}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            updateConfig({ manualSellMinLimitIdr: Number.isFinite(val) && val > 0 ? val : 0 });
                          }}
                          placeholder="Default: 50.000"
                          className="h-7 text-xs bg-surface font-mono text-right"
                        />
                        <p className="text-[0.6rem] text-muted-foreground">
                          {config.manualSellMinLimitIdr && config.manualSellMinLimitIdr > 0
                            ? `Min Rp ${config.manualSellMinLimitIdr.toLocaleString("id-ID")}`
                            : "Default Rp 50.000"}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[0.65rem] text-muted-foreground font-semibold">
                          Limit Atas (Max IDR):
                        </span>
                        <Input
                          type="number"
                          min={0}
                          value={config.manualSellMaxLimitIdr && config.manualSellMaxLimitIdr > 0 ? config.manualSellMaxLimitIdr : ""}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            updateConfig({ manualSellMaxLimitIdr: Number.isFinite(val) && val > 0 ? val : 0 });
                          }}
                          placeholder={
                            liveStockUsdt > 0 && recommendedSellPrice > 0
                              ? String(Math.floor(liveStockUsdt * recommendedSellPrice))
                              : "Auto Stok"
                          }
                          className="h-7 text-xs bg-surface font-mono text-right"
                        />
                        <p className="text-[0.6rem] text-muted-foreground">
                          {config.manualSellMaxLimitIdr && config.manualSellMaxLimitIdr > 0
                            ? `Max Rp ${config.manualSellMaxLimitIdr.toLocaleString("id-ID")}`
                            : "Auto dari kapasitas stok"}
                        </p>
                      </div>
                    </div>

                    {Boolean(
                      config.manualSellMinLimitIdr &&
                      config.manualSellMaxLimitIdr &&
                      config.manualSellMinLimitIdr >= config.manualSellMaxLimitIdr
                    ) && (
                      <div className="text-[0.62rem] text-destructive flex items-center gap-1 font-semibold pt-0.5">
                        <AlertTriangle className="size-3 shrink-0" />
                        <span>Perhatian: Limit Bawah harus lebih kecil dari Limit Atas!</span>
                      </div>
                    )}
                  </div>

                  {/* 5. Live Summary Data Terkirim ke Binance */}
                  <div className="rounded bg-surface/80 p-2.5 border border-border/60 space-y-1 text-xs">
                    <div className="flex justify-between text-muted-foreground text-[0.68rem]">
                      <span>Harga Kirim Binance:</span>
                      <strong className="num text-foreground">{fmtRp2(recommendedSellPrice)}</strong>
                    </div>
                    <div className="flex justify-between text-muted-foreground text-[0.68rem]">
                      <span>All Stok USDT Siap Jual:</span>
                      <strong className="num text-ask">
                        {config.manualSellStockUsdt && config.manualSellStockUsdt > 0
                          ? `${config.manualSellStockUsdt} USDT (Manual)`
                          : maxAvailableSellStockUsdt > 0
                          ? `${maxAvailableSellStockUsdt} USDT (Max Available All)`
                          : "0 USDT"}
                      </strong>
                    </div>
                    <div className="flex justify-between text-muted-foreground text-[0.68rem]">
                      <span>Rentang Limit Transaksi:</span>
                      <strong className="num text-foreground">
                        {`Rp ${(config.manualSellMinLimitIdr || 50_000).toLocaleString("id-ID")} - ${
                          config.manualSellMaxLimitIdr && config.manualSellMaxLimitIdr > 0
                            ? fmtRp(config.manualSellMaxLimitIdr)
                            : maxAvailableSellStockUsdt > 0 && recommendedSellPrice > 0
                            ? fmtRp(Math.floor(maxAvailableSellStockUsdt * recommendedSellPrice))
                            : "Auto"
                        }`}
                      </strong>
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={() => handlePushPrice("sell")}
                    disabled={isPushingSell || !config.merchantSellAdvNo}
                    className="w-full h-8 text-xs font-semibold bg-ask text-ask-foreground hover:bg-ask/90 gap-1.5 shadow-sm"
                  >
                    <Send className={`size-3.5 ${isPushingSell ? "animate-pulse" : ""}`} />
                    <span>{isPushingSell ? "Mengirim ke Binance..." : "Push Harga, All Stok, & Limit Jual ke Binance"}</span>
                  </Button>
                </div>
              </div>

              {/* Mode Otomasi Penuh (Auto-Push Live ke Binance) */}
              <div className="rounded-xl border border-border/80 bg-surface-2/60 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Zap className="size-4 text-primary" />
                      <h4 className="text-xs font-bold text-foreground">
                        Mode Auto-Push Live ke Binance
                      </h4>
                      {config.autoPushToBinance && (
                        <Badge className="h-5 px-1.5 text-[0.6rem] bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold">
                          ● AKTIF LIVE
                        </Badge>
                      )}
                    </div>
                    <p className="text-[0.68rem] text-muted-foreground">
                      Secara otomatis memperbarui harga iklan di Binance setiap kali pasar bergerak dan bot menghitung harga optimal baru.
                    </p>
                  </div>
                  <Switch
                    checked={config.autoPushToBinance}
                    onCheckedChange={(val) => {
                      if (val && (!config.merchantBuyAdvNo && !config.merchantSellAdvNo)) {
                        toast.error("Isi minimal salah satu nomor iklan (advNo) sebelum mengaktifkan Auto-Push.");
                        return;
                      }
                      updateConfig({ autoPushToBinance: val });
                      toast.success(
                        val
                          ? "Auto-Push Live diaktifkan! Bot akan otomatis menyinkronkan harga ke Binance."
                          : "Auto-Push Live dimatikan."
                      );
                    }}
                    className="scale-90 data-[state=checked]:bg-primary"
                  />
                </div>

                {config.autoPushToBinance && (
                  <div className="space-y-2 pt-1 text-xs">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Zap className="size-3.5 text-primary" />
                        <span>Interval Minimal Push / Refresh ke Binance</span>
                      </Label>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          max={120}
                          value={config.autoPushMinIntervalSec ?? 1}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                            updateConfig({ autoPushMinIntervalSec: val });
                          }}
                          className="h-6.5 w-16 text-xs text-right font-bold bg-surface font-mono"
                        />
                        <span className="text-xs font-bold text-primary">Detik</span>
                      </div>
                    </div>
                    <Slider
                      value={[config.autoPushMinIntervalSec ?? 1]}
                      min={1}
                      max={60}
                      step={1}
                      onValueChange={(val) => updateConfig({ autoPushMinIntervalSec: Math.max(1, val[0]) })}
                      className="py-1"
                    />
                    <div className="flex items-center justify-between text-[0.62rem] text-muted-foreground">
                      {[1, 2, 3, 5, 10, 30].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => updateConfig({ autoPushMinIntervalSec: sec })}
                          className={`rounded px-2 py-0.5 font-semibold transition-colors ${
                            (config.autoPushMinIntervalSec ?? 1) === sec
                              ? "bg-primary text-primary-foreground font-bold shadow-xs"
                              : "bg-surface-2 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                    <p className="text-[0.62rem] text-muted-foreground">
                      Jeda minimal antara setiap push ke Binance. Sekarang mendukung hingga kecepatan 1 detik untuk update harga ultra cepat!
                    </p>
                  </div>
                )}
              </div>

              {/* Otomasi 24/7 Tanpa Buka Website (Background Server Auto-Pricing) */}
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-3.5 space-y-3 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 pb-2.5">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Server className="size-4 text-primary" />
                      <h4 className="text-xs font-bold text-foreground">
                        Otomasi 24/7 di Background Server (Tanpa Buka Website)
                      </h4>
                      <Badge className="h-5 px-1.5 text-[0.6rem] bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold gap-1">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        24 JAM NONSTOP
                      </Badge>
                    </div>
                    <p className="text-[0.68rem] text-muted-foreground">
                      Bot terus berjalan memantau pasar dan mengupdate harga iklan di Binance secara otomatis di server meskipun browser atau laptop Anda dimatikan!
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={isTriggeringServerTick}
                      onClick={async () => {
                        setIsTriggeringServerTick(true);
                        try {
                          const res = await triggerTickFn({ data: { sessionToken: effectiveToken } });
                          if (res.ok) {
                            toast.success(res.message);
                            refetchServerStatus();
                          } else {
                            toast.warning(res.message || res.error || "Gagal menjalankan tick server");
                          }
                        } catch (e) {
                          toast.error(`Error: ${String(e)}`);
                        } finally {
                          setIsTriggeringServerTick(false);
                        }
                      }}
                      className="h-7 text-xs px-2.5 border-primary/40 text-primary hover:bg-primary/10 gap-1.5 font-semibold"
                      title="Jalankan satu siklus auto-pricing langsung di server sekarang"
                    >
                      <Play className={`size-3 ${isTriggeringServerTick ? "animate-spin" : ""}`} />
                      <span>{isTriggeringServerTick ? "Menjalankan..." : "Test Run di Server"}</span>
                    </Button>
                  </div>
                </div>

                {/* Status Terakhir Server Run */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-surface/80 p-2.5 border border-border/70 space-y-1">
                    <span className="text-[0.68rem] text-muted-foreground font-semibold flex items-center gap-1">
                      <Clock className="size-3 text-primary" /> Status Terakhir Server Run:
                    </span>
                    <div className="text-foreground font-semibold text-xs flex items-center justify-between">
                      <span>
                        {serverBotStatus && typeof serverBotStatus === "object" && (serverBotStatus as Record<string, unknown>).timestamp
                          ? `${Math.max(1, Math.round((Date.now() - Number((serverBotStatus as Record<string, unknown>).timestamp)) / 1000))} detik lalu`
                          : "Menunggu trigger pertama"}
                      </span>
                      <span className="text-[0.68rem] text-muted-foreground">
                        {serverBotStatus && typeof serverBotStatus === "object" && (serverBotStatus as Record<string, unknown>).timestamp
                          ? new Date(Number((serverBotStatus as Record<string, unknown>).timestamp)).toLocaleTimeString("id-ID")
                          : "-"}
                      </span>
                    </div>
                    <p className="text-[0.65rem] text-muted-foreground truncate">
                      {String((serverBotStatus as Record<string, unknown>)?.message || "Server siap menjalankan auto-push.")}
                    </p>
                  </div>

                  <div className="rounded-lg bg-surface/80 p-2.5 border border-border/70 space-y-1">
                    <span className="text-[0.68rem] text-muted-foreground font-semibold flex items-center gap-1">
                      <Activity className="size-3 text-emerald-400" /> Harga Terupdate di Binance:
                    </span>
                    <div className="flex justify-between items-center text-xs">
                      <div>
                        <span className="text-[0.65rem] text-muted-foreground">Beli: </span>
                        <strong className="num text-bid">
                          {(serverBotStatus as Record<string, unknown>)?.recommendedBuyPrice
                            ? `Rp ${Number((serverBotStatus as Record<string, unknown>).recommendedBuyPrice).toLocaleString("id-ID")}`
                            : "-"}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[0.65rem] text-muted-foreground">Jual: </span>
                        <strong className="num text-ask">
                          {(serverBotStatus as Record<string, unknown>)?.recommendedSellPrice
                            ? `Rp ${Number((serverBotStatus as Record<string, unknown>).recommendedSellPrice).toLocaleString("id-ID")}`
                            : "-"}
                        </strong>
                      </div>
                    </div>
                    <div className="text-[0.65rem] text-muted-foreground flex gap-2">
                      <span className={(serverBotStatus as Record<string, unknown>)?.buyPushed ? "text-bid font-bold" : ""}>
                        Buy: {(serverBotStatus as Record<string, unknown>)?.buyPushed ? "✓ Pushed" : "Idle"}
                      </span>
                      <span className={(serverBotStatus as Record<string, unknown>)?.sellPushed ? "text-ask font-bold" : ""}>
                        Sell: {(serverBotStatus as Record<string, unknown>)?.sellPushed ? "✓ Pushed" : "Idle"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* URL Webhook / Cron Eksternal */}
                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/60 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.68rem] font-bold text-foreground flex items-center gap-1.5">
                      <Globe className="size-3.5 text-primary" /> Webhook Cron URL (Trigger 24 Jam):
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const cronUrl =
                          typeof window !== "undefined"
                            ? `${window.location.origin}/api/cron/auto-pricing`
                            : "https://binance-bot-long.vercel.app/api/cron/auto-pricing";
                        navigator.clipboard.writeText(cronUrl);
                        toast.success("Webhook URL Cron berhasil disalin!");
                      }}
                      className="h-6 text-[0.65rem] px-2 text-primary hover:bg-primary/10 gap-1 font-semibold"
                    >
                      <Copy className="size-3" />
                      <span>Salin URL</span>
                    </Button>
                  </div>
                  <div className="p-1.5 rounded bg-surface-2 font-mono text-[0.65rem] text-primary truncate select-all">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/api/cron/auto-pricing`
                      : "https://binance-bot-long.vercel.app/api/cron/auto-pricing"}
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                    💡 <strong>Tips Akun Vercel Hobby (Free):</strong> Vercel gratis membatasi Cron internal maks 1x/hari. Agar bot berjalan 24 jam nonstop setiap 1 menit (atau 30 detik) secara 100% gratis tanpa perlu bayar Vercel Pro, cukup salin URL di atas dan pasang di layanan gratis seperti <strong>cron-job.org</strong> atau <strong>UptimeRobot</strong>!
                  </p>
                </div>
              </div>

              {/* Log Respons Terakhir dari Binance API */}
              <div className="rounded-xl border border-border/70 bg-surface p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground flex items-center gap-1.5">
                    <Terminal className="size-3.5 text-primary" /> Log Respons Terakhir dari Server Binance
                  </span>
                  {lastPushLog && (
                    <Badge
                      variant="outline"
                      className={`text-[0.62rem] font-bold ${
                        lastPushLog.ok
                          ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                          : "border-destructive/40 text-destructive bg-destructive/10"
                      }`}
                    >
                      {lastPushLog.ok ? "SUKSES" : `ERROR ${lastPushLog.binanceCode || ""}`}
                    </Badge>
                  )}
                </div>

                {lastPushLog ? (
                  <div className="rounded bg-surface-2/80 p-2.5 font-mono text-[0.68rem] space-y-1 border border-border/50">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Waktu:</span>
                      <span>{new Date(lastPushLog.timestamp).toLocaleTimeString("id-ID")}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Iklan:</span>
                      <span>#{lastPushLog.advNo} ({lastPushLog.side.toUpperCase()})</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Harga Terkirim:</span>
                      <span className="font-bold text-foreground">Rp {lastPushLog.price.toLocaleString("id-ID")}</span>
                    </div>
                    <div className="text-foreground pt-1 border-t border-border/40 font-sans">
                      {lastPushLog.message}
                    </div>
                    {lastPushLog.error && (
                      <div className="text-destructive font-sans text-[0.65rem]">
                        Detail Error: {lastPushLog.error}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded bg-surface-2/40 p-3 text-center text-muted-foreground text-[0.7rem] italic">
                    Belum ada riwayat push harga ke Binance pada sesi ini. Masukkan nomor iklan dan klik tombol Push untuk menguji.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
