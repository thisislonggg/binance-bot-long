/**
 * Mesin analisis Binance P2P USDT/IDR dari perspektif MERCHANT.
 * Port dari skrip Python (binance.py) — semua rumus & ambang dipertahankan.
 */

export const CFG = {
  ASSET: "USDT",
  FIAT: "IDR",
  ROWS_PER_SIDE: 20,
  MIN_AD_LIQUIDITY_IDR: 1_000_000,
  OUTLIER_MAD_Z: 3.5,
  CLUSTER_GAP_PCT: 0.0015,
  LIQUIDITY_THIN_IDR: 50_000_000,
  LIQUIDITY_DEEP_IDR: 300_000_000,
  BIAS_THRESHOLD_PCT: 0.1,
  MIN_MARGIN_FLOOR_IDR: 8,
  MIN_MARGIN_FLOOR_PCT: 0.015,
  VOLATILITY_LOOKBACK_POINTS: 10,
  VOLATILITY_MARGIN_MULTIPLIER: 3.0,
  VOLATILITY_MARGIN_CAP_PCT: 2.0,
  COMPETITION_BAND_PCT: 0.05,
  LIQUIDITY_MARGIN_BUFFER_PCT: { thin: 0.2, normal: 0.08, deep: 0.02 } as Record<string, number>,
  CAPITAL_EXPOSURE_MULTIPLIER: 0.02,
  CAPITAL_EXPOSURE_CAP_PCT: 0.5,
  MAX_SPREAD_CAPTURE_PCT: 0.85,
  DEPTH_TARGET_FRACTION: 0.15,
  MOMENTUM_SHORT_WINDOW: 3,
  MOMENTUM_LONG_WINDOW: 8,
  MOMENTUM_THRESHOLD_PCT: 0.05,
  IMBALANCE_THRESHOLD_PCT: 15.0,
  CROSS_PLATFORM_GAP_THRESHOLD_PCT: 0.15,
  HISTORY_MAX_POINTS: 100,
};

export type Ad = {
  adv_no: string | null;
  price: number;
  min_limit_idr: number;
  max_limit_idr: number;
  available_idr: number;
  pay_methods: string[];
  merchant_name: string;
  user_type: string;
  is_verified: boolean;
  completion_rate: number | null;
  month_order_count: number | null;
};

export type HistoryPoint = { ts: string; fair_price: number };

export type DepthInfo = {
  price: number;
  depth_reached_idr: number;
  depth_sufficient: boolean;
  ads_used: number;
};

import type { AnalyzedNews, MacroSentiment } from "./news-analyzer";

export type Snapshot = {
  timestamp: string;
  fair_price: number;
  my_sell_zone: [number, number];
  my_buy_zone: [number, number];
  my_sell_price: number;
  my_buy_price: number;
  my_buy_price_pre_fee: number;
  margin_adjusted: boolean;
  min_margin_used: number;
  margin_breakdown: Record<string, number>;
  volatility_pct: number;
  sell_density: number;
  buy_density: number;
  merchant_buy_fee_idr: number;
  capital_usdt: number;
  capital_idr: number;
  capital_share_pct: number;
  depth_target_idr: number;
  sell_depth: DepthInfo;
  buy_depth: DepthInfo;
  spread_abs: number;
  spread_pct: number;
  bias: string;
  liquidity_class: string;
  total_liquidity_idr: number;
  confidence: number;
  order_book_imbalance: {
    supply_idr: number;
    demand_idr: number;
    imbalance_pct: number;
    label: string;
  };
  momentum: { available: boolean; label: string; delta_pct?: number };
  price_outlook: { outlook: string; votes_up: number; votes_down: number; total_votes: number };
  cross_platform_gap_pct: number;
  news_items: { title: string; link: string }[];
  analyzed_news?: AnalyzedNews[];
  macro_sentiment?: MacroSentiment;
  sell_ref_dominant_cluster: Ad[];
  buy_ref_dominant_cluster: Ad[];
  sell_ref_count_raw: number;
  sell_ref_count_clean: number;
  buy_ref_count_raw: number;
  buy_ref_count_clean: number;
  sell_ref_outliers: Ad[];
  buy_ref_outliers: Ad[];
  cross_platform: Record<string, number>;
  top_sell_ref_ads: Ad[];
  top_buy_ref_ads: Ad[];
  history: HistoryPoint[];
};


