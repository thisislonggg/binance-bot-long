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

  minSpreadRp: number;            // Selisih minimal (Jual - Beli) agar tetap profit
  maxPriceStepRp: number;         // Pembatas lonjakan harga per siklus (anti-spoofing)

  // ── Alokasi Stok Beli Otomatis dari Sisa Saldo Bank ───────────────────────
  autoSyncBuyStockWithBank: boolean;      // Otomatis pasang jumlah USDT beli sesuai sisa uang di bank
  bankBalanceSource: "auto" | "manual";   // Sumber saldo bank: "auto" (modal kas PnL) atau "manual"
  manualBankBalanceIdr: number;           // Saldo bank manual jika mode manual atau override (misal: 25.000.000)
  bankAllocationPct: number;              // Persentase alokasi saldo bank untuk beli (misal: 100%)
  bankReserveBufferIdr: number;           // Cadangan uang minimal di bank yang tidak boleh dibelanjakan (Rp)
};

export const DEFAULT_BOT_CONFIG: CompetitorFilterConfig = {
  enabled: true,
  minUsdtAmount: 500,
  maxUsdtAmount: 0,
  minOrderLimitIdr: 50_000_000, // Otomatis filter order buy/jual yang mensyaratkan min transaksi >= 50 Juta
  minMaxLimitIdr: 0,
  verifiedOnly: true,
  userTypeFilter: "all",
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
  manualSellFloorRp: 16_100,
  minProfitMarginRp: 15,

  buyCeilingMode: "auto_fair",
  manualBuyCeilingRp: 16_350,

  minSpreadRp: 25,
  maxPriceStepRp: 50,

  autoSyncBuyStockWithBank: true,
  bankBalanceSource: "auto",
  manualBankBalanceIdr: 0,
  bankAllocationPct: 100,
  bankReserveBufferIdr: 0,
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
      minOrderLimitIdr: 50_000_000,
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
      minOrderLimitIdr: 25_000_000,
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
      minOrderLimitIdr: 50_000_000,
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
    | "USDT_TOO_LOW"
    | "USDT_TOO_HIGH"
    | "MIN_LIMIT_TOO_HIGH"
    | "MAX_LIMIT_TOO_LOW"
    | "UNVERIFIED"
    | "USER_TYPE_MISMATCH"
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
  };
  buyGuard: {
    triggered: boolean;
    reason?: string;
    ceilingPrice: number;
  };
  spreadAbs: number;
  spreadPct: number;
  makerFeeSellPerUsdt: number;
  makerFeeBuyPerUsdt: number;
  effectiveHpp: number;
  estimatedNetProfitPerUsdt: number;
  bankAllocation: {
    effectiveBankBalance: number;
    usableBankIdr: number;
    autoBuyStockUsdt: number;
    autoBuyMaxLimitIdr: number;
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

  let currentRank = 1;

  for (const ad of sortedAds) {
    const reasons: DisqualificationReason[] = [];

    // 0. Filter Whitelist / Blacklist Merchant
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
    // Otomatis diskualifikasi jika syarat transaksi minimal kompetitor >= nominal filter (misal: pasang buy >= Rp 50 Juta)
    if (config.minOrderLimitIdr > 0 && ad.min_limit_idr >= config.minOrderLimitIdr) {
      reasons.push({
        code: "MIN_LIMIT_TOO_HIGH",
        message: `Min transaksi merchant Rp ${ad.min_limit_idr.toLocaleString("id-ID")} >= batas filter Rp ${config.minOrderLimitIdr.toLocaleString("id-ID")} (pesanan jumbo)`,
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
  fallbackSellPrice?: number;
  fallbackBuyPrice?: number;
}): CompetitorPricingResult {
  const {
    sellRefAds,
    buyRefAds,
    config,
    stockHpp,
    fairPrice,
    bankBalanceIdr = 0,
    fallbackSellPrice = 16_250,
    fallbackBuyPrice = 16_200,
  } = input;

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

  // Helper kalkulasi harga acuan dasar berdasarkan targetMode
  const computeBasePrice = (
    qualifiedAds: Ad[],
    singleTarget: Ad | null,
    fallback: number,
  ): { basePrice: number; desc: string } => {
    if (qualifiedAds.length === 0) {
      return { basePrice: fallback, desc: "Fallback (tidak ada merchant lolos filter)" };
    }

    if (config.targetMode === "average_top") {
      const pool = qualifiedAds.slice(0, Math.min(topNCount, qualifiedAds.length));
      const avg = Math.round(pool.reduce((sum, a) => sum + a.price, 0) / pool.length);
      return {
        basePrice: avg,
        desc: `Rata-rata Top ${pool.length} Kompetitor (Rp ${avg.toLocaleString("id-ID")})`,
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
      };
    }

    // Default: Mode "rank"
    return {
      basePrice: singleTarget ? singleTarget.price : fallback,
      desc: `Rank #${config.targetRank} (${singleTarget?.merchant_name || "N/A"})`,
    };
  };

  const sellBase = computeBasePrice(qualifiedSell, sellTargetMerchant, fallbackSellPrice);
  const buyBase = computeBasePrice(qualifiedBuy, buyTargetMerchant, fallbackBuyPrice);

  // 3. Hitung Harga Mentah (Raw Price) dengan Offset
  // Untuk JUAL: base price + sellOffsetRp (misal -1 undercut)
  let rawSellPrice = sellBase.basePrice + config.sellOffsetRp;

  // Untuk BELI: base price + buyOffsetRp (misal +1 overcut)
  let rawBuyPrice = buyBase.basePrice + config.buyOffsetRp;

  // 4. Hitung dan Terapkan Batas Pengaman JUAL (Sell Floor Guard)
  // Biaya Maker Jual Binance P2P ~ 0.05%
  const MAKER_FEE_RATE = 0.0005;
  const effectiveHpp = stockHpp > 0 ? stockHpp : (fairPrice > 0 ? fairPrice - 30 : 16_150);

  // Floor Jual: HPP + Fee Jual + Target Minimal Laba Bersih
  const calculatedSellFloor = Math.round(
    config.sellFloorMode === "auto_hpp"
      ? (effectiveHpp + config.minProfitMarginRp) / (1 - MAKER_FEE_RATE)
      : config.manualSellFloorRp,
  );

  const sellGuard: CompetitorPricingResult["sellGuard"] = {
    triggered: false,
    floorPrice: calculatedSellFloor,
  };

  let recommendedSellPrice = rawSellPrice;
  if (recommendedSellPrice < calculatedSellFloor) {
    sellGuard.triggered = true;
    sellGuard.reason = `Harga pasar (Rp ${rawSellPrice.toLocaleString("id-ID")}) di bawah batas aman modal (Floor Rp ${calculatedSellFloor.toLocaleString("id-ID")}). Harga dikunci di batas Floor.`;
    recommendedSellPrice = calculatedSellFloor;
  }

  // 5. Hitung dan Terapkan Batas Pengaman BELI (Buy Ceiling Guard)
  // Ceiling Beli: Mencegah beli kemahalan di pucuk yang mengikis spread minimal terhadap harga jual
  const calculatedBuyCeiling = Math.round(
    config.buyCeilingMode === "auto_fair"
      ? (rawSellPrice > 0 ? rawSellPrice - config.minSpreadRp : (fairPrice > 0 ? fairPrice : 16_300))
      : config.manualBuyCeilingRp,
  );

  const buyGuard: CompetitorPricingResult["buyGuard"] = {
    triggered: false,
    ceilingPrice: calculatedBuyCeiling,
  };

  let recommendedBuyPrice = rawBuyPrice;
  if (recommendedBuyPrice > calculatedBuyCeiling) {
    buyGuard.triggered = true;
    buyGuard.reason = `Harga pasar (Rp ${rawBuyPrice.toLocaleString("id-ID")}) di atas batas atas wajar (Ceiling Rp ${calculatedBuyCeiling.toLocaleString("id-ID")}, sisa spread < Rp ${config.minSpreadRp}). Harga dikunci di batas Ceiling.`;
    recommendedBuyPrice = calculatedBuyCeiling;
  }

  // 6. Validasi Minimum Spread Guard (Pastikan Jual - Beli >= Min Spread)
  if (recommendedSellPrice - recommendedBuyPrice < config.minSpreadRp) {
    // Jika spread terlalu tipis karena kompetitor, sesuaikan harga beli ke bawah
    recommendedBuyPrice = Math.round(recommendedSellPrice - config.minSpreadRp);
  }

  // 7. Kalkulasi Fee & Estimasi Laba Bersih
  const makerFeeSellPerUsdt = Math.round(recommendedSellPrice * MAKER_FEE_RATE * 100) / 100;
  const makerFeeBuyPerUsdt = Math.round(recommendedBuyPrice * MAKER_FEE_RATE * 100) / 100;
  const netSellProceeds = recommendedSellPrice - makerFeeSellPerUsdt;
  const netBuyCost = recommendedBuyPrice + makerFeeBuyPerUsdt;

  const spreadAbs = Math.round(recommendedSellPrice - recommendedBuyPrice);
  const spreadPct = recommendedBuyPrice > 0 ? (spreadAbs / recommendedBuyPrice) * 100 : 0;
  const estimatedNetProfitPerUsdt = Math.round((netSellProceeds - netBuyCost) * 100) / 100;

  // 8. Kalkulasi Alokasi Stok Beli Otomatis Sesuai Sisa Uang di Bank
  const effectiveBankBalance =
    config.bankBalanceSource === "manual" && config.manualBankBalanceIdr > 0
      ? config.manualBankBalanceIdr
      : (bankBalanceIdr > 0
          ? bankBalanceIdr
          : config.manualBankBalanceIdr);

  const bankAllocationFraction = Math.min(100, Math.max(1, config.bankAllocationPct || 100)) / 100;
  const usableBankIdr = Math.max(
    0,
    (effectiveBankBalance - (config.bankReserveBufferIdr || 0)) * bankAllocationFraction,
  );

  const autoBuyStockUsdt =
    recommendedBuyPrice > 0 && usableBankIdr > 0
      ? Math.floor((usableBankIdr / recommendedBuyPrice) * 100) / 100
      : 0;

  const autoBuyMaxLimitIdr = Math.round(usableBankIdr);

  const bankAllocation = {
    effectiveBankBalance,
    usableBankIdr,
    autoBuyStockUsdt,
    autoBuyMaxLimitIdr,
    isSynced: Boolean(config.autoSyncBuyStockWithBank && usableBankIdr > 0),
  };

  return {
    recommendedSellPrice,
    recommendedBuyPrice,
    rawSellPrice,
    rawBuyPrice,
    sellTargetMerchant,
    buyTargetMerchant,
    sellRankUsed: sellRankIdx + 1,
    buyRankUsed: buyRankIdx + 1,
    targetMethodDescription: {
      sell: sellBase.desc,
      buy: buyBase.desc,
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
    // Migrasi otomatis ke 50 Juta jika masih nilai lama (500rb atau 0)
    const hasMigrated50m = localStorage.getItem("binance_bot_migrated_50m_limit");
    if (!hasMigrated50m) {
      merged.minOrderLimitIdr = 50_000_000;
      localStorage.setItem("binance_bot_migrated_50m_limit", "true");
      saveBotConfig(merged);
    } else if (merged.minOrderLimitIdr === 500_000) {
      merged.minOrderLimitIdr = 50_000_000;
      saveBotConfig(merged);
    }
    if (typeof merged.autoSyncBuyStockWithBank !== "boolean") merged.autoSyncBuyStockWithBank = true;
    if (!merged.bankBalanceSource) merged.bankBalanceSource = "auto";
    if (typeof merged.manualBankBalanceIdr !== "number") merged.manualBankBalanceIdr = 0;
    if (typeof merged.bankAllocationPct !== "number") merged.bankAllocationPct = 100;
    if (typeof merged.bankReserveBufferIdr !== "number") merged.bankReserveBufferIdr = 0;
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

