/**
 * Modul Analisis & Bot Auto-Pricing P2P Binance.
 * Strategi: Filtered Competitor Following dengan Safety Boundaries (Floor, Ceiling, Min Spread).
 */

import { type Ad } from "./p2p-engine";

export const MAKER_FEE_RATE = 0.0005; // 0.05% fee pembuat iklan (maker) di Binance P2P IDR

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
  blacklistedMerchants: string[]; // Daftar nama merchant yang diabaikan/di-blacklist (global fallback)
  whitelistedMerchants: string[]; // Daftar nama merchant yang diizinkan (jika mode whitelist) (global fallback)
  blacklistedSellMerchants?: string[]; // Blacklist khusus acuan Iklan Jual (sell_ref)
  blacklistedBuyMerchants?: string[];  // Blacklist khusus acuan Iklan Beli (buy_ref)
  whitelistedSellMerchants?: string[]; // Whitelist khusus acuan Iklan Jual (sell_ref)
  whitelistedBuyMerchants?: string[];  // Whitelist khusus acuan Iklan Beli (buy_ref)

  // ── Anti-Spoofing & Rentang Harga Pasar Absolut ───────────────────────────
  ignoreOutlierSpikes: boolean;   // Abaikan harga pancingan yang melompat ekstrem dari klaster pasar
  maxOutlierGapRp: number;        // Batas selisih lonjakan harga ekstrem (default: 40 Rp)
  buyGapTrapEnabled: boolean;     // Filter Anti-Pancingan Pucuk Beli (Gap Trap): abaikan Rank 1 jika melonjak >= threshold dari Rank 2
  buyGapTrapThresholdRp: number;  // Batas toleransi lonjakan gap beli dari rank di bawahnya (default: 20 Rp)
  spotDumpProtectionEnabled: boolean; // Proteksi Dump Pasar Spot (Indodax Spot Lead-Indicator): tahan harga beli jika melebihi spot Indodax + buffer
  spotDumpBufferRp: number;       // Toleransi buffer di atas harga spot Indodax (default: 15 Rp)
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
  blacklistedSellMerchants: [],
  blacklistedBuyMerchants: [],
  whitelistedSellMerchants: [],
  whitelistedBuyMerchants: [],

  ignoreOutlierSpikes: true,
  maxOutlierGapRp: 40,
  buyGapTrapEnabled: true,
  buyGapTrapThresholdRp: 20,
  spotDumpProtectionEnabled: false,
  spotDumpBufferRp: 15,
  minPriceBoundRp: 0,
  maxPriceBoundRp: 0,

  sellOffsetRp: -1, // Iklan jual pasang Rp 1 di bawah kompetitor teratas
  buyOffsetRp: 1,   // Iklan beli pasang Rp 1 di atas kompetitor teratas

  sellFloorMode: "auto_hpp",
  manualSellFloorRp: 0,
  minProfitMarginRp: 15,

  buyCeilingMode: "auto_fair",
  manualBuyCeilingRp: 0,
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
    | "PRICE_OUT_OF_BOUNDS"
    | "BELOW_SELL_FLOOR"
    | "BELOW_BUY_FLOOR";
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
    stockHpp: number;
    makerFeeRp: number;
    minProfitMarginRp: number;
    autoHppFloorPrice: number;
    manualFloorPrice: number;
    effectiveFloorPrice: number;
    netFloorProceeds: number;
    netProfitPerUsdtAtFloor: number;
  };
  buyGuard: {
    triggered: boolean;
    reason?: string;
    ceilingPrice: number;
    floorPrice?: number;
    autoSwitched?: boolean;
    switchedToRank?: number;
    marketAnchorPrice?: number;
    marketAnchorMerchantName?: string;
    spotCeilingPrice?: number;
    spotDumpTriggered?: boolean;
    indodaxSpotPrice?: number;
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
  effectiveFloor?: number,
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

    // 0b. Filter Proteksi Batas Bawah Jual (Sell Floor Guard)
    // Jika ada kompetitor jual memasang harga di bawah batas bawah aman (modal/floor),
    // DISKUALIFIKASI TOTAL kompetitor tersebut agar bot TIDAK PERNAH menjadikannya target ataupun memotong harganya!
    if (side === "sell_ref" && effectiveFloor && effectiveFloor > 0 && ad.price < effectiveFloor) {
      reasons.push({
        code: "BELOW_SELL_FLOOR",
        message: `Harga jual Rp ${ad.price.toLocaleString("id-ID")} di bawah batas bawah jual aman Anda (Floor Rp ${effectiveFloor.toLocaleString("id-ID")})`,
      });
    }

    // 0c. Filter Proteksi Batas Bawah Beli (Buy Floor Guard)
    if (side === "buy_ref" && effectiveFloor && effectiveFloor > 0 && ad.price < effectiveFloor) {
      reasons.push({
        code: "BELOW_BUY_FLOOR",
        message: `Harga beli Rp ${ad.price.toLocaleString("id-ID")} di bawah batas bawah beli Anda (Floor Rp ${effectiveFloor.toLocaleString("id-ID")})`,
      });
    }

    // 0d. Filter Whitelist / Blacklist Merchant (Dipisahkan antara Sisi JUAL vs BELI)
    const activeWhitelist = side === "sell_ref"
      ? (Array.isArray(config.whitelistedSellMerchants) && config.whitelistedSellMerchants.length > 0
          ? config.whitelistedSellMerchants
          : (config.whitelistedMerchants || []))
      : (Array.isArray(config.whitelistedBuyMerchants) && config.whitelistedBuyMerchants.length > 0
          ? config.whitelistedBuyMerchants
          : (config.whitelistedMerchants || []));

    const activeBlacklist = side === "sell_ref"
      ? (Array.isArray(config.blacklistedSellMerchants) && config.blacklistedSellMerchants.length > 0
          ? config.blacklistedSellMerchants
          : (config.blacklistedMerchants || []))
      : (Array.isArray(config.blacklistedBuyMerchants) && config.blacklistedBuyMerchants.length > 0
          ? config.blacklistedBuyMerchants
          : (config.blacklistedMerchants || []));

    if (config.merchantFilterMode === "whitelist_only") {
      const isWhitelisted = activeWhitelist.some(
        (w) => w && w.trim().toLowerCase() === ad.merchant_name.trim().toLowerCase(),
      );
      if (!isWhitelisted) {
        reasons.push({
          code: "NOT_IN_WHITELIST",
          message: `Merchant tidak ada di daftar Whitelist ${side === "sell_ref" ? "Jual" : "Beli"} pilihan Anda`,
        });
      }
    } else {
      if (activeBlacklist.length > 0) {
        const isBlacklisted = activeBlacklist.some(
          (b) => b && b.trim().toLowerCase() === ad.merchant_name.trim().toLowerCase(),
        );
        if (isBlacklisted) {
          reasons.push({
            code: "BLACKLISTED",
            message: `Merchant ada di daftar blacklist ${side === "sell_ref" ? "Jual" : "Beli"} Anda`,
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

    // 10. Filter Anti-Spoofing / Outlier Spike & Gap Trap Filter
    if (sortedAds.length >= 2) {
      const adIndex = sortedAds.indexOf(ad);
      if (adIndex >= 0 && adIndex < sortedAds.length - 1) {
        const nextAd = sortedAds[adIndex + 1];
        if (nextAd) {
          const gap = Math.abs(ad.price - nextAd.price);
          const isBuySide = side === "buy_ref";
          const gapTrapActive = isBuySide && config.buyGapTrapEnabled !== false;
          const gapThreshold = gapTrapActive
            ? (config.buyGapTrapThresholdRp && config.buyGapTrapThresholdRp > 0 ? config.buyGapTrapThresholdRp : 20)
            : (config.maxOutlierGapRp || 40);

          if (gapTrapActive && ad.price > nextAd.price && gap >= gapThreshold) {
            reasons.push({
              code: "PRICE_OUTLIER",
              message: `Gap Trap: Selisih beli Rp ${gap} dari Rank #${adIndex + 2} (${nextAd.merchant_name} @ Rp ${nextAd.price.toLocaleString("id-ID")}) melebihi batas Rp ${gapThreshold} (indikasi pancingan pucuk/spoofing)`,
            });
          } else if (config.ignoreOutlierSpikes && gap >= (config.maxOutlierGapRp || 40)) {
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
  indodaxSpotPrice?: number;    // Harga Spot USDT/IDR live Indodax sebagai lead-indicator proteksi dump pasar
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
    indodaxSpotPrice = 0,
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

  // Jika tidak ada data harga sama sekali, gunakan acuan pasar wajar saat ini (~16.850)
  const liveMarketAnchor = candidatePrices.length > 0
    ? Math.round(candidatePrices.reduce((a, b) => a + b, 0) / candidatePrices.length)
    : 16_850;

  const minSpread = Math.max(10, config.minSpreadRp || 25);
  const halfSpread = Math.max(5, Math.round(minSpread / 2));

  // Dynamic fallback: gunakan fallback jika valid (> 10.000)
  const resolvedFallbackSell = (fallbackSellPrice && fallbackSellPrice >= 10_000)
    ? fallbackSellPrice
    : (liveMarketAnchor + halfSpread);

  const resolvedFallbackBuy = (fallbackBuyPrice && fallbackBuyPrice >= 10_000)
    ? fallbackBuyPrice
    : (liveMarketAnchor - halfSpread);

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

  // ── Hitung Batas Pengaman JUAL (Sell Floor Guard) & BELI (Buy Floor) di Awal ──
  // Floor Jual Otomatis: HANYA dihitung jika ADA data modal HPP stok riil (> 0).
  // JANGAN PERNAH mengambil fairPrice + margin saat stockHpp = 0 karena akan menciptakan
  // batas lantai semu di atas pasar yang memicu harga jual terus naik sendiri (runaway feedback loop).
  const autoSellFloor = stockHpp > 0
    ? Math.round((stockHpp + (config.minProfitMarginRp || 10)) / (1 - MAKER_FEE_RATE))
    : 0;

  // Tentukan calculatedSellFloor:
  // 1. Jika mode manual dan manualSellFloorRp diisi, utamakan manualSellFloorRp.
  // 2. Jika mode auto_hpp dan autoSellFloor > 0, gunakan autoSellFloor.
  // 3. Fallback: jika manualSellFloorRp diisi (> 0), gunakan manualSellFloorRp.
  let calculatedSellFloor = 0;
  if (config.sellFloorMode === "manual" && config.manualSellFloorRp && config.manualSellFloorRp > 0) {
    calculatedSellFloor = config.manualSellFloorRp;
  } else if (config.sellFloorMode === "auto_hpp" && autoSellFloor > 0) {
    calculatedSellFloor = autoSellFloor;
  } else if (config.manualSellFloorRp && config.manualSellFloorRp > 0) {
    calculatedSellFloor = config.manualSellFloorRp;
  }

  // HARD FLOOR MUTLAK: Jika pengguna mengisi Batas Bawah Jual (manualSellFloorRp) atau minPriceBoundRp,
  // keduanya WAJIB berlaku sebagai pengaman dasar tanpa syarat (apapun mode sellFloorMode-nya)!
  if (config.manualSellFloorRp && config.manualSellFloorRp > 0) {
    calculatedSellFloor = Math.max(calculatedSellFloor, config.manualSellFloorRp);
  }
  if (config.minPriceBoundRp && config.minPriceBoundRp > 0) {
    calculatedSellFloor = Math.max(calculatedSellFloor, config.minPriceBoundRp);
  }
  calculatedSellFloor = Math.round(calculatedSellFloor);

  let calculatedBuyCeiling = 999_999;

  let calculatedBuyFloor = Math.round(
    config.buyFloorMode === "manual" && config.manualBuyFloorRp && config.manualBuyFloorRp > 0
      ? config.manualBuyFloorRp
      : 0
  );
  if (config.manualBuyFloorRp && config.manualBuyFloorRp > 0) {
    calculatedBuyFloor = Math.max(calculatedBuyFloor, config.manualBuyFloorRp);
  }
  // Catatan: config.minPriceBoundRp hanya diterapkan ke buy floor jika lebih rendah dari calculatedSellFloor,
  // agar batas bawah jual modal tidak memaksa harga beli naik setinggi batas jual.
  if (
    config.minPriceBoundRp &&
    config.minPriceBoundRp > 0 &&
    (!calculatedSellFloor || config.minPriceBoundRp < calculatedSellFloor)
  ) {
    calculatedBuyFloor = Math.max(calculatedBuyFloor, config.minPriceBoundRp);
  }
  calculatedBuyFloor = Math.round(calculatedBuyFloor);

  // 1. Evaluasi dan Filter Merchant Kompetitor Jual & Beli dengan batas pengaman floor
  const { qualified: qualifiedSell, evaluated: evaluatedSell } = evaluateCompetitorAds(
    sellRefAds,
    config,
    "sell_ref",
    calculatedSellFloor,
  );
  const { qualified: qualifiedBuy, evaluated: evaluatedBuy } = evaluateCompetitorAds(
    buyRefAds,
    config,
    "buy_ref",
    calculatedBuyFloor,
  );

  // 2. Pilih Target Merchant Sesuai Peringkat atau Agregasi Top N
  const sellRankIdx = Math.min(Math.max(config.targetRank - 1, 0), Math.max(qualifiedSell.length - 1, 0));
  const buyRankIdx = Math.min(Math.max(config.targetRank - 1, 0), Math.max(qualifiedBuy.length - 1, 0));

  const sellTargetMerchant = qualifiedSell[sellRankIdx] ?? null;
  const buyTargetMerchant = qualifiedBuy[buyRankIdx] ?? null;

  const topNCount = Math.max(2, config.targetTopCount || 3);

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
        // KUNCI LANGSUNG di batas aman Batas Bawah Floor HPP (jangan menambah margin/fallback agar harga tidak naik):
        const safeFloorPrice = calculatedSellFloor > 0 ? calculatedSellFloor : fallback;
        return {
          basePrice: safeFloorPrice,
          desc: `Terkunci Aman di Batas Bawah Floor HPP (Rp ${safeFloorPrice.toLocaleString("id-ID")}) [Semua kompetitor di bawah floor]`,
          isFallback: true,
        };
      } else {
        // Pada sisi BELI: Jika tidak ada yang lolos filter:
        // JANGAN PERNAH mengambil iklan paling mahal di pucuk!
        // Cari iklan non-milik sendiri yang harganya <= Batas Atas Ceiling beli DAN >= Batas Bawah Buy Floor:
        const nonOwnSafeAds = (allRawAds || []).filter(
          (a) =>
            !isOwnAd(a) &&
            (calculatedBuyCeiling <= 0 || a.price <= calculatedBuyCeiling) &&
            (calculatedBuyFloor <= 0 || a.price >= calculatedBuyFloor)
        );

        if (nonOwnSafeAds.length > 0) {
          const safeTarget = nonOwnSafeAds[0];
          const rawIndex = allRawAds.indexOf(safeTarget) + 1;
          return {
            basePrice: safeTarget.price,
            desc: `Relaksasi Aman (Batas Aman): #${rawIndex} (${safeTarget.merchant_name} @ Rp ${safeTarget.price.toLocaleString("id-ID")})`,
            isFallback: false,
          };
        }

        let safeCeilingPrice = calculatedBuyCeiling > 0 ? Math.min(calculatedBuyCeiling, fallback) : fallback;
        if (calculatedBuyFloor > 0 && safeCeilingPrice < calculatedBuyFloor) {
          safeCeilingPrice = calculatedBuyFloor;
        }
        return {
          basePrice: safeCeilingPrice,
          desc: `Terkunci Aman di Batas Aman Beli (Rp ${safeCeilingPrice.toLocaleString("id-ID")}) [Tidak ada kompetitor lolos filter]`,
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

  // 1. Hitung Harga JUAL Dasar & Rekomendasi Terlebih Dahulu
  // Batas Atas Beli (Buy Ceiling) diturunkan langsung dari Harga Jual (Harga Jual Bot - Min Spread Guard),
  // sehingga Harga Jual harus dihitung dan diselesaikan terlebih dahulu.
  const sellBase = computeBasePrice("sell", qualifiedSell, sellRefAds, sellTargetMerchant, resolvedFallbackSell);
  const naturalSellTargetPrice = sellBase.isFallback
    ? sellBase.basePrice
    : sellBase.basePrice + config.sellOffsetRp;

  let rawSellPrice = Math.max(calculatedSellFloor, naturalSellTargetPrice);

  const autoFollow = config.autoFollowNextWhenLimitReached !== false;

  let activeSellTargetMerchant = sellTargetMerchant;
  let activeSellRankUsed = sellTargetMerchant ? sellRankIdx + 1 : 0;
  let activeSellDesc = sellBase.desc;

  const estimatedFloorFee = Math.round(calculatedSellFloor * MAKER_FEE_RATE * 100) / 100;
  const netFloor = Math.round((calculatedSellFloor - estimatedFloorFee) * 100) / 100;
  const netProfitFloor = stockHpp > 0 ? Math.round((netFloor - stockHpp) * 100) / 100 : 0;

  const sellGuard: CompetitorPricingResult["sellGuard"] = {
    triggered: false,
    floorPrice: calculatedSellFloor,
    stockHpp: stockHpp > 0 ? stockHpp : 0,
    makerFeeRp: estimatedFloorFee,
    minProfitMarginRp: config.minProfitMarginRp || 10,
    autoHppFloorPrice: autoSellFloor,
    manualFloorPrice: config.manualSellFloorRp && config.manualSellFloorRp > 0 ? config.manualSellFloorRp : 0,
    effectiveFloorPrice: calculatedSellFloor,
    netFloorProceeds: netFloor,
    netProfitPerUsdtAtFloor: netProfitFloor,
  };

  let recommendedSellPrice = rawSellPrice;

  // 2. Terapkan Override Manual Jual atau Proteksi Floor Jual
  if (config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0) {
    const fixedSell = Math.round(config.manualSellPriceOverrideRp);
    if (calculatedSellFloor > 0 && fixedSell < calculatedSellFloor) {
      recommendedSellPrice = calculatedSellFloor;
      sellGuard.triggered = true;
      sellGuard.reason = `Proteksi Floor: Harga jual override manual (Rp ${fixedSell.toLocaleString("id-ID")}) di bawah batas aman Floor modal (Rp ${calculatedSellFloor.toLocaleString("id-ID")}). Harga dikunci di batas Floor.`;
    } else {
      recommendedSellPrice = fixedSell;
      sellGuard.triggered = false;
      sellGuard.reason = undefined;
    }
    activeSellDesc = `Manual Override (Rp ${fixedSell.toLocaleString("id-ID")})`;
  } else {
    // Mode Auto Bot: periksa apakah target pasar berada di bawah batas aman floor modal yang di-set pengguna
    const isMarketBelowFloor = calculatedSellFloor > 0 && naturalSellTargetPrice < calculatedSellFloor;

    if (isMarketBelowFloor || (calculatedSellFloor > 0 && recommendedSellPrice < calculatedSellFloor)) {
      sellGuard.triggered = true;
      // Kunci rapat di batas aman Floor modal agar bot tidak menjual rugi,
      // tapi JANGAN melompat ke iklan rank atas yang lebih mahal agar harga tidak naik-naik sendiri!
      recommendedSellPrice = calculatedSellFloor;
      sellGuard.reason = `Batas Bawah Modal Terpenuhi: Harga pasar/target (Rp ${naturalSellTargetPrice.toLocaleString("id-ID")}) berada di bawah batas aman Floor (Rp ${calculatedSellFloor.toLocaleString("id-ID")}). Harga dikunci tepat di batas Floor modal agar tidak menjual rugi namun tetap paling kompetitif.`;
    }
  }

  // ── Proteksi Maksimal Harga Jual Pasar (Sell Sanity Guard) ──
  // Mencegah harga jual melompat tidak wajar ke pucuk (misal akibat anomali orderbook atau iklan pasif).
  // Di mode Auto Bot, harga jual tidak boleh melompat lebih dari +50 Rp di atas kompetitor jual terbaik,
  // kecuali jika diproteksi oleh batas bawah Floor modal pengguna.
  if (!config.manualSellPriceOverrideRp || config.manualSellPriceOverrideRp <= 0) {
    const bestMarketSell = Array.isArray(sellRefAds) && sellRefAds.length > 0 && sellRefAds[0]?.price > 10_000
      ? sellRefAds[0].price
      : 0;
    if (bestMarketSell > 0) {
      const maxSensibleSell = Math.max(calculatedSellFloor, bestMarketSell + 50);
      if (recommendedSellPrice > maxSensibleSell) {
        recommendedSellPrice = maxSensibleSell;
      }
    }
  }

  // 3. Hitung dan Terapkan Batas Pengaman BELI (Buy Ceiling Guard) dari Harga Pasar Kompetitor Murni
  // Ceiling Beli (Batas Atas): Mengikuti harga pasar kompetitor jual murni dikurangi minSpreadRp,
  // PURE harga pasar: TIDAK DIPENGARUHI oleh filter merchant yang diblokir/blacklist, whitelist, ataupun batas bawah sell.
  let marketSellAnchor = 0;
  let marketSellAnchorMerchantName: string | undefined = undefined;

  if (config.buyCeilingMode === "auto_fair") {
    // Acuan pasar jual kompetitor murni (Pure Market Sell Price):
    // Mengambil harga jual terendah riil di orderbook TANPA filter blokir/blacklist merchant,
    // agar Ceiling beli mencerminkan harga pasar murni sesungguhnya bagi pembeli di Binance P2P.
    const pureNonOwnSellAds = (sellRefAds || [])
      .filter((ad) => {
        // Hanya abaikan iklan milik sendiri
        if (isOwnAd(ad)) return false;
        // Harga harus valid (> Rp 10.000 dan wajar < Rp 50.000)
        if (!ad.price || ad.price < 10_000 || ad.price > 50_000) return false;
        // PENTING: JANGAN PERNAH filter berdasarkan batas bawah jual aman (Sell Floor / BELOW_SELL_FLOOR) ataupun minPriceBoundRp!
        // Iklan kompetitor yang harganya di bawah batas bawah jual aman kita (misalnya Rp 17.843 di bawah Floor Rp 17.844)
        // TETAP WAJIB dimasukkan sebagai acuan pasar jual murni agar Formula Ceiling Beli tidak kemahalan.
        // Abaikan hanya iklan dust murni (< 2 USDT) agar tidak terkena spoofing ekstrem
        const usdtAmount = ad.available_usdt || (ad.price > 0 ? ad.available_idr / ad.price : 0);
        if (usdtAmount > 0 && usdtAmount < 2) return false;
        return true;
      })
      .sort((a, b) => a.price - b.price);

    const pureTopAd = pureNonOwnSellAds.length > 0 ? pureNonOwnSellAds[0] : null;

    if (pureTopAd && pureTopAd.price > 0) {
      marketSellAnchor = pureTopAd.price;
      marketSellAnchorMerchantName = pureTopAd.merchant_name;
    } else if (fairPrice > 0) {
      marketSellAnchor = fairPrice;
    } else {
      marketSellAnchor = liveMarketAnchor;
    }

    calculatedBuyCeiling = Math.round(marketSellAnchor - config.minSpreadRp);
  } else {
    // Mode Manual: gunakan manualBuyCeilingRp jika diisi
    calculatedBuyCeiling = config.manualBuyCeilingRp > 0 ? Math.round(config.manualBuyCeilingRp) : 999_999;
  }

  if (config.maxPriceBoundRp && config.maxPriceBoundRp > 0) {
    calculatedBuyCeiling = Math.min(calculatedBuyCeiling, config.maxPriceBoundRp);
  }
  // Hanya kunci ke calculatedBuyFloor jika mode manual dan calculatedBuyFloor wajar di bawah ceiling
  if (config.buyCeilingMode === "manual" && calculatedBuyFloor > 0 && calculatedBuyCeiling < calculatedBuyFloor) {
    calculatedBuyCeiling = calculatedBuyFloor;
  }

  // 4. Hitung Acuan Dasar Beli (Buy Base) menggunakan Ceiling yang Sudah Akurat
  const buyBase = computeBasePrice("buy", qualifiedBuy, buyRefAds, buyTargetMerchant, resolvedFallbackBuy);
  let rawBuyPrice = buyBase.basePrice + config.buyOffsetRp;
  if (calculatedBuyFloor > 0) {
    rawBuyPrice = Math.max(calculatedBuyFloor, rawBuyPrice);
  }

  let activeBuyTargetMerchant = buyTargetMerchant;
  let activeBuyRankUsed = buyTargetMerchant ? buyRankIdx + 1 : 0;
  let activeBuyDesc = buyBase.desc;

  const buyGuard: CompetitorPricingResult["buyGuard"] = {
    triggered: false,
    ceilingPrice: calculatedBuyCeiling,
    floorPrice: calculatedBuyFloor,
    marketAnchorPrice: marketSellAnchor > 0 ? marketSellAnchor : undefined,
    marketAnchorMerchantName: marketSellAnchorMerchantName,
  };

  let recommendedBuyPrice = rawBuyPrice;

  // 5. Terapkan Override Manual Beli atau Proteksi Ceiling/Floor Beli
  if (config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0) {
    const fixedBuy = Math.round(config.manualBuyPriceOverrideRp);
    if (calculatedBuyCeiling > 0 && fixedBuy > calculatedBuyCeiling) {
      recommendedBuyPrice = calculatedBuyCeiling;
      buyGuard.triggered = true;
      buyGuard.reason = `Proteksi Ceiling: Harga override manual beli (Rp ${fixedBuy.toLocaleString("id-ID")}) melebihi batas atas yang Anda tentukan (Ceiling Rp ${calculatedBuyCeiling.toLocaleString("id-ID")}). Harga dikunci di batas Ceiling.`;
    } else if (calculatedBuyFloor > 0 && fixedBuy < calculatedBuyFloor) {
      recommendedBuyPrice = calculatedBuyFloor;
      buyGuard.triggered = true;
      buyGuard.reason = `Proteksi Floor: Harga override manual beli (Rp ${fixedBuy.toLocaleString("id-ID")}) di bawah batas minimal beli (Floor Rp ${calculatedBuyFloor.toLocaleString("id-ID")}). Harga dikunci di batas Floor.`;
    } else {
      recommendedBuyPrice = fixedBuy;
      buyGuard.triggered = false;
      buyGuard.reason = undefined;
    }
    activeBuyDesc = `Manual Override (Rp ${fixedBuy.toLocaleString("id-ID")})`;
  } else {
    // Mode Auto Bot untuk Beli:
    // Cek Batas Atas (Ceiling Guard)
    // FITUR: Auto-Follow Iklan Lain Saat Batas Atas Beli Tercapai
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

    // Cek Batas Bawah (Floor Guard)
    if (calculatedBuyFloor > 0 && recommendedBuyPrice < calculatedBuyFloor) {
      buyGuard.triggered = true;
      buyGuard.reason = `Harga pasar (Rp ${rawBuyPrice.toLocaleString("id-ID")}) di bawah batas minimal beli yang ditentukan (Floor Rp ${calculatedBuyFloor.toLocaleString("id-ID")}). Harga dikunci di batas Floor.`;
      recommendedBuyPrice = calculatedBuyFloor;
    }

    // 5b. Proteksi Dump Pasar Spot (Indodax Spot Lead-Indicator)
    if (
      config.spotDumpProtectionEnabled &&
      indodaxSpotPrice &&
      indodaxSpotPrice > 10_000
    ) {
      const buffer = typeof config.spotDumpBufferRp === "number" ? config.spotDumpBufferRp : 15;
      const spotCeilingPrice = Math.round(indodaxSpotPrice + buffer);
      buyGuard.spotCeilingPrice = spotCeilingPrice;
      buyGuard.indodaxSpotPrice = indodaxSpotPrice;

      if (recommendedBuyPrice > spotCeilingPrice) {
        recommendedBuyPrice = spotCeilingPrice;
        buyGuard.spotDumpTriggered = true;
        buyGuard.triggered = true;
        buyGuard.reason = `Proteksi Dump Spot Indodax: Harga rekomendasi beli (Rp ${rawBuyPrice.toLocaleString("id-ID")}) melebihi batas toleransi Spot Indodax (Spot: Rp ${indodaxSpotPrice.toLocaleString("id-ID")} + Buffer Rp ${buffer} = Max Rp ${spotCeilingPrice.toLocaleString("id-ID")}). Bot menahan harga beli agar tidak membeli kemahalan saat pasar spot dump.`;
      }
    }
  }

  // 6. Validasi Minimum Spread Guard (Pastikan Jual - Beli >= Min Spread)
  const isSellManual = Boolean(config.manualSellPriceOverrideRp && config.manualSellPriceOverrideRp > 0);
  const isBuyManual = Boolean(config.manualBuyPriceOverrideRp && config.manualBuyPriceOverrideRp > 0);

  if (recommendedSellPrice - recommendedBuyPrice < config.minSpreadRp) {
    if (isSellManual && !isBuyManual) {
      // User menentukan harga jual manual tetap: sesuaikan harga beli otomatis ke bawah
      const adjustedBuyPrice = Math.round(recommendedSellPrice - config.minSpreadRp);
      recommendedBuyPrice = calculatedBuyFloor > 0 ? Math.max(calculatedBuyFloor, adjustedBuyPrice) : adjustedBuyPrice;
    } else if (!isSellManual && isBuyManual) {
      // User menentukan harga beli manual tetap: sesuaikan harga jual otomatis ke atas
      recommendedSellPrice = Math.max(calculatedSellFloor, Math.round(recommendedBuyPrice + config.minSpreadRp));
    } else if (isSellManual && isBuyManual) {
      // Keduanya manual override: pertahankan input eksplisit pengguna
    } else {
      // Keduanya Auto Bot:
      const sellIsFallback = sellBase.isFallback;
      const buyIsFallback = buyBase.isFallback;

      if (sellIsFallback && !buyIsFallback) {
        // Sisi Jual tidak memiliki kompetitor riil (fallback), sedangkan sisi Beli riil ada kompetitor valid.
        recommendedSellPrice = Math.max(calculatedSellFloor, Math.round(recommendedBuyPrice + config.minSpreadRp));
      } else if (!sellIsFallback && buyIsFallback) {
        // Sisi Beli tidak memiliki kompetitor riil (fallback), sedangkan sisi Jual riil ada kompetitor valid.
        const adjustedBuyPrice = Math.round(recommendedSellPrice - config.minSpreadRp);
        recommendedBuyPrice = calculatedBuyFloor > 0 ? Math.max(calculatedBuyFloor, adjustedBuyPrice) : adjustedBuyPrice;
      } else {
        // Keduanya kompetitor riil, atau keduanya fallback.
        const adjustedBuyPrice = Math.round(recommendedSellPrice - config.minSpreadRp);
        if (calculatedBuyFloor > 0 && adjustedBuyPrice < calculatedBuyFloor) {
          recommendedBuyPrice = calculatedBuyFloor;
          recommendedSellPrice = Math.max(calculatedSellFloor, Math.round(recommendedBuyPrice + config.minSpreadRp));
        } else {
          recommendedBuyPrice = adjustedBuyPrice;
        }
      }
    }
  }

  // Jika mode auto_fair, pastikan calculatedBuyCeiling tetap konsisten terhadap harga pasar kompetitor murni
  if (config.buyCeilingMode === "auto_fair" && marketSellAnchor > 0) {
    calculatedBuyCeiling = Math.round(marketSellAnchor - config.minSpreadRp);
    if (config.maxPriceBoundRp && config.maxPriceBoundRp > 0) {
      calculatedBuyCeiling = Math.min(calculatedBuyCeiling, config.maxPriceBoundRp);
    }
    // JANGAN timpa calculatedBuyCeiling dengan Floor Jual / calculatedSellFloor atau minPriceBoundRp!
    buyGuard.ceilingPrice = calculatedBuyCeiling;
    buyGuard.marketAnchorPrice = marketSellAnchor;
    buyGuard.marketAnchorMerchantName = marketSellAnchorMerchantName;
  }

  // ── FINAL SAFEGUARDS: PENGAMAN MUTLAK SEMUA BATAS HARGA YANG DI-SET PENGGUNA ──
  // 1. Batas Bawah Jual (Sell Floor): Harga jual TIDAK BOLEH PERNAH di bawah floor yang ditentukan
  if (calculatedSellFloor > 0 && recommendedSellPrice < calculatedSellFloor) {
    recommendedSellPrice = calculatedSellFloor;
    sellGuard.triggered = true;
    sellGuard.reason = `Proteksi Mutlak Batas Bawah Jual: Harga jual terkunci di Batas Bawah (Rp ${calculatedSellFloor.toLocaleString("id-ID")}) agar bot tidak menjual di bawah batas yang Anda tentukan.`;
  }

  // 2. Batas Bawah Beli (Buy Floor): Harga beli TIDAK BOLEH PERNAH di bawah floor beli yang di-set user
  if (calculatedBuyFloor > 0 && recommendedBuyPrice < calculatedBuyFloor) {
    recommendedBuyPrice = calculatedBuyFloor;
    buyGuard.triggered = true;
    buyGuard.reason = `Proteksi Mutlak Batas Bawah Beli: Harga beli terkunci di Batas Bawah (Rp ${calculatedBuyFloor.toLocaleString("id-ID")}) agar bot tidak memasang harga di bawah batas yang Anda tentukan.`;
  }

  // 3. Batas Atas Beli (Buy Ceiling): Harga beli TIDAK BOLEH PERNAH melebihi ceiling beli
  if (calculatedBuyCeiling > 0 && recommendedBuyPrice > calculatedBuyCeiling) {
    recommendedBuyPrice = calculatedBuyCeiling;
    buyGuard.triggered = true;
    buyGuard.reason = `Proteksi Mutlak Batas Atas Beli: Harga beli terkunci di Batas Atas (Rp ${calculatedBuyCeiling.toLocaleString("id-ID")}) agar bot tidak membeli kemahalan di atas batas yang Anda tentukan.`;
  }

  // 4. Batas Minimum Absolut Pasar (Min Price Bound): Berlaku untuk Jual & Beli
  if (config.minPriceBoundRp && config.minPriceBoundRp > 0) {
    if (recommendedSellPrice < config.minPriceBoundRp) {
      recommendedSellPrice = config.minPriceBoundRp;
    }
    // PENTING: Hanya terapkan minPriceBoundRp ke sisi beli jika nilainya benar-benar di bawah batas jual dan di bawah buy ceiling.
    // Jika nilainya >= calculatedSellFloor (misal user memasukkan 17.844 sebagai batas bawah jual),
    // jangan paksa harga beli ikut melonjak naik ke 17.844!
    if (
      (!calculatedSellFloor || config.minPriceBoundRp < calculatedSellFloor) &&
      (!calculatedBuyCeiling || config.minPriceBoundRp <= calculatedBuyCeiling) &&
      recommendedBuyPrice < config.minPriceBoundRp
    ) {
      recommendedBuyPrice = config.minPriceBoundRp;
    }
  }

  // 5. Batas Maksimum Absolut Pasar (Max Price Bound): Berlaku untuk Jual & Beli
  if (config.maxPriceBoundRp && config.maxPriceBoundRp > 0) {
    if (recommendedSellPrice > config.maxPriceBoundRp) {
      // PENTING: Max bound TIDAK BOLEH memangkas harga jual di bawah Batas Bawah Sell Floor!
      if (calculatedSellFloor > 0 && config.maxPriceBoundRp < calculatedSellFloor) {
        recommendedSellPrice = calculatedSellFloor;
      } else {
        recommendedSellPrice = config.maxPriceBoundRp;
      }
    }
    if (recommendedBuyPrice > config.maxPriceBoundRp) {
      recommendedBuyPrice = config.maxPriceBoundRp;
    }
  }

  // 6. FINAL MUTLAK HARD CLAMP: Harga jual & beli TIDAK BOLEH berada di bawah batas bawah apapun yang di-set user
  const absoluteSellFloor = Math.max(
    calculatedSellFloor || 0,
    config.manualSellFloorRp || 0,
    config.minPriceBoundRp || 0
  );
  if (absoluteSellFloor > 0 && recommendedSellPrice < absoluteSellFloor) {
    recommendedSellPrice = absoluteSellFloor;
    sellGuard.triggered = true;
    sellGuard.reason = `Proteksi Mutlak Batas Bawah Jual: Harga jual terkunci di Batas Bawah (Rp ${absoluteSellFloor.toLocaleString("id-ID")}).`;
  }
  sellGuard.floorPrice = absoluteSellFloor;
  sellGuard.effectiveFloorPrice = absoluteSellFloor;
  sellGuard.makerFeeRp = Math.round(absoluteSellFloor * MAKER_FEE_RATE * 100) / 100;
  sellGuard.netFloorProceeds = Math.round((absoluteSellFloor - sellGuard.makerFeeRp) * 100) / 100;
  if (stockHpp > 0) {
    sellGuard.netProfitPerUsdtAtFloor = Math.round((sellGuard.netFloorProceeds - stockHpp) * 100) / 100;
  }

  const absoluteBuyFloor = Math.max(
    calculatedBuyFloor || 0,
    config.manualBuyFloorRp || 0,
    config.minPriceBoundRp || 0
  );
  if (absoluteBuyFloor > 0 && recommendedBuyPrice < absoluteBuyFloor) {
    recommendedBuyPrice = absoluteBuyFloor;
    buyGuard.triggered = true;
    buyGuard.reason = `Proteksi Mutlak Batas Bawah Beli: Harga beli terkunci di Batas Bawah (Rp ${absoluteBuyFloor.toLocaleString("id-ID")}).`;
  }

  // 7. Bulatkan harga mutlak ke bilangan bulat (integer IDR untuk Binance C2C)
  recommendedSellPrice = Math.round(recommendedSellPrice);
  recommendedBuyPrice = Math.round(recommendedBuyPrice);

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
    baseBudgetIdr = totalModalAwalIdr;
    if (config.deductLiveStockFromBudget === false) {
      // Pemotongan stok dinonaktifkan: gunakan modal penuh (Rp 180 Juta)
      remainingBudgetBeforeAllocation = totalModalAwalIdr;
    } else {
      // Pemotongan stok aktif: kurangi modal Rp 180 Juta dengan valuasi sisa stok USDT
      const deductedStock = stockCapitalValuationIdr > 0 ? stockCapitalValuationIdr : 0;
      remainingBudgetBeforeAllocation = Math.max(0, totalModalAwalIdr - deductedStock);
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
    if (!Array.isArray(merged.blacklistedSellMerchants)) merged.blacklistedSellMerchants = [...merged.blacklistedMerchants];
    if (!Array.isArray(merged.blacklistedBuyMerchants)) merged.blacklistedBuyMerchants = [...merged.blacklistedMerchants];
    if (!Array.isArray(merged.whitelistedSellMerchants)) merged.whitelistedSellMerchants = [...merged.whitelistedMerchants];
    if (!Array.isArray(merged.whitelistedBuyMerchants)) merged.whitelistedBuyMerchants = [...merged.whitelistedMerchants];
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
    if (typeof merged.buyGapTrapEnabled !== "boolean") merged.buyGapTrapEnabled = true;
    if (typeof merged.buyGapTrapThresholdRp !== "number" || merged.buyGapTrapThresholdRp < 5) merged.buyGapTrapThresholdRp = 20;
    if (typeof merged.spotDumpProtectionEnabled !== "boolean") merged.spotDumpProtectionEnabled = false;
    if (typeof merged.spotDumpBufferRp !== "number" || merged.spotDumpBufferRp < 0) merged.spotDumpBufferRp = 15;
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