/* ---------- helper statistik ---------- */
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const pstdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export function parseAds(rawAds: any[]): Ad[] {
  const parsed: Ad[] = [];
  for (const item of rawAds ?? []) {
    const adv = item?.adv ?? {};
    const seller = item?.advertiser ?? {};
    const price = Number(adv.price);
    const minLimit = Number(adv.minSingleTransAmount ?? 0);
    const maxLimit = Number(adv.maxSingleTransAmount ?? 0);
    const surplus = Number(adv.surplusAmount ?? 0);
    if (!Number.isFinite(price) || !Number.isFinite(surplus)) continue;

    const availableIdr = maxLimit ? Math.min(surplus * price, maxLimit) : surplus * price;
    parsed.push({
      adv_no: adv.advNo ?? null,
      price,
      min_limit_idr: Number.isFinite(minLimit) ? minLimit : 0,
      max_limit_idr: Number.isFinite(maxLimit) ? maxLimit : 0,
      available_idr: Math.round(availableIdr * 100) / 100,
      pay_methods: (adv.tradeMethods ?? []).map(
        (m: any) => m?.tradeMethodName ?? m?.identifier ?? "?",
      ),
      merchant_name: seller.nickName ?? "unknown",
      user_type: seller.userType ?? "user",
      is_verified: Boolean(seller.userIdentity || seller.userGrade),
      completion_rate: seller.monthFinishRate ?? null,
      month_order_count: seller.monthOrderCount ?? null,
    });
  }
  return parsed;
}

function modifiedZScores(prices: number[]) {
  const med = median(prices);
  const mad = median(prices.map((p) => Math.abs(p - med!))) || 1e-9;
  return prices.map((p) => (0.6745 * (p - med!)) / mad!);
}

export function flagOutliers(ads: Ad[]): [Ad[], Ad[]] {
  if (ads.length < 4) return [ads, []];
  const z = modifiedZScores(ads.map((a) => a.price));
  const clean: Ad[] = [];
  const outliers: Ad[] = [];
  ads.forEach((a, i) => (Math.abs(z[i]!) > CFG.OUTLIER_MAD_Z ? outliers : clean).push(a));
  return [clean, outliers];
}

export const filterMinLiquidity = (ads: Ad[]) =>
  ads.filter((a) => a.available_idr >= CFG.MIN_AD_LIQUIDITY_IDR);

export function liquidityWeightedPrice(ads: Ad[]) {
  const totalW = ads.reduce((s, a) => s + a.available_idr, 0);
  if (totalW === 0) return NaN;
  return ads.reduce((s, a) => s + a.price * a.available_idr, 0) / totalW;
}

export function priceCluster(ads: Ad[]): Ad[] {
  if (!ads.length) return [];
  const sorted = [...ads].sort((a, b) => a.price - b.price);
  const clusters: Ad[][] = [];
  let current: Ad[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if ((cur.price - prev.price) / prev.price <= CFG.CLUSTER_GAP_PCT) current.push(cur);
    else {
      clusters.push(current);
      current = [cur];
    }
  }
  clusters.push(current);
  clusters.sort(
    (a, b) =>
      b.reduce((s, x) => s + x.available_idr, 0) - a.reduce((s, x) => s + x.available_idr, 0),
  );
  return clusters[0]!;
}

export function bestZone(ads: Ad[], n = 5): [number, number] {
  const top = ads.slice(0, n);
  if (!top.length) return [NaN, NaN];
  const prices = top.map((a) => a.price);
  return [Math.min(...prices), Math.max(...prices)];
}

export function classifyLiquidity(totalIdr: number) {
  if (totalIdr < CFG.LIQUIDITY_THIN_IDR) return "thin";
  if (totalIdr > CFG.LIQUIDITY_DEEP_IDR) return "deep";
  return "normal";
}

