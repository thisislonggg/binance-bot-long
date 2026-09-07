/**
 * Modul Analisis & Bot Auto-Pricing P2P Binance.
 * Strategi: Filtered Competitor Following dengan Safety Boundaries (Floor, Ceiling, Min Spread).
 */

import { type Ad } from "./p2p-engine";

export type CompetitorFilterConfig = {
  enabled: boolean;
  // ── Filter Merchant Acuan ──────────────────────────────────────────────────
  minUsdtAmount: number;          // Minimal USDT yang dimiliki/dijual merchant (misal: 500 USDT)
  minOrderLimitIdr: number;       // Minimal batas pesanan IDR (misal: 1.000.000)
  verifiedOnly: boolean;          // Hanya ikuti Verified Merchant (centang kuning)
  minCompletionRate: number;      // Minimal % penyelesaian 30 hari (misal: 95%)
  minMonthOrders: number;         // Minimal total order 30 hari (misal: 50)
  targetRank: number;             // Peringkat target di antara merchant yang lolos (1 = Rank 1, 2 = Rank 2, dst)
  filterPaymentMethods: string[]; // Filter metode bayar tertentu (kosong = semua)

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
};

export const DEFAULT_BOT_CONFIG: CompetitorFilterConfig = {
  enabled: true,
  minUsdtAmount: 500,
  minOrderLimitIdr: 0, // 0 = Bebas / Nonaktif (tidak mengeliminasi merchant dengan min order besar seperti 20jt)
  verifiedOnly: true,
  minCompletionRate: 95,
  minMonthOrders: 50,
  targetRank: 1,
  filterPaymentMethods: [],

  sellOffsetRp: -1, // Iklan jual pasang Rp 1 di bawah kompetitor teratas
  buyOffsetRp: 1,   // Iklan beli pasang Rp 1 di atas kompetitor teratas

  sellFloorMode: "auto_hpp",
  manualSellFloorRp: 16_100,
  minProfitMarginRp: 15,

  buyCeilingMode: "auto_fair",
  manualBuyCeilingRp: 16_350,

  minSpreadRp: 25,
  maxPriceStepRp: 50,
};

