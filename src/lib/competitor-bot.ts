/**
 * Modul Analisis & Bot Auto-Pricing P2P Binance.
 * Strategi: Filtered Competitor Following dengan Safety Boundaries (Floor, Ceiling, Min Spread).
 */

import { type Ad } from "./p2p-engine";

export type CompetitorFilterConfig = {
  enabled: boolean;
  // ── Filter Merchant Acuan ──────────────────────────────────────────────────
  minUsdtAmount: number;          // Minimal USDT yang dimiliki/dijual merchant (misal: 500 USDT)
  maxUsdtAmount: number;          // Batas maksimal USDT (0 = Bebas, mencegah whale besar)
  minOrderLimitIdr: number;       // Toleransi maksimal syarat min order kompetitor (0 = Bebas, misal: 50 Jt)
  minMaxLimitIdr: number;         // Min Transaksi: kapasitas order merchant harus >= nominal ini (0 = Bebas)
  verifiedOnly: boolean;          // Hanya ikuti Verified Merchant (centang kuning)
  userTypeFilter: "all" | "merchant_only" | "user_only"; // Filter tipe user Binance
  allowedMerchantLevels: ("gold" | "silver" | "bronze" | "regular")[]; // Filter level merchant: Gold, Silver, Bronze, Regular
  scanAdLimit: number;            // Batas kedalaman scan iklan/user dari orderbook (20, 50, 100, default: 100)
  minCompletionRate: number;      // Minimal % penyelesaian 30 hari (misal: 95%)
  minMonthOrders: number;         // Minimal total order 30 hari (misal: 50)

  // ── Strategi Target Acuan ─────────────────────────────────────────────────
  targetMode: "rank" | "average_top" | "median_top"; // Peringkat spesifik vs rata-rata / median top N
  targetRank: number;             // Peringkat target di antara merchant yang lolos (1 = Rank 1, 2 = Rank 2, dst)
  targetTopCount: number;         // Berapa banyak top merchant jika pakai mode average/median (misal: 3)

  // ── Filter Pembayaran ──────────────────────────────────────────────────────
  filterPaymentMethods: string[]; // Filter metode bayar tertentu (kosong = semua)
  paymentMatchMode: "any" | "all"; // "any" = punya salah satu, "all" = wajib punya semua
  excludeEwallets: boolean;       // Tolak iklan yang hanya menerima e-wallet (DANA/OVO/GoPay dll)

  // ── Filter Merchant (Blacklist / Whitelist) ────────────────────────────────
  merchantFilterMode: "all_except_blacklist" | "whitelist_only";
  blacklistedMerchants: string[]; // Daftar nama merchant yang diabaikan/di-blacklist
  whitelistedMerchants: string[]; // Daftar nama merchant yang diizinkan (jika mode whitelist)

  // ── Anti-Spoofing & Rentang Harga Pasar Absolut ───────────────────────────
  ignoreOutlierSpikes: boolean;   // Abaikan harga pancingan yang melompat ekstrem dari klaster pasar
  maxOutlierGapRp: number;        // Batas selisih lonjakan harga ekstrem (default: 40 Rp)
  minPriceBoundRp: number;        // Batas bawah absolut harga iklan (0 = Bebas)
  maxPriceBoundRp: number;        // Batas atas absolut harga iklan (0 = Bebas)

  // ── Strategi Offset Harga ──────────────────────────────────────────────────
  sellOffsetRp: number;           // Offset harga Jual terhadap kompetitor (default: -1 untuk undercut)
  buyOffsetRp: number;            // Offset harga Beli terhadap kompetitor (default: +1 untuk overcut)

  // ── Batas Pengaman (Boundaries & Guardrails) ────────────────────────────────
  sellFloorMode: "auto_hpp" | "manual"; // Batas bawah jual: Auto dari HPP stok atau nominal tetap
  manualSellFloorRp: number;            // Nominal batas bawah jual manual (jika mode manual)
  minProfitMarginRp: number;            // Target laba bersih minimal per USDT di atas HPP + Fee (misal: Rp 15)

  buyCeilingMode: "auto_fair" | "manual"; // Batas atas beli: Auto dari Fair Price atau nominal tetap
  manualBuyCeilingRp: number;             // Nominal batas atas beli manual (jika mode manual)
  buyFloorMode?: "disabled" | "manual";   // Batas bawah beli: Disabled (bebas) atau nominal tetap
  manualBuyFloorRp?: number;              // Nominal batas bawah beli manual (0 = bebas / tanpa floor)
  manualBuyPriceOverrideRp?: number;      // Override pasang harga beli manual tetap (0 = auto bot)
  autoFollowNextWhenLimitReached?: boolean; // Otomatis ikuti iklan lain jika target mencapai limit atas (ceiling) atau batas bawah (floor)
  ownMerchantNickname?: string;            // Nickname akun Binance sendiri (untuk abaikan iklan sendiri)

  minSpreadRp: number;            // Selisih minimal (Jual - Beli) agar tetap profit
  maxPriceStepRp: number;         // Pembatas lonjakan harga per siklus (anti-spoofing)

  // ── Alokasi Stok Beli Otomatis dari Sisa Saldo Bank ───────────────────────
  autoSyncBuyStockWithBank: boolean;      // Otomatis pasang jumlah USDT beli sesuai sisa uang di bank
  bankBalanceSource: "auto" | "manual";   // Sumber saldo bank: "auto" (modal kas PnL) atau "manual"
  manualBankBalanceIdr: number;           // Saldo bank manual jika mode manual atau override (misal: 25.000.000)
  bankAllocationPct: number;              // Persentase alokasi saldo bank untuk beli (misal: 100%)
  bankReserveBufferIdr: number;           // Cadangan uang minimal di bank yang tidak boleh dibelanjakan (Rp)
  deductLiveStockFromBudget: boolean;     // Otomatis kurangi modal beli dengan nilai stok USDT yang sedang dimiliki

  // ── Integrasi C2C Merchant API Binance ─────────────────────────────────────
  merchantBuyAdvNo: string;               // Nomor iklan beli di Binance (advNo)
  merchantSellAdvNo: string;              // Nomor iklan jual di Binance (advNo)
  manualBuyStockUsdt?: number;            // Target stok USDT beli manual/override (0 = auto dari kas bank)
  manualBuyMinLimitIdr?: number;          // Limit bawah pesanan IDR iklan beli di Binance (default 50 Juta)
  manualBuyMaxLimitIdr?: number;          // Plafon limit IDR beli di Binance (tetap 500 Juta, otomatis terlimit oleh Binance sesuai stok)
  manualSellStockUsdt?: number;           // Target stok USDT jual manual (0 = otomatis all saldo live)
  manualSellMinLimitIdr?: number;         // Limit bawah pesanan IDR iklan jual di Binance (0 = default 50.000)
  manualSellMaxLimitIdr?: number;         // Plafon limit IDR jual manual (0 = auto dari stok * harga)
  manualSellPriceOverrideRp?: number;     // Override pasang harga jual manual tetap (0 = auto bot)
  autoPushToBinance: boolean;             // Otomatis push perubahan harga ke Binance P2P
  autoPushMinIntervalSec: number;         // Interval minimal push (detik, default 1)
};