export function confidenceScore(
  sellClean: Ad[],
  buyClean: Ad[],
  sellRaw: Ad[],
  buyRaw: Ad[],
  spreadPct: number,
) {
  let score = 0;
  score += 10 * Math.min(sellRaw.length / CFG.ROWS_PER_SIDE, 1);
  score += 10 * Math.min(buyRaw.length / CFG.ROWS_PER_SIDE, 1);
  score += 10 * (sellRaw.length ? sellClean.length / sellRaw.length : 0);
  score += 10 * (buyRaw.length ? buyClean.length / buyRaw.length : 0);
  for (const side of [sellClean, buyClean]) {
    if (side.length >= 2) {
      const prices = side.map((a) => a.price);
      const disp = pstdev(prices) / mean(prices);
      score += 12.5 * Math.max(0, 1 - disp / 0.01);
    }
  }
  const totalLiq = [...sellClean, ...buyClean].reduce((s, a) => s + a.available_idr, 0);
  score += 20 * Math.min(totalLiq / CFG.LIQUIDITY_DEEP_IDR, 1);
  if (Number.isFinite(spreadPct)) score += 15 * Math.max(0, 1 - spreadPct / 2.0);
  return Math.round(Math.min(Math.max(score, 0), 100));
}

export function computeRecentVolatilityPct(history: HistoryPoint[]) {
  const safeHistory = Array.isArray(history) ? history : [];
  const points = safeHistory.slice(-CFG.VOLATILITY_LOOKBACK_POINTS);
  if (points.length < 3) return 0;
  const prices = points.map((p) => p.fair_price);
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1]) returns.push(((prices[i]! - prices[i - 1]!) / prices[i - 1]!) * 100);
  }
  if (returns.length < 2) return returns.length ? Math.abs(returns[0]!) : 0;
  return pstdev(returns);
}


export function competitorDensity(adsBestFirst: Ad[]) {
  if (!adsBestFirst.length) return 0;
  const best = adsBestFirst[0]!.price;
  if (!best) return 0;
  let count = 0;
  for (const a of adsBestFirst) {
    if ((Math.abs(a.price - best) / best) * 100 <= CFG.COMPETITION_BAND_PCT) count++;
    else break;
  }
  return count;
}

export function computeDynamicMinMargin(args: {
  fairPrice: number;
  naturalSpreadAbs: number;
  volatilityPct: number;
  sellDensity: number;
  buyDensity: number;
  liquidityClass: string;
  capitalSharePct: number;
}): [number, Record<string, number>] {
  const floorPct = CFG.MIN_MARGIN_FLOOR_PCT;
  const volBufPct = Math.min(
    args.volatilityPct * CFG.VOLATILITY_MARGIN_MULTIPLIER,
    CFG.VOLATILITY_MARGIN_CAP_PCT,
  );
  const liqBufPct = CFG.LIQUIDITY_MARGIN_BUFFER_PCT[args.liquidityClass] ?? 0.08;
  const capitalBufPct = Math.min(
    args.capitalSharePct * CFG.CAPITAL_EXPOSURE_MULTIPLIER,
    CFG.CAPITAL_EXPOSURE_CAP_PCT,
  );

  const desiredPct = floorPct + volBufPct + liqBufPct + capitalBufPct;
  let desiredIdr = (args.fairPrice * desiredPct) / 100;

  const avgDensity = (args.sellDensity + args.buyDensity) / 2;
  const crowdFactor = avgDensity >= 5 ? 0.4 : avgDensity >= 2 ? 0.7 : 1.15;
  desiredIdr *= crowdFactor;

  let marginIdr = desiredIdr;
  if (args.naturalSpreadAbs > 0) {
    marginIdr = Math.min(marginIdr, args.naturalSpreadAbs * CFG.MAX_SPREAD_CAPTURE_PCT);
  }
  marginIdr = Math.max(
    marginIdr,
    CFG.MIN_MARGIN_FLOOR_IDR,
    (args.fairPrice * CFG.MIN_MARGIN_FLOOR_PCT) / 100,
  );

  return [
    marginIdr,
    {
      floor_pct: floorPct,
      vol_buf_pct: volBufPct,
      liq_buf_pct: liqBufPct,
      capital_buf_pct: capitalBufPct,
      capital_share_pct: args.capitalSharePct,
      crowd_factor: crowdFactor,
      sell_density: args.sellDensity,
      buy_density: args.buyDensity,
      volatility_pct: args.volatilityPct,
    },
  ];
}