export type DisqualificationReason = {
  code:
    | "USDT_TOO_LOW"
    | "MIN_LIMIT_TOO_HIGH"
    | "UNVERIFIED"
    | "COMPLETION_RATE_LOW"
    | "MONTH_ORDERS_LOW"
    | "PAYMENT_METHOD_MISMATCH";
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
};

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

    // 1. Filter Kapasitas USDT (Sesuai request utama user)
    const usdtAmount = ad.available_usdt || (ad.price > 0 ? ad.available_idr / ad.price : 0);
    if (config.minUsdtAmount > 0 && usdtAmount < config.minUsdtAmount) {
      reasons.push({
        code: "USDT_TOO_LOW",
        message: `Stok ${Math.round(usdtAmount)} USDT < min ${config.minUsdtAmount} USDT`,
      });
    }

    // 2. Filter Batas Pesanan Minimal IDR (diabaikan jika 0 / nonaktif)
    if (config.minOrderLimitIdr > 0 && ad.min_limit_idr > config.minOrderLimitIdr) {
      reasons.push({
        code: "MIN_LIMIT_TOO_HIGH",
        message: `Min transaksi merchant Rp ${ad.min_limit_idr.toLocaleString("id-ID")} melebihi batas filter Anda (Rp ${config.minOrderLimitIdr.toLocaleString("id-ID")})`,
      });
    }

    // 3. Filter Status Verifikasi Merchant
    if (config.verifiedOnly && !ad.is_verified) {
      reasons.push({
        code: "UNVERIFIED",
        message: "Bukan Verified Merchant",
      });
    }

    // 4. Filter Tingkat Penyelesaian (Completion Rate)
    if (
      config.minCompletionRate > 0 &&
      ad.completion_rate !== null &&
      ad.completion_rate < config.minCompletionRate
    ) {
      reasons.push({
        code: "COMPLETION_RATE_LOW",
        message: `Rate ${ad.completion_rate.toFixed(1)}% < min ${config.minCompletionRate}%`,
      });
    }

    // 5. Filter Jumlah Order 30 Hari
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

    // 6. Filter Metode Pembayaran (jika diatur)
    if (config.filterPaymentMethods.length > 0) {
      const hasMethod = config.filterPaymentMethods.some((reqMethod) =>
        ad.pay_methods.some((m) => m.toLowerCase().includes(reqMethod.toLowerCase())),
      );
      if (!hasMethod) {
        reasons.push({
          code: "PAYMENT_METHOD_MISMATCH",
          message: `Tidak menerima ${config.filterPaymentMethods.join("/")}`,
        });
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
  fallbackSellPrice?: number;
  fallbackBuyPrice?: number;
}): CompetitorPricingResult {
  const {
    sellRefAds,
    buyRefAds,
    config,
    stockHpp,
    fairPrice,
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

  // 2. Pilih Target Merchant Sesuai Peringkat (Target Rank)
  const sellRankIdx = Math.min(Math.max(config.targetRank - 1, 0), Math.max(qualifiedSell.length - 1, 0));
  const buyRankIdx = Math.min(Math.max(config.targetRank - 1, 0), Math.max(qualifiedBuy.length - 1, 0));

  const sellTargetMerchant = qualifiedSell[sellRankIdx] ?? null;
  const buyTargetMerchant = qualifiedBuy[buyRankIdx] ?? null;

  // 3. Hitung Harga Mentah (Raw Price) dengan Offset
  // Untuk JUAL: harga kompetitor + sellOffsetRp (misal -1 undercut)
  let rawSellPrice = sellTargetMerchant
    ? sellTargetMerchant.price + config.sellOffsetRp
    : fallbackSellPrice;

  // Untuk BELI: harga kompetitor + buyOffsetRp (misal +1 overcut)
  let rawBuyPrice = buyTargetMerchant
    ? buyTargetMerchant.price + config.buyOffsetRp
    : fallbackBuyPrice;

  // 4. Hitung dan Terapkan Batas Pengaman JUAL (Sell Floor Guard)
  // Biaya Maker Jual Binance P2P ~ 0.07% - 0.1%
  const MAKER_FEE_RATE = 0.0007;
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
  // Ceiling Beli: Mencegah beli kemahalan di pucuk
  const calculatedBuyCeiling = Math.round(
    config.buyCeilingMode === "auto_fair"
      ? (fairPrice > 0 ? fairPrice - config.minProfitMarginRp : 16_300)
      : config.manualBuyCeilingRp,
  );

  const buyGuard: CompetitorPricingResult["buyGuard"] = {
    triggered: false,
    ceilingPrice: calculatedBuyCeiling,
  };

  let recommendedBuyPrice = rawBuyPrice;
  if (recommendedBuyPrice > calculatedBuyCeiling) {
    buyGuard.triggered = true;
    buyGuard.reason = `Harga pasar (Rp ${rawBuyPrice.toLocaleString("id-ID")}) di atas batas atas wajar (Ceiling Rp ${calculatedBuyCeiling.toLocaleString("id-ID")}). Harga dikunci di batas Ceiling.`;
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

  return {
    recommendedSellPrice,
    recommendedBuyPrice,
    rawSellPrice,
    rawBuyPrice,
    sellTargetMerchant,
    buyTargetMerchant,
    sellRankUsed: sellRankIdx + 1,
    buyRankUsed: buyRankIdx + 1,
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
  };
}

const STORAGE_KEY = "binance_p2p_competitor_bot_config";

export function loadBotConfig(): CompetitorFilterConfig {
  if (typeof window === "undefined") return DEFAULT_BOT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BOT_CONFIG;
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_BOT_CONFIG, ...parsed };
    // Jika masih tersimpan nilai lama default 500.000 yang memblokir merchant 20jt, migrasi ke 0
    if (merged.minOrderLimitIdr === 500_000) {
      merged.minOrderLimitIdr = 0;
      saveBotConfig(merged);
    }
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