export const DEFAULT_BOT_CONFIG: CompetitorFilterConfig = {
  enabled: true,
  minUsdtAmount: 500,
  maxUsdtAmount: 0,
  minOrderLimitIdr: 0, // 0 = Bebas (tidak memfilter syarat min order kompetitor)
  minMaxLimitIdr: 0,
  verifiedOnly: true,
  userTypeFilter: "all",
  allowedMerchantLevels: ["gold", "silver", "bronze", "regular"],
  scanAdLimit: 100,
  minCompletionRate: 95,
  minMonthOrders: 50,

  targetMode: "rank",
  targetRank: 1,
  targetTopCount: 3,

  filterPaymentMethods: [],
  paymentMatchMode: "any",
  excludeEwallets: false,

  merchantFilterMode: "all_except_blacklist",
  blacklistedMerchants: [],
  whitelistedMerchants: [],

  ignoreOutlierSpikes: true,
  maxOutlierGapRp: 40,
  minPriceBoundRp: 0,
  maxPriceBoundRp: 0,

  sellOffsetRp: -1, // Iklan jual pasang Rp 1 di bawah kompetitor teratas
  buyOffsetRp: 1,   // Iklan beli pasang Rp 1 di atas kompetitor teratas

  sellFloorMode: "auto_hpp",
  manualSellFloorRp: 0,
  minProfitMarginRp: 15,

  buyCeilingMode: "auto_fair",
  manualBuyCeilingRp: 999_999,
  buyFloorMode: "disabled",
  manualBuyFloorRp: 0,
  manualBuyPriceOverrideRp: 0,

  minSpreadRp: 25,
  maxPriceStepRp: 50,

  autoSyncBuyStockWithBank: true,
  bankBalanceSource: "auto",
  manualBankBalanceIdr: 0,
  bankAllocationPct: 100,
  bankReserveBufferIdr: 0,
  deductLiveStockFromBudget: true,

  merchantBuyAdvNo: "",
  merchantSellAdvNo: "",
  manualBuyStockUsdt: 0,
  manualBuyMinLimitIdr: 50_000_000,
  manualBuyMaxLimitIdr: 500_000_000,
  manualSellStockUsdt: 0,
  manualSellMinLimitIdr: 0,
  manualSellMaxLimitIdr: 0,
  manualSellPriceOverrideRp: 0,
  autoPushToBinance: false,
  autoPushMinIntervalSec: 1,
  autoFollowNextWhenLimitReached: true,
  ownMerchantNickname: "",
};

export type StrategyPreset = "balanced" | "conservative" | "aggressive" | "whale";

export const STRATEGY_PRESETS: Record<
  StrategyPreset,
  { label: string; desc: string; config: Partial<CompetitorFilterConfig> }
> = {
  balanced: {
    label: "Seimbang (Standar)",
    desc: "Target Rank 1 dengan modal moderat (500 USDT) & verified merchant.",
    config: {
      minUsdtAmount: 500,
      maxUsdtAmount: 0,
      minOrderLimitIdr: 0,
      minMaxLimitIdr: 0,
      verifiedOnly: true,
      userTypeFilter: "all",
      minCompletionRate: 95,
      minMonthOrders: 50,
      targetMode: "rank",
      targetRank: 1,
      sellOffsetRp: -1,
      buyOffsetRp: 1,
      minSpreadRp: 25,
      ignoreOutlierSpikes: true,
      excludeEwallets: false,
    },
  },
  conservative: {
    label: "Konservatif (Aman & Margin Tebal)",
    desc: "Target Rank 2, modal >= 1.000 USDT & completion rate >= 98%.",
    config: {
      minUsdtAmount: 1000,
      maxUsdtAmount: 0,
      minOrderLimitIdr: 0,
      minMaxLimitIdr: 0,
      verifiedOnly: true,
      userTypeFilter: "merchant_only",
      minCompletionRate: 98,
      minMonthOrders: 100,
      targetMode: "rank",
      targetRank: 2,
      sellOffsetRp: 0,
      buyOffsetRp: 0,
      minSpreadRp: 35,
      ignoreOutlierSpikes: true,
      excludeEwallets: true,
    },
  },
  aggressive: {
    label: "Agresif (Rank 1 Chaser)",
    desc: "Dominasi antrean terdepan dengan offset Rp 1, filter modal fleksibel (250 USDT).",
    config: {
      minUsdtAmount: 250,
      maxUsdtAmount: 0,
      minOrderLimitIdr: 0,
      minMaxLimitIdr: 0,
      verifiedOnly: false,
      userTypeFilter: "all",
      minCompletionRate: 90,
      minMonthOrders: 25,
      targetMode: "rank",
      targetRank: 1,
      sellOffsetRp: -1,
      buyOffsetRp: 1,
      minSpreadRp: 20,
      ignoreOutlierSpikes: true,
      excludeEwallets: false,
    },
  },
  whale: {
    label: "Whale (Modal Besar & Transaksi Jumbo)",
    desc: "Modal >= 3.000 USDT dan mampu melayani pesanan >= Rp 25 Juta.",
    config: {
      minUsdtAmount: 3000,
      maxUsdtAmount: 0,
      minOrderLimitIdr: 0,
      minMaxLimitIdr: 25_000_000,
      verifiedOnly: true,
      userTypeFilter: "merchant_only",
      minCompletionRate: 96,
      minMonthOrders: 50,
      targetMode: "rank",
      targetRank: 1,
      sellOffsetRp: -1,
      buyOffsetRp: 1,
      minSpreadRp: 25,
      ignoreOutlierSpikes: true,
      excludeEwallets: true,
    },
  },
};

export type DisqualificationReason = {
  code:
    | "OWN_AD"
    | "USDT_TOO_LOW"
    | "USDT_TOO_HIGH"
    | "MIN_LIMIT_TOO_HIGH"
    | "MAX_LIMIT_TOO_LOW"
    | "UNVERIFIED"
    | "USER_TYPE_MISMATCH"
    | "MERCHANT_LEVEL_FILTERED"
    | "COMPLETION_RATE_LOW"
    | "MONTH_ORDERS_LOW"
    | "PAYMENT_METHOD_MISMATCH"
    | "ONLY_EWALLET"
    | "BLACKLISTED"
    | "NOT_IN_WHITELIST"
    | "PRICE_OUTLIER"
    | "PRICE_OUT_OF_BOUNDS";
  message: string;
};

export type EvaluatedAd = {
  ad: Ad;
  isQualified: boolean;
  disqualificationReasons: DisqualificationReason[];
  qualifiedRank?: number;
};

export type CompetitorPricingResult = {
  recommendedSellPrice: number;
  recommendedBuyPrice: number;
  rawSellPrice: number;
  rawBuyPrice: number;
  sellTargetMerchant: Ad | null;
  buyTargetMerchant: Ad | null;
  sellRankUsed: number;
  buyRankUsed: number;
  targetMethodDescription: {
    sell: string;
    buy: string;
  };
  qualifiedSellAds: Ad[];
  evaluatedSellAds: EvaluatedAd[];
  qualifiedBuyAds: Ad[];
  evaluatedBuyAds: EvaluatedAd[];
  sellGuard: {
    triggered: boolean;
    reason?: string;
    floorPrice: number;
    autoSwitched?: boolean;
    switchedToRank?: number;
  };
  buyGuard: {
    triggered: boolean;
    reason?: string;
    ceilingPrice: number;
    floorPrice?: number;
    autoSwitched?: boolean;
    switchedToRank?: number;
  };
  spreadAbs: number;
  spreadPct: number;
  makerFeeSellPerUsdt: number;
  makerFeeBuyPerUsdt: number;
  effectiveHpp: number;
  estimatedNetProfitPerUsdt: number;
  bankAllocation: {
    totalBudgetIdr: number;
    liveStockUsdt: number;
    stockCapitalValuationIdr: number;
    effectiveBankBalance: number;
    lockedActiveBuyIdr: number;
    activeBuyOrdersUsdt: number;
    usableBankIdr: number;
    autoBuyStockUsdt: number;
    autoBuyMaxLimitIdr: number;
    isBelowMinLimit: boolean;
    minBuyLimitIdr: number;
    isSynced: boolean;
  };
};