export function depthAwareReferencePrice(adsBestFirst: Ad[], targetIdr: number): DepthInfo {
  if (!adsBestFirst.length)
    return { price: NaN, depth_reached_idr: 0, depth_sufficient: false, ads_used: 0 };
  let cum = 0;
  let lastPrice = adsBestFirst[0]!.price;
  let used = 0;
  for (const a of adsBestFirst) {
    cum += a.available_idr;
    lastPrice = a.price;
    used++;
    if (cum >= targetIdr)
      return { price: lastPrice, depth_reached_idr: cum, depth_sufficient: true, ads_used: used };
  }
  return { price: lastPrice, depth_reached_idr: cum, depth_sufficient: false, ads_used: used };
}

export function computeOrderBookImbalance(sellClean: Ad[], buyClean: Ad[]) {
  const supply = sellClean.reduce((s, a) => s + a.available_idr, 0);
  const demand = buyClean.reduce((s, a) => s + a.available_idr, 0);
  const total = supply + demand;
  if (total === 0)
    return {
      supply_idr: 0,
      demand_idr: 0,
      imbalance_pct: 0,
      label: "netral (data kosong)",
    };
  const imbalancePct = ((demand - supply) / total) * 100;
  const label =
    imbalancePct > CFG.IMBALANCE_THRESHOLD_PCT
      ? "demand > supply → condong naik"
      : imbalancePct < -CFG.IMBALANCE_THRESHOLD_PCT
        ? "supply > demand → condong turun"
        : "seimbang";
  return { supply_idr: supply, demand_idr: demand, imbalance_pct: imbalancePct, label };
}

export function computeMomentumSignal(history: HistoryPoint[]) {
  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.length < CFG.MOMENTUM_LONG_WINDOW)
    return { available: false, label: "belum cukup histori" };
  const prices = safeHistory.map((p) => p.fair_price);
  const shortAvg = mean(prices.slice(-CFG.MOMENTUM_SHORT_WINDOW));
  const longAvg = mean(prices.slice(-CFG.MOMENTUM_LONG_WINDOW));
  const deltaPct = longAvg ? ((shortAvg - longAvg) / longAvg) * 100 : 0;
  const label =
    deltaPct > CFG.MOMENTUM_THRESHOLD_PCT
      ? "momentum condong naik"
      : deltaPct < -CFG.MOMENTUM_THRESHOLD_PCT
        ? "momentum condong turun"
        : "momentum netral";
  return { available: true, delta_pct: deltaPct, label };
}

export function computePriceOutlook(
  momentum: { available: boolean; delta_pct?: number },
  imbalance: { imbalance_pct: number },
  crossGapPct: number,
) {
  let up = 0;
  let down = 0;
  let total = 0;

  if (momentum.available) {
    total++;
    if ((momentum.delta_pct ?? 0) > CFG.MOMENTUM_THRESHOLD_PCT) up++;
    else if ((momentum.delta_pct ?? 0) < -CFG.MOMENTUM_THRESHOLD_PCT) down++;
  }
  if (imbalance && imbalance.imbalance_pct !== undefined) {
    total++;
    if (imbalance.imbalance_pct > CFG.IMBALANCE_THRESHOLD_PCT) up++;
    else if (imbalance.imbalance_pct < -CFG.IMBALANCE_THRESHOLD_PCT) down++;
  }
  if (Number.isFinite(crossGapPct)) {
    total++;
    if (crossGapPct > CFG.CROSS_PLATFORM_GAP_THRESHOLD_PCT) up++;
    else if (crossGapPct < -CFG.CROSS_PLATFORM_GAP_THRESHOLD_PCT) down++;
  }

  const outlook =
    total === 0
      ? "netral (belum cukup sinyal)"
      : up > down
        ? `condong naik (${up}/${total} sinyal)`
        : down > up
          ? `condong turun (${down}/${total} sinyal)`
          : `campuran/netral (${up} naik vs ${down} turun dari ${total} sinyal)`;

  return { outlook, votes_up: up, votes_down: down, total_votes: total };
}

export function computeBias(history: HistoryPoint[], currentFairPrice: number) {
  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.length < 3) return "neutral (histori belum cukup)";
  const ref = mean(safeHistory.slice(-5).map((p) => p.fair_price));
  const deltaPct = ((currentFairPrice - ref) / ref) * 100;
  if (deltaPct > CFG.BIAS_THRESHOLD_PCT) return "bullish";
  if (deltaPct < -CFG.BIAS_THRESHOLD_PCT) return "bearish";
  return "neutral";
}


/** Rangkai analisis lengkap dari data mentah yang sudah di-fetch. */
export function buildSnapshot(input: {
  sellRefRaw: Ad[]; // tab "Buy" = kompetitor JUAL → acuan iklan JUAL saya
  buyRefRaw: Ad[]; // tab "Sell" = kompetitor BELI → acuan iklan BELI saya
  crossPlatform: Record<string, number>;
  newsItems: { title: string; link: string }[];
  analyzedNews?: AnalyzedNews[];
  macroSentiment?: MacroSentiment;
  history: HistoryPoint[];
  capitalUsdt: number;
  buyFeeIdr: number;
}): Snapshot {

  const now = new Date().toISOString();
  const { sellRefRaw, buyRefRaw, history } = input;

  const [sellClean, sellOutliers] = flagOutliers(filterMinLiquidity(sellRefRaw));
  const [buyClean, buyOutliers] = flagOutliers(filterMinLiquidity(buyRefRaw));

  const sellSorted = [...sellClean].sort((a, b) => a.price - b.price);
  const buySorted = [...buyClean].sort((a, b) => b.price - a.price);

  const mySellZone = bestZone(sellSorted, 5);
  const myBuyZone = bestZone(buySorted, 5);

  // ── 1. Referensi Harga Pasar Kompetitor Teratas & Klaster Dominan ────────
  // buySorted: sorted descending (pembeli USDT tertinggi di rank 0)
  // sellSorted: sorted ascending (penjual USDT terendah di rank 0)
  const topBuyCompetitor = buySorted[0]?.price ?? NaN;
  const topSellCompetitor = sellSorted[0]?.price ?? NaN;

  const buyDominantCluster = priceCluster(buyClean);
  const clusterBuyPrice = buyDominantCluster.length ? Math.max(...buyDominantCluster.map((a) => a.price)) : topBuyCompetitor;

  const sellDominantCluster = priceCluster(sellClean);
  const clusterSellPrice = sellDominantCluster.length ? Math.min(...sellDominantCluster.map((a) => a.price)) : topSellCompetitor;

  // ── 2. Integrasi Benchmark Multi-Platform (Indodax, Bybit, OKX, CoinGecko, Forex) ──
  const validCrossPrices = Object.values(input.crossPlatform).filter((v) => Number.isFinite(v) && v > 0);
  const crossBenchmark = validCrossPrices.length ? mean(validCrossPrices) : NaN;

  // Fair price: Konsensus tertimbang likuiditas order book + anchor cross-platform
  const lwpSell = liquidityWeightedPrice(sellClean);
  const lwpBuy = liquidityWeightedPrice(buyClean);
  let fairPrice =
    Number.isFinite(lwpSell) && Number.isFinite(lwpBuy)
      ? (lwpSell + lwpBuy) / 2
      : ([lwpSell, lwpBuy].find((v) => Number.isFinite(v)) ?? NaN);

  if (Number.isFinite(fairPrice) && Number.isFinite(crossBenchmark)) {
    // 70% bobot P2P orderbook + 30% bobot cross-platform benchmark
    fairPrice = fairPrice * 0.7 + crossBenchmark * 0.3;
  } else if (!Number.isFinite(fairPrice) && Number.isFinite(crossBenchmark)) {
    fairPrice = crossBenchmark;
  }

  const totalLiquidity = [...sellClean, ...buyClean].reduce((s, a) => s + a.available_idr, 0);
  const liquidityClass = classifyLiquidity(totalLiquidity);
  const volatilityPct = computeRecentVolatilityPct(history);
  const sellDensity = competitorDensity(sellSorted);
  const buyDensity = competitorDensity(buySorted);

  const capitalIdr = Number.isFinite(fairPrice) ? input.capitalUsdt * fairPrice : NaN;
  const capitalSharePct =
    Number.isFinite(capitalIdr) && totalLiquidity > 0 ? (capitalIdr / totalLiquidity) * 100 : 0;
  const depthTargetIdr = Number.isFinite(capitalIdr) ? capitalIdr * CFG.DEPTH_TARGET_FRACTION : 0;

  const sellDepth = depthAwareReferencePrice(sellSorted, depthTargetIdr);
  const buyDepth = depthAwareReferencePrice(buySorted, depthTargetIdr);

  // ── 3. Kalkulasi Target Beli (Ambil Stok) & Target Jual (Lepas Stok) ──────
  // Target Beli (Iklan BELI):
  // Menempati Rank #1 di orderbook dengan pasang +1 Rupiah di atas kompetitor teratas.
  // Tidak boleh overpay di atas pasar!
  let candidateBuy: number;
  if (Number.isFinite(topBuyCompetitor)) {
    const isOutlierJump = clusterBuyPrice && topBuyCompetitor > clusterBuyPrice && (topBuyCompetitor - clusterBuyPrice) / clusterBuyPrice > 0.003;
    const refBuyBase = isOutlierJump ? clusterBuyPrice : (Number.isFinite(buyDepth.price) ? Math.max(buyDepth.price, topBuyCompetitor) : topBuyCompetitor);

    // Pasang +1 IDR di atas kompetitor untuk memenangkan antrian orderbook (rank 1 fill priority)
    candidateBuy = Math.round(refBuyBase + 1);

    // Proteksi batas atas: Jangan beli di atas fair price atau terlalu dekat dengan harga jual
    if (Number.isFinite(topSellCompetitor)) {
      candidateBuy = Math.min(candidateBuy, Math.round(topSellCompetitor - 15));
    }
    if (Number.isFinite(fairPrice)) {
      candidateBuy = Math.min(candidateBuy, Math.round(fairPrice - 2));
    }
  } else if (Number.isFinite(fairPrice)) {
    candidateBuy = Math.round(fairPrice - 20);
  } else {
    candidateBuy = NaN;
  }

  // Target Jual (Iklan JUAL):
  // Menempati Rank #1 di orderbook dengan pasang -1 Rupiah di bawah kompetitor terendah.
  let candidateSell: number;
  if (Number.isFinite(topSellCompetitor)) {
    const isOutlierDrop = clusterSellPrice && topSellCompetitor < clusterSellPrice && (clusterSellPrice - topSellCompetitor) / clusterSellPrice > 0.003;
    const refSellBase = isOutlierDrop ? clusterSellPrice : (Number.isFinite(sellDepth.price) ? Math.min(sellDepth.price, topSellCompetitor) : topSellCompetitor);

    // Pasang -1 IDR di bawah kompetitor untuk memenangkan antrian sell orderbook (rank 1)
    candidateSell = Math.round(refSellBase - 1);

    // Proteksi batas bawah: Jangan jual di bawah fair price
    if (Number.isFinite(fairPrice)) {
      candidateSell = Math.max(candidateSell, Math.round(fairPrice + 2));
    }
  } else if (Number.isFinite(fairPrice)) {
    candidateSell = Math.round(fairPrice + 20);
  } else {
    candidateSell = NaN;
  }

  // ── 4. Penegakan Minimum Margin & Proteksi Fee 2 Arah (0.14%) ──────────────
  let marginAdjusted = false;
  let minMarginUsed = NaN;
  let marginBreakdown: Record<string, number> = {};
  let myBuyPrice = candidateBuy;
  let mySellPrice = candidateSell;

  if (Number.isFinite(candidateBuy) && Number.isFinite(candidateSell)) {
    const base = Number.isFinite(fairPrice) ? fairPrice : candidateBuy;
    const naturalMargin = candidateSell - candidateBuy;
    [minMarginUsed, marginBreakdown] = computeDynamicMinMargin({
      fairPrice: base,
      naturalSpreadAbs: naturalMargin,
      volatilityPct,
      sellDensity,
      buyDensity,
      liquidityClass,
      capitalSharePct,
    });

    // Minimum spread absolut yang wajib dipertahankan (menutup 0.14% fee ~Rp 23 + minimal profit)
    const absoluteMinSpread = Math.max(minMarginUsed, Math.round(base * 0.0016));

    if (naturalMargin >= absoluteMinSpread) {
      myBuyPrice = candidateBuy;
      mySellPrice = candidateSell;
    } else {
      // Jika spread pasar terlalu sempit, lebarkan secara proporsional dari titik tengah
      const deficit = absoluteMinSpread - naturalMargin;
      myBuyPrice = Math.round(candidateBuy - deficit / 2);
      mySellPrice = Math.round(candidateSell + deficit / 2);
      marginAdjusted = true;
      minMarginUsed = absoluteMinSpread;
    }
  }

  const myBuyPricePreFee = myBuyPrice;
  const spreadAbs =
    Number.isFinite(mySellPrice) && Number.isFinite(myBuyPrice) ? mySellPrice - myBuyPrice : NaN;
  const spreadPct =
    Number.isFinite(spreadAbs) && myBuyPrice ? (spreadAbs / myBuyPrice) * 100 : NaN;

  const crossGaps: number[] = [];
  if (Number.isFinite(fairPrice)) {
    for (const v of Object.values(input.crossPlatform)) {
      if (v) crossGaps.push(((fairPrice - v) / v) * 100);
    }
  }
  const crossPlatformGapPct = crossGaps.length ? mean(crossGaps) : NaN;

  const bias = Number.isFinite(fairPrice)
    ? computeBias(history, fairPrice)
    : "neutral (data tidak cukup)";

  const nextHistory = Number.isFinite(fairPrice)
    ? [...history, { ts: now, fair_price: fairPrice }].slice(-CFG.HISTORY_MAX_POINTS)
    : history;

  const imbalance = computeOrderBookImbalance(sellClean, buyClean);
  const momentum = computeMomentumSignal(history);
  const outlook = computePriceOutlook(momentum, imbalance, crossPlatformGapPct);

  return {
    timestamp: now,
    fair_price: fairPrice,
    my_sell_zone: mySellZone,
    my_buy_zone: myBuyZone,
    my_sell_price: mySellPrice,
    my_buy_price: myBuyPrice,
    my_buy_price_pre_fee: myBuyPricePreFee,
    margin_adjusted: marginAdjusted,
    min_margin_used: minMarginUsed,
    margin_breakdown: marginBreakdown,
    volatility_pct: volatilityPct,
    sell_density: sellDensity,
    buy_density: buyDensity,
    merchant_buy_fee_idr: input.buyFeeIdr,
    capital_usdt: input.capitalUsdt,
    capital_idr: capitalIdr,
    capital_share_pct: capitalSharePct,
    depth_target_idr: depthTargetIdr,
    sell_depth: sellDepth,
    buy_depth: buyDepth,
    spread_abs: spreadAbs,
    spread_pct: spreadPct,
    bias,
    liquidity_class: liquidityClass,
    total_liquidity_idr: totalLiquidity,
    confidence: confidenceScore(sellClean, buyClean, sellRefRaw, buyRefRaw, spreadPct),
    order_book_imbalance: imbalance,
    momentum,
    price_outlook: outlook,
    cross_platform_gap_pct: crossPlatformGapPct,
    news_items: input.newsItems,
    analyzed_news: input.analyzedNews ?? [],
    macro_sentiment: input.macroSentiment,
    sell_ref_dominant_cluster: sellDominantCluster,
    buy_ref_dominant_cluster: buyDominantCluster,
    sell_ref_count_raw: sellRefRaw.length,
    sell_ref_count_clean: sellClean.length,
    buy_ref_count_raw: buyRefRaw.length,
    buy_ref_count_clean: buyClean.length,
    sell_ref_outliers: sellOutliers,
    buy_ref_outliers: buyOutliers,
    cross_platform: input.crossPlatform,
    top_sell_ref_ads: sellSorted.slice(0, 5),
    top_buy_ref_ads: buySorted.slice(0, 5),
    history: nextHistory,
  };
}


/* ---------- formatter tampilan ---------- */
export const fmtRp = (x: number) =>
  Number.isFinite(x)
    ? "Rp " + Math.round(x).toLocaleString("id-ID")
    : "—";

export const fmtRp2 = (x: number) =>
  Number.isFinite(x)
    ? "Rp " + x.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

export const fmtPct = (x: number, d = 2) => (Number.isFinite(x) ? `${x.toFixed(d)}%` : "—");

export const liquidityLabel = (c: string) =>
  ({ thin: "Tipis", normal: "Normal", deep: "Dalam" })[c] ?? c;

export const biasLabel = (b: string) =>
  b.startsWith("bullish")
    ? "Cenderung naik"
    : b.startsWith("bearish")
      ? "Cenderung turun"
      : "Datar / netral";

export const confidenceLabel = (s: number) =>
  s >= 80 ? "Sangat bisa dipercaya" : s >= 60 ? "Cukup bisa dipercaya" : s >= 40 ? "Hati-hati" : "Rapuh";