const EWALLET_KEYWORDS = [
  "dana",
  "ovo",
  "gopay",
  "go pay",
  "linkaja",
  "link aja",
  "shopeepay",
  "shopee pay",
  "astrapay",
  "sakuku",
];

/**
 * Filter daftar iklan kompetitor berdasarkan konfigurasi penyaringan merchant
 */
export function evaluateCompetitorAds(
  ads: Ad[],
  config: CompetitorFilterConfig,
  side: "sell_ref" | "buy_ref",
): { qualified: Ad[]; evaluated: EvaluatedAd[] } {
  const evaluated: EvaluatedAd[] = [];
  const qualified: Ad[] = [];

  // Urutan iklan kompetitor:
  // Untuk sell_ref (kompetitor yang menjual ke pembeli): harga terendah paling kompetitif (ascending)
  // Untuk buy_ref (kompetitor yang membeli dari penjual): harga tertinggi paling kompetitif (descending)
  const sortedAds = [...ads].sort((a, b) =>
    side === "sell_ref" ? a.price - b.price : b.price - a.price,
  );

  const scanLimit = config.scanAdLimit && config.scanAdLimit > 0 ? config.scanAdLimit : 100;
  const adsToScan = sortedAds.slice(0, scanLimit);

  let currentRank = 1;

  for (const ad of adsToScan) {
    const reasons: DisqualificationReason[] = [];

    // 0. Filter Iklan Milik Sendiri (Own Ad - agar bot tidak bersaing dengan diri sendiri)
    const cleanBuyAdvNo = config.merchantBuyAdvNo ? config.merchantBuyAdvNo.trim().replace(/^#/, "") : "";
    const cleanSellAdvNo = config.merchantSellAdvNo ? config.merchantSellAdvNo.trim().replace(/^#/, "") : "";
    const cleanAdAdvNo = ad.adv_no ? String(ad.adv_no).trim().replace(/^#/, "") : "";
    const ownNickname = config.ownMerchantNickname ? config.ownMerchantNickname.trim().toLowerCase() : "";

    if (
      (cleanAdAdvNo && (cleanAdAdvNo === cleanBuyAdvNo || cleanAdAdvNo === cleanSellAdvNo)) ||
      (ownNickname && ad.merchant_name && ad.merchant_name.trim().toLowerCase() === ownNickname)
    ) {
      reasons.push({
        code: "OWN_AD",
        message: "Iklan milik sendiri (diabaikan dari daftar kompetitor)",
      });
    }

    // 0b. Filter Whitelist / Blacklist Merchant
    if (config.merchantFilterMode === "whitelist_only") {
      const isWhitelisted = (config.whitelistedMerchants || []).some(
        (w) => w && w.trim().toLowerCase() === ad.merchant_name.trim().toLowerCase(),
      );
      if (!isWhitelisted) {
        reasons.push({
          code: "NOT_IN_WHITELIST",
          message: "Merchant tidak ada di daftar Whitelist pilihan Anda",
        });
      }
    } else {
      if (config.blacklistedMerchants && config.blacklistedMerchants.length > 0) {
        const isBlacklisted = config.blacklistedMerchants.some(
          (b) => b && b.trim().toLowerCase() === ad.merchant_name.trim().toLowerCase(),
        );
        if (isBlacklisted) {
          reasons.push({
            code: "BLACKLISTED",
            message: "Merchant ada di daftar blacklist Anda",
          });
        }
      }
    }

    // 1. Filter Kapasitas USDT (Min & Max)
    const usdtAmount = ad.available_usdt || (ad.price > 0 ? ad.available_idr / ad.price : 0);
    if (config.minUsdtAmount > 0 && usdtAmount < config.minUsdtAmount) {
      reasons.push({
        code: "USDT_TOO_LOW",
        message: `Stok ${Math.round(usdtAmount)} USDT < min ${config.minUsdtAmount} USDT`,
      });
    }

    if (config.maxUsdtAmount > 0 && usdtAmount > config.maxUsdtAmount) {
      reasons.push({
        code: "USDT_TOO_HIGH",
        message: `Stok ${Math.round(usdtAmount)} USDT > batas maks ${config.maxUsdtAmount} USDT (Whale)`,
      });
    }

    // 2. Filter Batas Pesanan Minimal IDR (Toleransi Min Order Kompetitor)
    // Diskualifikasi hanya jika syarat transaksi minimal kompetitor melebihi batas toleransi
    if (config.minOrderLimitIdr > 0 && ad.min_limit_idr > config.minOrderLimitIdr) {
      reasons.push({
        code: "MIN_LIMIT_TOO_HIGH",
        message: `Min transaksi merchant Rp ${ad.min_limit_idr.toLocaleString("id-ID")} > batas filter Rp ${config.minOrderLimitIdr.toLocaleString("id-ID")} (pesanan jumbo)`,
      });
    }

    // 3. Filter Min Transaksi (harus mampu melayani order minimal nominal ini)
    if (config.minMaxLimitIdr > 0 && ad.max_limit_idr > 0 && ad.max_limit_idr < config.minMaxLimitIdr) {
      reasons.push({
        code: "MAX_LIMIT_TOO_LOW",
        message: `Kapasitas merchant Rp ${ad.max_limit_idr.toLocaleString("id-ID")} < target min transaksi Rp ${config.minMaxLimitIdr.toLocaleString("id-ID")}`,
      });
    }

    // 4. Filter Status Verifikasi & User Type
    if (config.verifiedOnly && !ad.is_verified) {
      reasons.push({
        code: "UNVERIFIED",
        message: "Bukan Verified Merchant",
      });
    }

    if (config.userTypeFilter === "merchant_only" && ad.user_type !== "merchant") {
      reasons.push({
        code: "USER_TYPE_MISMATCH",
        message: "Bukan akun PRO Merchant",
      });
    } else if (config.userTypeFilter === "user_only" && ad.user_type === "merchant") {
      reasons.push({
        code: "USER_TYPE_MISMATCH",
        message: "Akun PRO Merchant (Filter hanya target regular user)",
      });
    }

    // 4b. Filter Level Merchant (Gold, Silver, Bronze, Regular)
    if (
      config.allowedMerchantLevels &&
      Array.isArray(config.allowedMerchantLevels) &&
      config.allowedMerchantLevels.length > 0 &&
      config.allowedMerchantLevels.length < 4
    ) {
      const adLevel = ad.merchant_level ?? (ad.is_verified ? "bronze" : "regular");
      if (!config.allowedMerchantLevels.includes(adLevel)) {
        const levelLabels: Record<string, string> = {
          gold: "🥇 Gold",
          silver: "🥈 Silver",
          bronze: "🥉 Bronze",
          regular: "👤 Regular User",
        };
        reasons.push({
          code: "MERCHANT_LEVEL_FILTERED",
          message: `Level ${levelLabels[adLevel] || adLevel} tidak diikutsertakan dalam filter level`,
        });
      }
    }

    // 5. Filter Tingkat Penyelesaian (Completion Rate)
    const effectiveCompletionRate =
      ad.completion_rate !== null && Number.isFinite(ad.completion_rate)
        ? (ad.completion_rate <= 1.0 && ad.completion_rate > 0
            ? ad.completion_rate * 100
            : ad.completion_rate)
        : null;

    if (
      config.minCompletionRate > 0 &&
      effectiveCompletionRate !== null &&
      effectiveCompletionRate < config.minCompletionRate
    ) {
      reasons.push({
        code: "COMPLETION_RATE_LOW",
        message: `Rate ${effectiveCompletionRate.toFixed(1)}% < min ${config.minCompletionRate}%`,
      });
    }

    // 6. Filter Jumlah Order 30 Hari
    if (
      config.minMonthOrders > 0 &&
      ad.month_order_count !== null &&
      ad.month_order_count < config.minMonthOrders
    ) {
      reasons.push({
        code: "MONTH_ORDERS_LOW",
        message: `Order ${ad.month_order_count} < min ${config.minMonthOrders}`,
      });
    }

    // 7. Filter Tolak E-Wallet Saja (Hanya Transfer Bank)
    if (config.excludeEwallets && ad.pay_methods.length > 0) {
      const allMethodsAreEwallet = ad.pay_methods.every((pm) =>
        EWALLET_KEYWORDS.some((ew) => pm.toLowerCase().includes(ew)),
      );
      if (allMethodsAreEwallet) {
        reasons.push({
          code: "ONLY_EWALLET",
          message: "Hanya menyediakan e-wallet (tanpa rekening bank konvensional)",
        });
      }
    }

    // 8. Filter Metode Pembayaran Tertentu
    if (config.filterPaymentMethods && config.filterPaymentMethods.length > 0) {
      if (config.paymentMatchMode === "all") {
        const matchesAll = config.filterPaymentMethods.every((reqMethod) =>
          ad.pay_methods.some((m) => m.toLowerCase().includes(reqMethod.toLowerCase())),
        );
        if (!matchesAll) {
          reasons.push({
            code: "PAYMENT_METHOD_MISMATCH",
            message: `Tidak menyediakan seluruh metode wajib (${config.filterPaymentMethods.join(", ")})`,
          });
        }
      } else {
        const hasMethod = config.filterPaymentMethods.some((reqMethod) =>
          ad.pay_methods.some((m) => m.toLowerCase().includes(reqMethod.toLowerCase())),
        );
        if (!hasMethod) {
          reasons.push({
            code: "PAYMENT_METHOD_MISMATCH",
            message: `Tidak menerima salah satu dari ${config.filterPaymentMethods.join("/")}`,
          });
        }
      }
    }

    // 9. Filter Rentang Harga Pasar Absolut (Bounds)
    if (config.minPriceBoundRp > 0 && ad.price < config.minPriceBoundRp) {
      reasons.push({
        code: "PRICE_OUT_OF_BOUNDS",
        message: `Harga Rp ${ad.price.toLocaleString("id-ID")} < batas min Rp ${config.minPriceBoundRp.toLocaleString("id-ID")}`,
      });
    }
    if (config.maxPriceBoundRp > 0 && ad.price > config.maxPriceBoundRp) {
      reasons.push({
        code: "PRICE_OUT_OF_BOUNDS",
        message: `Harga Rp ${ad.price.toLocaleString("id-ID")} > batas maks Rp ${config.maxPriceBoundRp.toLocaleString("id-ID")}`,
      });
    }

    // 10. Filter Anti-Spoofing / Outlier Spike
    if (config.ignoreOutlierSpikes && sortedAds.length >= 2) {
      const adIndex = sortedAds.indexOf(ad);
      if (adIndex >= 0 && adIndex < sortedAds.length - 1) {
        const nextAd = sortedAds[adIndex + 1];
        if (nextAd) {
          const gap = Math.abs(ad.price - nextAd.price);
          if (gap >= (config.maxOutlierGapRp || 40)) {
            reasons.push({
              code: "PRICE_OUTLIER",
              message: `Selisih Rp ${gap} dari rank berikutnya (indikasi pancingan/spoofing)`,
            });
          }
        }
      }
    }

    const isQualified = reasons.length === 0;
    if (isQualified) {
      qualified.push(ad);
      evaluated.push({
        ad,
        isQualified: true,
        disqualificationReasons: [],
        qualifiedRank: currentRank++,
      });
    } else {
      evaluated.push({
        ad,
        isQualified: false,
        disqualificationReasons: reasons,
      });
    }
  }

  return { qualified, evaluated };
}

/**
 * Menghitung harga jual dan beli optimal berdasarkan merchant acuan yang lolos filter
 * serta menguji dan menerapkan Safety Boundaries (Floor & Ceiling).
 */
export function computeCompetitorPricing(input: {
  sellRefAds: Ad[]; // Iklan kompetitor jual USDT (acuan iklan jual kita)
  buyRefAds: Ad[];  // Iklan kompetitor beli USDT (acuan iklan beli kita)
  config: CompetitorFilterConfig;
  stockHpp: number; // Harga modal stok riil dari PnL / portfolio
  fairPrice: number; // Nilai wajar pasar P2P saat ini
  bankBalanceIdr?: number; // Sisa uang di bank (kas modal PnL atau saldo verifier)
  initialCapitalIdr?: number; // Total modal awal yang dimasukkan pengguna
  liveStockUsdt?: number;     // Jumlah stok USDT live saat ini di akun (Funding Wallet / open position)
  stockCapitalIdr?: number;   // Nilai modal yang sedang terikat di stok USDT
  fallbackSellPrice?: number;
  fallbackBuyPrice?: number;
  activeBuyOrdersUsdt?: number; // Jumlah stok USDT yang sedang aktif/berjalan di orderan beli Binance P2P
  activeBuyOrdersIdr?: number;  // Total nilai rupiah yang sedang terkunci oleh orderan beli aktif
}): CompetitorPricingResult {
  const {
    sellRefAds = [],
    buyRefAds = [],
    config,
    stockHpp = 0,
    fairPrice = 0,
    bankBalanceIdr = 0,
    initialCapitalIdr = 0,
    liveStockUsdt = 0,
    stockCapitalIdr,
    fallbackSellPrice,
    fallbackBuyPrice,
    activeBuyOrdersUsdt = 0,
    activeBuyOrdersIdr = 0,
  } = input;

  // 0. Tentukan Live Market Anchor dinamis dari data pasar riil saat ini (~17.800+)
  // Kumpulkan semua sampel harga pasar yang tersedia (fairPrice, harga iklan buy, harga iklan sell, HPP)
  const candidatePrices: number[] = [];
  if (fairPrice && fairPrice > 10_000) candidatePrices.push(fairPrice);

  if (Array.isArray(buyRefAds) && buyRefAds.length > 0) {
    const validBuy = buyRefAds.map((a) => a.price).filter((p) => p > 10_000);
    if (validBuy.length > 0) candidatePrices.push(validBuy[0]);
  }
  if (Array.isArray(sellRefAds) && sellRefAds.length > 0) {
    const validSell = sellRefAds.map((a) => a.price).filter((p) => p > 10_000);
    if (validSell.length > 0) candidatePrices.push(validSell[0]);
  }
  if (stockHpp && stockHpp > 10_000) candidatePrices.push(stockHpp);

  // Jika tidak ada data harga sama sekali, gunakan acuan pasar wajar saat ini (~17.800), bukan nilai usang 16.200
  const liveMarketAnchor = candidatePrices.length > 0
    ? Math.round(candidatePrices.reduce((a, b) => a + b, 0) / candidatePrices.length)
    : 17_800;

  const minSpread = Math.max(10, config.minSpreadRp || 25);
  const halfSpread = Math.max(5, Math.round(minSpread / 2));

  // Dynamic fallback: JANGAN PERNAH gunakan angka kuno (< 17.000)
  const resolvedFallbackSell = (fallbackSellPrice && fallbackSellPrice >= 17_000)
    ? fallbackSellPrice
    : (liveMarketAnchor + halfSpread);

  const resolvedFallbackBuy = (fallbackBuyPrice && fallbackBuyPrice >= 17_000)
    ? fallbackBuyPrice
    : (liveMarketAnchor - halfSpread);

  // 1. Evaluasi dan Filter Merchant Kompetitor Jual & Beli
  const { qualified: qualifiedSell, evaluated: evaluatedSell } = evaluateCompetitorAds(
    sellRefAds,
    config,
    "sell_ref",
  );
  const { qualified: qualifiedBuy, evaluated: evaluatedBuy } = evaluateCompetitorAds(
    buyRefAds,
    config,
    "buy_ref",
  );

  // 2. Pilih Target Merchant Sesuai Peringkat atau Agregasi Top N
  const sellRankIdx = Math.min(Math.max(config.targetRank - 1, 0), Math.max(qualifiedSell.length - 1, 0));
  const buyRankIdx = Math.min(Math.max(config.targetRank - 1, 0), Math.max(qualifiedBuy.length - 1, 0));

  const sellTargetMerchant = qualifiedSell[sellRankIdx] ?? null;
  const buyTargetMerchant = qualifiedBuy[buyRankIdx] ?? null;

  const topNCount = Math.max(2, config.targetTopCount || 3);

  // Helper cek apakah iklan milik sendiri
  const cleanBuyAdvNo = config.merchantBuyAdvNo ? config.merchantBuyAdvNo.trim().replace(/^#/, "") : "";
  const cleanSellAdvNo = config.merchantSellAdvNo ? config.merchantSellAdvNo.trim().replace(/^#/, "") : "";
  const ownNickname = config.ownMerchantNickname ? config.ownMerchantNickname.trim().toLowerCase() : "";

  const isOwnAd = (ad: Ad) => {
    const cleanAdAdvNo = ad.adv_no ? String(ad.adv_no).trim().replace(/^#/, "") : "";
    if (cleanAdAdvNo && (cleanAdAdvNo === cleanBuyAdvNo || cleanAdAdvNo === cleanSellAdvNo)) return true;
    if (ownNickname && ad.merchant_name && ad.merchant_name.trim().toLowerCase() === ownNickname) return true;
    return false;
  };

  // ── Hitung Batas Pengaman JUAL (Sell Floor Guard) & BELI (Buy Ceiling Guard) di Awal ──
  const MAKER_FEE_RATE = 0.0005;
  const effectiveHpp = stockHpp > 0
    ? stockHpp
    : (fairPrice > 0 ? fairPrice : liveMarketAnchor);

  // Floor Jual: HPP + Fee Jual + Target Minimal Laba Bersih
  const autoSellFloor = Math.round(
    (effectiveHpp + (config.minProfitMarginRp || 10)) / (1 - MAKER_FEE_RATE)
  );

  const calculatedSellFloor = Math.round(
    config.sellFloorMode === "manual" && config.manualSellFloorRp > 0
      ? config.manualSellFloorRp
      : autoSellFloor
  );

  const calculatedBuyCeiling = Math.round(
    config.buyCeilingMode === "auto_fair"
      ? (fairPrice > 0 ? fairPrice - config.minSpreadRp : liveMarketAnchor - config.minSpreadRp)
      : (config.manualBuyCeilingRp > 0 ? config.manualBuyCeilingRp : 999_999)
  );

  const calculatedBuyFloor = Math.round(
    config.manualBuyFloorRp && config.manualBuyFloorRp > 0 ? config.manualBuyFloorRp : 0
  );

  // Helper kalkulasi harga acuan dasar berdasarkan targetMode
  const computeBasePrice = (
    side: "sell" | "buy",
    qualifiedAds: Ad[],
    allRawAds: Ad[],
    singleTarget: Ad | null,
    fallback: number,
  ): { basePrice: number; desc: string; isFallback: boolean } => {
    if (qualifiedAds.length === 0) {
      if (side === "sell") {
        // Pada sisi JUAL: Jika TIDAK ADA kompetitor yang lolos filter:
        // JANGAN PERNAH mengambil iklan paling bawah/murah di pasar (nonOwnAds[0]) yang memicu dump harga ke bawah!
        // Cari apakah ada iklan kompetitor non-milik sendiri di orderbook yang harganya >= Batas Bawah (Floor HPP):
        const nonOwnSafeAds = (allRawAds || []).filter(
          (a) => !isOwnAd(a) && a.price >= calculatedSellFloor
        );

        if (nonOwnSafeAds.length > 0) {
          const safeTarget = nonOwnSafeAds[0];
          const rawIndex = allRawAds.indexOf(safeTarget) + 1;
          return {
            basePrice: safeTarget.price,
            desc: `Relaksasi Aman (≥ Floor): #${rawIndex} (${safeTarget.merchant_name} @ Rp ${safeTarget.price.toLocaleString("id-ID")})`,
            isFallback: false,
          };
        }

        // Jika semua kompetitor di pasar berada di bawah batas modal Floor atau tidak ada iklan:
        // KUNCI LANGSUNG di batas aman Batas Bawah Floor HPP:
        const safeFloorPrice = Math.max(calculatedSellFloor, fallback);
        return {
          basePrice: safeFloorPrice,
          desc: `Terkunci Aman di Batas Bawah Floor HPP (Rp ${safeFloorPrice.toLocaleString("id-ID")}) [Tidak ada kompetitor lolos filter]`,
          isFallback: true,
        };
      } else {
        // Pada sisi BELI: Jika tidak ada yang lolos filter:
        // JANGAN PERNAH mengambil iklan paling mahal di pucuk!
        // Cari iklan non-milik sendiri yang harganya <= Batas Atas Ceiling beli:
        const nonOwnSafeAds = (allRawAds || []).filter(
          (a) => !isOwnAd(a) && (calculatedBuyCeiling <= 0 || a.price <= calculatedBuyCeiling)
        );

        if (nonOwnSafeAds.length > 0) {
          const safeTarget = nonOwnSafeAds[0];
          const rawIndex = allRawAds.indexOf(safeTarget) + 1;
          return {
            basePrice: safeTarget.price,
            desc: `Relaksasi Aman (≤ Ceiling): #${rawIndex} (${safeTarget.merchant_name} @ Rp ${safeTarget.price.toLocaleString("id-ID")})`,
            isFallback: false,
          };
        }

        const safeCeilingPrice = calculatedBuyCeiling > 0 ? Math.min(calculatedBuyCeiling, fallback) : fallback;
        return {
          basePrice: safeCeilingPrice,
          desc: `Terkunci Aman di Batas Atas Ceiling (Rp ${safeCeilingPrice.toLocaleString("id-ID")}) [Tidak ada kompetitor lolos filter]`,
          isFallback: true,
        };
      }
    }

    if (config.targetMode === "average_top") {
      const pool = qualifiedAds.slice(0, Math.min(topNCount, qualifiedAds.length));
      const avg = Math.round(pool.reduce((sum, a) => sum + a.price, 0) / pool.length);
      return {
        basePrice: avg,
        desc: `Rata-rata Top ${pool.length} Kompetitor (Rp ${avg.toLocaleString("id-ID")})`,
        isFallback: false,
      };
    }

    if (config.targetMode === "median_top") {
      const pool = qualifiedAds.slice(0, Math.min(topNCount, qualifiedAds.length));
      const sortedPrices = [...pool].map((a) => a.price).sort((a, b) => a - b);
      const mid = Math.floor(sortedPrices.length / 2);
      const median =
        sortedPrices.length % 2 !== 0
          ? sortedPrices[mid]
          : Math.round((sortedPrices[mid - 1] + sortedPrices[mid]) / 2);
      return {
        basePrice: median,
        desc: `Median Top ${pool.length} Kompetitor (Rp ${median.toLocaleString("id-ID")})`,
        isFallback: false,
      };
    }

    // Default: Mode "rank"
    return {
      basePrice: singleTarget ? singleTarget.price : fallback,
      desc: `Rank #${config.targetRank} (${singleTarget?.merchant_name || "N/A"})`,
      isFallback: !singleTarget,
    };
  };

  const sellBase = computeBasePrice("sell", qualifiedSell, sellRefAds, sellTargetMerchant, resolvedFallbackSell);
  const buyBase = computeBasePrice("buy", qualifiedBuy, buyRefAds, buyTargetMerchant, resolvedFallbackBuy);

  // 3. Hitung Harga Mentah (Raw Price) dengan Offset
  // Untuk JUAL: jangan biarkan rawSellPrice tembus ke bawah calculatedSellFloor
  let rawSellPrice = sellBase.isFallback
    ? Math.max(calculatedSellFloor, sellBase.basePrice)
    : Math.max(calculatedSellFloor, sellBase.basePrice + config.sellOffsetRp);

  // Untuk BELI: base price + buyOffsetRp (misal +1 overcut)
  let rawBuyPrice = buyBase.basePrice + config.buyOffsetRp;

  const autoFollow = config.autoFollowNextWhenLimitReached !== false;

  let activeSellTargetMerchant = sellTargetMerchant;
  let activeSellRankUsed = sellTargetMerchant ? sellRankIdx + 1 : 0;
  let activeSellDesc = sellBase.desc;

  const sellGuard: CompetitorPricingResult["sellGuard"] = {
    triggered: false,
    floorPrice: calculatedSellFloor,
  };

  let recommendedSellPrice = rawSellPrice;

  // Cek jika pengguna menetapkan override harga jual tetap manual
  if (config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0) {
    recommendedSellPrice = Math.max(calculatedSellFloor, Math.round(config.manualSellPriceOverrideRp));
  }

  if (recommendedSellPrice < calculatedSellFloor) {
    sellGuard.triggered = true;

    // FITUR: Auto-Follow Iklan Jual Lain di Atas Floor Modal
    if (autoFollow && qualifiedSell.length > 0) {
      let candidateSell: Ad | null = null;
      let candidateRank = 0;

      for (let i = 0; i < qualifiedSell.length; i++) {
        const adCandidate = qualifiedSell[i];
        if (!adCandidate) continue;
        if (adCandidate.price + config.sellOffsetRp >= calculatedSellFloor) {
          candidateSell = adCandidate;
          candidateRank = i + 1;
          break;
        }
      }

      if (candidateSell) {
        activeSellTargetMerchant = candidateSell;
        activeSellRankUsed = candidateRank;
        recommendedSellPrice = Math.max(calculatedSellFloor, candidateSell.price + config.sellOffsetRp);
        activeSellDesc = `Rank #${candidateRank} (${candidateSell.merchant_name}) [Otomatis alih target: batas Floor modal Rp ${calculatedSellFloor.toLocaleString("id-ID")} tercapai]`;
        sellGuard.autoSwitched = true;
        sellGuard.switchedToRank = candidateRank;
        sellGuard.reason = `Batas Bawah Modal Terpenuhi: Target Rank #${sellRankIdx + 1} di bawah batas modal (Floor Rp ${calculatedSellFloor.toLocaleString("id-ID")}). Bot otomatis beralih mengikuti iklan lain: Rank #${candidateRank} (@${candidateSell.merchant_name} - Rp ${candidateSell.price.toLocaleString("id-ID")}). Rekomendasi: Rp ${recommendedSellPrice.toLocaleString("id-ID")}.`;
      } else {
        recommendedSellPrice = calculatedSellFloor;
        sellGuard.reason = `Semua iklan kompetitor (${qualifiedSell.length} iklan) menjual di bawah modal Floor (Rp ${calculatedSellFloor.toLocaleString("id-ID")}). Harga dikunci di batas Floor modal.`;
      }
    } else {
      sellGuard.reason = `Harga pasar (Rp ${rawSellPrice.toLocaleString("id-ID")}) di bawah batas aman modal (Floor Rp ${calculatedSellFloor.toLocaleString("id-ID")}). Harga dikunci di batas Floor.`;
      recommendedSellPrice = calculatedSellFloor;
    }
  }

  // 5. Hitung dan Terapkan Batas Pengaman BELI (Buy Ceiling & Floor Guard)
  // Ceiling Beli (Batas Atas): Mencegah beli kemahalan di pucuk yang mengikis spread minimal terhadap harga jual
  const calculatedBuyCeiling = Math.round(
    config.buyCeilingMode === "auto_fair"
      ? (rawSellPrice > 0 ? rawSellPrice - config.minSpreadRp : (fairPrice > 0 ? fairPrice : liveMarketAnchor))
      : (config.manualBuyCeilingRp > 0 ? config.manualBuyCeilingRp : 999_999),
  );

  const calculatedBuyFloor = Math.round(
    config.manualBuyFloorRp && config.manualBuyFloorRp > 0 ? config.manualBuyFloorRp : 0
  );

  let activeBuyTargetMerchant = buyTargetMerchant;
  let activeBuyRankUsed = buyTargetMerchant ? buyRankIdx + 1 : 0;
  let activeBuyDesc = buyBase.desc;

  const buyGuard: CompetitorPricingResult["buyGuard"] = {
    triggered: false,
    ceilingPrice: calculatedBuyCeiling,
    floorPrice: calculatedBuyFloor,
  };

  let recommendedBuyPrice = rawBuyPrice;

  // Cek Batas Atas (Ceiling Guard)
  // FITUR: Auto-Follow Iklan Lain Saat Batas Atas Beli Tercapai
  // Jika harga beli melampaui batas atas (ceiling), bot otomatis mencari dan mengikuti
  // iklan kompetitor lain di bawah limit atas (bukan cuma diam terkunci di ceiling).
  if (calculatedBuyCeiling > 0 && recommendedBuyPrice > calculatedBuyCeiling) {
    buyGuard.triggered = true;

    if (autoFollow && qualifiedBuy.length > 0) {
      let candidateBuy: Ad | null = null;
      let candidateRank = 0;

      // Prioritas 1: Cari iklan kompetitor di mana (harga + offset) <= limit atas (ceiling)
      for (let i = 0; i < qualifiedBuy.length; i++) {
        const adCandidate = qualifiedBuy[i];
        if (!adCandidate) continue;
        if (adCandidate.price + config.buyOffsetRp <= calculatedBuyCeiling) {
          candidateBuy = adCandidate;
          candidateRank = i + 1;
          break;
        }
      }

      // Prioritas 2: Jika tidak ada yang + offset <= ceiling, cari iklan yang harga dasarnya <= ceiling
      if (!candidateBuy) {
        for (let i = 0; i < qualifiedBuy.length; i++) {
          const adCandidate = qualifiedBuy[i];
          if (!adCandidate) continue;
          if (adCandidate.price <= calculatedBuyCeiling) {
            candidateBuy = adCandidate;
            candidateRank = i + 1;
            break;
          }
        }
      }

      if (candidateBuy) {
        activeBuyTargetMerchant = candidateBuy;
        activeBuyRankUsed = candidateRank;
        const targetPriceWithOffset = candidateBuy.price + config.buyOffsetRp;
        recommendedBuyPrice = Math.min(calculatedBuyCeiling, targetPriceWithOffset);
        activeBuyDesc = `Rank #${candidateRank} (${candidateBuy.merchant_name}) [Otomatis alih target: batas atas Rp ${calculatedBuyCeiling.toLocaleString("id-ID")} tercapai]`;
        buyGuard.autoSwitched = true;
        buyGuard.switchedToRank = candidateRank;
        buyGuard.reason = `Batas Atas Terpenuhi: Target Rank #${buyRankIdx + 1} melampaui limit atas (Ceiling Rp ${calculatedBuyCeiling.toLocaleString("id-ID")}). Bot otomatis beralih mengikuti iklan lain di bawah limit: Rank #${candidateRank} (@${candidateBuy.merchant_name} - Rp ${candidateBuy.price.toLocaleString("id-ID")}). Rekomendasi: Rp ${recommendedBuyPrice.toLocaleString("id-ID")}.`;
      } else {
        // Semua iklan kompetitor di pasar berada di atas limit atas
        recommendedBuyPrice = calculatedBuyCeiling;
        buyGuard.reason = `Semua iklan kompetitor (${qualifiedBuy.length} iklan) berada di atas limit atas (Rp ${calculatedBuyCeiling.toLocaleString("id-ID")}). Harga dipatok di limit atas Rp ${calculatedBuyCeiling.toLocaleString("id-ID")} menunggu kompetitor lain muncul di bawah limit.`;
      }
    } else {
      buyGuard.reason = `Harga pasar (Rp ${rawBuyPrice.toLocaleString("id-ID")}) di atas batas atas wajar (Ceiling Rp ${calculatedBuyCeiling.toLocaleString("id-ID")}). Harga dikunci di batas Ceiling.`;
      recommendedBuyPrice = calculatedBuyCeiling;
    }
  }

  // Cek jika pengguna menetapkan override harga beli tetap manual
  if (config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0) {
    recommendedBuyPrice = Math.round(config.manualBuyPriceOverrideRp);
  }

  // Cek Batas Bawah (Floor Guard)
  if (calculatedBuyFloor > 0 && recommendedBuyPrice < calculatedBuyFloor) {
    buyGuard.triggered = true;
    buyGuard.reason = `Harga pasar (Rp ${rawBuyPrice.toLocaleString("id-ID")}) di bawah batas minimal beli yang ditentukan (Floor Rp ${calculatedBuyFloor.toLocaleString("id-ID")}). Harga dikunci di batas Floor.`;
    recommendedBuyPrice = calculatedBuyFloor;
  }

  // 6. Validasi Minimum Spread Guard (Pastikan Jual - Beli >= Min Spread)
  if (recommendedSellPrice - recommendedBuyPrice < config.minSpreadRp) {
    const sellIsFallback = sellBase.isFallback;
    const buyIsFallback = buyBase.isFallback;

    if (sellIsFallback && !buyIsFallback) {
      // Sisi Jual tidak memiliki kompetitor riil (fallback), sedangkan sisi Beli riil ada kompetitor valid.
      // JANGAN rusak harga beli riil! Sesuaikan harga jual ke atas agar spread terpenuhi:
      recommendedSellPrice = Math.max(calculatedSellFloor, Math.round(recommendedBuyPrice + config.minSpreadRp));
    } else if (!sellIsFallback && buyIsFallback) {
      // Sisi Beli tidak memiliki kompetitor riil (fallback), sedangkan sisi Jual riil ada kompetitor valid.
      // Sesuaikan harga beli ke bawah dari harga jual riil:
      const adjustedBuyPrice = Math.round(recommendedSellPrice - config.minSpreadRp);
      recommendedBuyPrice = calculatedBuyFloor > 0 ? Math.max(calculatedBuyFloor, adjustedBuyPrice) : adjustedBuyPrice;
    } else {
      // Keduanya kompetitor riil, atau keduanya fallback.
      // Coba turunkan harga beli selama tidak menembus floor beli
      const adjustedBuyPrice = Math.round(recommendedSellPrice - config.minSpreadRp);
      if (calculatedBuyFloor > 0 && adjustedBuyPrice < calculatedBuyFloor) {
        recommendedBuyPrice = calculatedBuyFloor;
        recommendedSellPrice = Math.max(calculatedSellFloor, Math.round(recommendedBuyPrice + config.minSpreadRp));
      } else {
        recommendedBuyPrice = adjustedBuyPrice;
      }
    }
  }

  // ── FINAL SAFEGUARD: HARGA JUAL MUTLAK TIDAK BOLEH DI BAWAH BATAS BAWAH (FLOOR HPP) ──
  if (calculatedSellFloor > 0 && recommendedSellPrice < calculatedSellFloor) {
    recommendedSellPrice = calculatedSellFloor;
    sellGuard.triggered = true;
    sellGuard.reason = `Proteksi Mutlak Batas Bawah: Harga terkunci di Batas Bawah Floor HPP (Rp ${calculatedSellFloor.toLocaleString("id-ID")}) agar bot tidak menjual di bawah modal.`;
  }

  // 7. Kalkulasi Fee & Estimasi Laba Bersih
  const makerFeeSellPerUsdt = Math.round(recommendedSellPrice * MAKER_FEE_RATE * 100) / 100;
  const makerFeeBuyPerUsdt = Math.round(recommendedBuyPrice * MAKER_FEE_RATE * 100) / 100;
  const netSellProceeds = recommendedSellPrice - makerFeeSellPerUsdt;
  const netBuyCost = recommendedBuyPrice + makerFeeBuyPerUsdt;

  const spreadAbs = Math.round(recommendedSellPrice - recommendedBuyPrice);
  const spreadPct = recommendedBuyPrice > 0 ? (spreadAbs / recommendedBuyPrice) * 100 : 0;
  const estimatedNetProfitPerUsdt = Math.round((netSellProceeds - netBuyCost) * 100) / 100;

  // 8. Kalkulasi Alokasi Stok Beli Otomatis Sesuai Sisa Uang di Bank & Live Stock USDT
  const liveStock = Math.max(0, liveStockUsdt);
  const effectiveValuationPerUsdt =
    stockHpp > 0
      ? stockHpp
      : (fairPrice > 0 ? fairPrice : (recommendedBuyPrice > 0 ? recommendedBuyPrice : liveMarketAnchor));

  const stockCapitalValuationIdr =
    stockCapitalIdr !== undefined && stockCapitalIdr > 0
      ? stockCapitalIdr
      : Math.round(liveStock * effectiveValuationPerUsdt);

  // Tentukan Total Modal Awal / Budget
  const totalModalAwalIdr = initialCapitalIdr > 0 ? initialCapitalIdr : 180_000_000;
  let baseBudgetIdr = totalModalAwalIdr;

  // Hitung Sisa Modal Kas Siap Beli (Remaining Budget)
  let remainingBudgetBeforeAllocation = 0;

  if (config.bankBalanceSource === "manual") {
    // Mode Manual: murni pakai input manual user
    remainingBudgetBeforeAllocation = Math.max(0, config.manualBankBalanceIdr || 0);
    baseBudgetIdr = config.manualBankBalanceIdr > 0 ? config.manualBankBalanceIdr : totalModalAwalIdr;
  } else {
    // Mode Auto:
    // 1. Jika bankBalanceIdr diteruskan secara numerik (baik 0 maupun positif):
    if (typeof bankBalanceIdr === "number") {
      remainingBudgetBeforeAllocation = Math.max(0, bankBalanceIdr);
      baseBudgetIdr = totalModalAwalIdr;
    } else {
      // 2. Jika bankBalanceIdr tidak diteruskan, hitung dari modal awal dikurangi valuasi stok live
      const deductedStock = config.deductLiveStockFromBudget !== false ? stockCapitalValuationIdr : 0;
      remainingBudgetBeforeAllocation = Math.max(0, totalModalAwalIdr - deductedStock);
      baseBudgetIdr = totalModalAwalIdr;
    }
  }

  // OTOMATISASI ORDER BUY MASUK:
  // Potong kas modal yang siap dibelanjakan dengan total orderan beli aktif yang sedang berjalan di Binance!
  const lockedActiveBuyIdr =
    activeBuyOrdersIdr && activeBuyOrdersIdr > 0
      ? activeBuyOrdersIdr
      : (activeBuyOrdersUsdt && activeBuyOrdersUsdt > 0 && recommendedBuyPrice > 0
        ? Math.round(activeBuyOrdersUsdt * recommendedBuyPrice)
        : 0);

  const remainingBudgetAfterActiveOrders = Math.max(0, remainingBudgetBeforeAllocation - lockedActiveBuyIdr);

  const bankAllocationFraction = Math.min(100, Math.max(1, config.bankAllocationPct || 100)) / 100;
  const usableBankIdr = Math.max(
    0,
    (remainingBudgetAfterActiveOrders - (config.bankReserveBufferIdr || 0)) * bankAllocationFraction,
  );

  // Batas minimal transaksi beli (default Rp 50 Juta)
  const minBuyLimitIdr = config.manualBuyMinLimitIdr && config.manualBuyMinLimitIdr > 0
    ? config.manualBuyMinLimitIdr
    : 50_000_000;

  // Proteksi: Jika sisa kas kurang dari batas minimal transaksi (misal kas tersisa < Rp 50 Juta),
  // maka stok beli otomatis menjadi 0 agar bot TIDAK otomatis memasang iklan beli lagi!
  const isBelowMinLimit = usableBankIdr < minBuyLimitIdr;

  const autoBuyStockUsdt =
    !isBelowMinLimit && recommendedBuyPrice > 0 && usableBankIdr > 0
      ? Math.floor((usableBankIdr / recommendedBuyPrice) * 100) / 100
      : 0;

  const autoBuyMaxLimitIdr = isBelowMinLimit || usableBankIdr <= 0 ? 0 : Math.round(usableBankIdr);

  const bankAllocation = {
    totalBudgetIdr: baseBudgetIdr,
    liveStockUsdt: liveStock,
    stockCapitalValuationIdr,
    effectiveBankBalance: remainingBudgetBeforeAllocation,
    lockedActiveBuyIdr,
    activeBuyOrdersUsdt,
    usableBankIdr,
    autoBuyStockUsdt,
    autoBuyMaxLimitIdr,
    isBelowMinLimit,
    minBuyLimitIdr,
    isSynced: Boolean(config.autoSyncBuyStockWithBank && usableBankIdr > 0 && !isBelowMinLimit),
  };

  return {
    recommendedSellPrice,
    recommendedBuyPrice,
    rawSellPrice,
    rawBuyPrice,
    sellTargetMerchant: activeSellTargetMerchant,
    buyTargetMerchant: activeBuyTargetMerchant,
    sellRankUsed: activeSellRankUsed,
    buyRankUsed: activeBuyRankUsed,
    targetMethodDescription: {
      sell: activeSellDesc,
      buy: activeBuyDesc,
    },
    qualifiedSellAds: qualifiedSell,
    evaluatedSellAds: evaluatedSell,
    qualifiedBuyAds: qualifiedBuy,
    evaluatedBuyAds: evaluatedBuy,
    sellGuard,
    buyGuard,
    spreadAbs,
    spreadPct,
    makerFeeSellPerUsdt,
    makerFeeBuyPerUsdt,
    effectiveHpp,
    estimatedNetProfitPerUsdt,
    bankAllocation,
  };
}

const STORAGE_KEY = "binance_p2p_competitor_bot_config";

export function loadBotConfig(): CompetitorFilterConfig {
  if (typeof window === "undefined") return DEFAULT_BOT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BOT_CONFIG;
    const parsed = JSON.parse(raw);
    const merged: CompetitorFilterConfig = { ...DEFAULT_BOT_CONFIG, ...parsed };
    if (!Array.isArray(merged.filterPaymentMethods)) merged.filterPaymentMethods = [];
    if (!Array.isArray(merged.blacklistedMerchants)) merged.blacklistedMerchants = [];
    if (!Array.isArray(merged.whitelistedMerchants)) merged.whitelistedMerchants = [];
    if (!merged.targetMode) merged.targetMode = "rank";
    if (!merged.merchantFilterMode) merged.merchantFilterMode = "all_except_blacklist";
    if (!merged.paymentMatchMode) merged.paymentMatchMode = "any";
    if (typeof merged.excludeEwallets !== "boolean") merged.excludeEwallets = false;
    if (!Array.isArray(merged.allowedMerchantLevels) || merged.allowedMerchantLevels.length === 0) {
      merged.allowedMerchantLevels = ["gold", "silver", "bronze", "regular"];
    }
    if (typeof merged.scanAdLimit !== "number" || merged.scanAdLimit <= 0) {
      merged.scanAdLimit = 100;
    }
    // Perbaikan: minOrderLimitIdr adalah batas toleransi filter kompetitor (0 = Bebas).
    // Jika sebelumnya terkena migrasi 50 Juta keliru, reset kembali ke 0 agar tidak mendiskualifikasi kompetitor
    const hasFixedMinOrderFilter = localStorage.getItem("binance_bot_fixed_min_order_filter_v3");
    if (!hasFixedMinOrderFilter) {
      if (merged.minOrderLimitIdr === 50_000_000 || merged.minOrderLimitIdr === 500_000) {
        merged.minOrderLimitIdr = 0;
      }
      localStorage.setItem("binance_bot_fixed_min_order_filter_v3", "true");
      saveBotConfig(merged);
    }
    if (typeof merged.autoSyncBuyStockWithBank !== "boolean") merged.autoSyncBuyStockWithBank = true;
    if (!merged.bankBalanceSource) merged.bankBalanceSource = "auto";
    if (typeof merged.manualBankBalanceIdr !== "number") merged.manualBankBalanceIdr = 0;
    if (typeof merged.bankAllocationPct !== "number") merged.bankAllocationPct = 100;
    if (typeof merged.bankReserveBufferIdr !== "number") merged.bankReserveBufferIdr = 0;
    if (typeof merged.deductLiveStockFromBudget !== "boolean") merged.deductLiveStockFromBudget = true;
    if (typeof merged.merchantBuyAdvNo !== "string") merged.merchantBuyAdvNo = "";
    if (typeof merged.merchantSellAdvNo !== "string") merged.merchantSellAdvNo = "";
    if (typeof merged.manualBuyStockUsdt !== "number") merged.manualBuyStockUsdt = 0;
    if (typeof merged.manualBuyMinLimitIdr !== "number" || merged.manualBuyMinLimitIdr <= 0) merged.manualBuyMinLimitIdr = 50_000_000;
    if (typeof merged.manualBuyMaxLimitIdr !== "number" || merged.manualBuyMaxLimitIdr <= 0) merged.manualBuyMaxLimitIdr = 500_000_000;
    if (typeof merged.manualSellStockUsdt !== "number") merged.manualSellStockUsdt = 0;
    if (typeof merged.manualSellMinLimitIdr !== "number") merged.manualSellMinLimitIdr = 0;
    if (typeof merged.manualSellMaxLimitIdr !== "number") merged.manualSellMaxLimitIdr = 0;
    if (typeof merged.manualSellPriceOverrideRp !== "number") merged.manualSellPriceOverrideRp = 0;
    if (!merged.buyFloorMode) merged.buyFloorMode = "disabled";
    if (typeof merged.manualBuyFloorRp !== "number") merged.manualBuyFloorRp = 0;
    if (typeof merged.manualBuyPriceOverrideRp !== "number") merged.manualBuyPriceOverrideRp = 0;
    if (typeof merged.autoPushToBinance !== "boolean") merged.autoPushToBinance = false;
    if (typeof merged.autoPushMinIntervalSec !== "number" || merged.autoPushMinIntervalSec < 1) merged.autoPushMinIntervalSec = 1;
    if (typeof merged.autoFollowNextWhenLimitReached !== "boolean") merged.autoFollowNextWhenLimitReached = true;
    if (typeof merged.ownMerchantNickname !== "string") merged.ownMerchantNickname = "";
    return merged;
  } catch {
    return DEFAULT_BOT_CONFIG;
  }
}

export function saveBotConfig(config: CompetitorFilterConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Abaikan
  }
}

