//#region node_modules/.nitro/vite/services/ssr/assets/p2p-engine-ZnsxIhXi.js
/**
* Mesin analisis Binance P2P USDT/IDR dari perspektif MERCHANT.
* Port dari skrip Python (binance.py) — semua rumus & ambang dipertahankan.
*/
var CFG = {
	ASSET: "USDT",
	FIAT: "IDR",
	ROWS_PER_SIDE: 20,
	MIN_AD_LIQUIDITY_IDR: 1e6,
	OUTLIER_MAD_Z: 3.5,
	CLUSTER_GAP_PCT: .0015,
	LIQUIDITY_THIN_IDR: 5e7,
	LIQUIDITY_DEEP_IDR: 3e8,
	BIAS_THRESHOLD_PCT: .1,
	MIN_MARGIN_FLOOR_IDR: 8,
	MIN_MARGIN_FLOOR_PCT: .015,
	VOLATILITY_LOOKBACK_POINTS: 10,
	VOLATILITY_MARGIN_MULTIPLIER: 3,
	VOLATILITY_MARGIN_CAP_PCT: 2,
	COMPETITION_BAND_PCT: .05,
	LIQUIDITY_MARGIN_BUFFER_PCT: {
		thin: .2,
		normal: .08,
		deep: .02
	},
	CAPITAL_EXPOSURE_MULTIPLIER: .02,
	CAPITAL_EXPOSURE_CAP_PCT: .5,
	MAX_SPREAD_CAPTURE_PCT: .85,
	DEPTH_TARGET_FRACTION: .15,
	MOMENTUM_SHORT_WINDOW: 3,
	MOMENTUM_LONG_WINDOW: 8,
	MOMENTUM_THRESHOLD_PCT: .05,
	IMBALANCE_THRESHOLD_PCT: 15,
	CROSS_PLATFORM_GAP_THRESHOLD_PCT: .15,
	HISTORY_MAX_POINTS: 100
};
var mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
var median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
var pstdev = (xs) => {
	if (xs.length < 2) return 0;
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
function parseAds(rawAds) {
	const parsed = [];
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
			pay_methods: (adv.tradeMethods ?? []).map((m) => m?.tradeMethodName ?? m?.identifier ?? "?"),
			merchant_name: seller.nickName ?? "unknown",
			user_type: seller.userType ?? "user",
			is_verified: Boolean(seller.userIdentity || seller.userGrade),
			completion_rate: seller.monthFinishRate ?? null,
			month_order_count: seller.monthOrderCount ?? null
		});
	}
	return parsed;
}
function modifiedZScores(prices) {
	const med = median(prices);
	const mad = median(prices.map((p) => Math.abs(p - med))) || 1e-9;
	return prices.map((p) => .6745 * (p - med) / mad);
}
function flagOutliers(ads) {
	if (ads.length < 4) return [ads, []];
	const z = modifiedZScores(ads.map((a) => a.price));
	const clean = [];
	const outliers = [];
	ads.forEach((a, i) => (Math.abs(z[i]) > CFG.OUTLIER_MAD_Z ? outliers : clean).push(a));
	return [clean, outliers];
}
var filterMinLiquidity = (ads) => ads.filter((a) => a.available_idr >= CFG.MIN_AD_LIQUIDITY_IDR);
function liquidityWeightedPrice(ads) {
	const totalW = ads.reduce((s, a) => s + a.available_idr, 0);
	if (totalW === 0) return NaN;
	return ads.reduce((s, a) => s + a.price * a.available_idr, 0) / totalW;
}
function priceCluster(ads) {
	if (!ads.length) return [];
	const sorted = [...ads].sort((a, b) => a.price - b.price);
	const clusters = [];
	let current = [sorted[0]];
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		if ((cur.price - prev.price) / prev.price <= CFG.CLUSTER_GAP_PCT) current.push(cur);
		else {
			clusters.push(current);
			current = [cur];
		}
	}
	clusters.push(current);
	clusters.sort((a, b) => b.reduce((s, x) => s + x.available_idr, 0) - a.reduce((s, x) => s + x.available_idr, 0));
	return clusters[0];
}
function bestZone(ads, n = 5) {
	const top = ads.slice(0, n);
	if (!top.length) return [NaN, NaN];
	const prices = top.map((a) => a.price);
	return [Math.min(...prices), Math.max(...prices)];
}
function classifyLiquidity(totalIdr) {
	if (totalIdr < CFG.LIQUIDITY_THIN_IDR) return "thin";
	if (totalIdr > CFG.LIQUIDITY_DEEP_IDR) return "deep";
	return "normal";
}
function confidenceScore(sellClean, buyClean, sellRaw, buyRaw, spreadPct) {
	let score = 0;
	score += 10 * Math.min(sellRaw.length / CFG.ROWS_PER_SIDE, 1);
	score += 10 * Math.min(buyRaw.length / CFG.ROWS_PER_SIDE, 1);
	score += 10 * (sellRaw.length ? sellClean.length / sellRaw.length : 0);
	score += 10 * (buyRaw.length ? buyClean.length / buyRaw.length : 0);
	for (const side of [sellClean, buyClean]) if (side.length >= 2) {
		const prices = side.map((a) => a.price);
		const disp = pstdev(prices) / mean(prices);
		score += 12.5 * Math.max(0, 1 - disp / .01);
	}
	const totalLiq = [...sellClean, ...buyClean].reduce((s, a) => s + a.available_idr, 0);
	score += 20 * Math.min(totalLiq / CFG.LIQUIDITY_DEEP_IDR, 1);
	if (Number.isFinite(spreadPct)) score += 15 * Math.max(0, 1 - spreadPct / 2);
	return Math.round(Math.min(Math.max(score, 0), 100));
}
function computeRecentVolatilityPct(history) {
	const points = history.slice(-CFG.VOLATILITY_LOOKBACK_POINTS);
	if (points.length < 3) return 0;
	const prices = points.map((p) => p.fair_price);
	const returns = [];
	for (let i = 1; i < prices.length; i++) if (prices[i - 1]) returns.push((prices[i] - prices[i - 1]) / prices[i - 1] * 100);
	if (returns.length < 2) return returns.length ? Math.abs(returns[0]) : 0;
	return pstdev(returns);
}
function competitorDensity(adsBestFirst) {
	if (!adsBestFirst.length) return 0;
	const best = adsBestFirst[0].price;
	if (!best) return 0;
	let count = 0;
	for (const a of adsBestFirst) if (Math.abs(a.price - best) / best * 100 <= CFG.COMPETITION_BAND_PCT) count++;
	else break;
	return count;
}
function computeDynamicMinMargin(args) {
	const floorPct = CFG.MIN_MARGIN_FLOOR_PCT;
	const volBufPct = Math.min(args.volatilityPct * CFG.VOLATILITY_MARGIN_MULTIPLIER, CFG.VOLATILITY_MARGIN_CAP_PCT);
	const liqBufPct = CFG.LIQUIDITY_MARGIN_BUFFER_PCT[args.liquidityClass] ?? .08;
	const capitalBufPct = Math.min(args.capitalSharePct * CFG.CAPITAL_EXPOSURE_MULTIPLIER, CFG.CAPITAL_EXPOSURE_CAP_PCT);
	const desiredPct = floorPct + volBufPct + liqBufPct + capitalBufPct;
	let desiredIdr = args.fairPrice * desiredPct / 100;
	const avgDensity = (args.sellDensity + args.buyDensity) / 2;
	const crowdFactor = avgDensity >= 5 ? .4 : avgDensity >= 2 ? .7 : 1.15;
	desiredIdr *= crowdFactor;
	let marginIdr = desiredIdr;
	if (args.naturalSpreadAbs > 0) marginIdr = Math.min(marginIdr, args.naturalSpreadAbs * CFG.MAX_SPREAD_CAPTURE_PCT);
	marginIdr = Math.max(marginIdr, CFG.MIN_MARGIN_FLOOR_IDR, args.fairPrice * CFG.MIN_MARGIN_FLOOR_PCT / 100);
	return [marginIdr, {
		floor_pct: floorPct,
		vol_buf_pct: volBufPct,
		liq_buf_pct: liqBufPct,
		capital_buf_pct: capitalBufPct,
		capital_share_pct: args.capitalSharePct,
		crowd_factor: crowdFactor,
		sell_density: args.sellDensity,
		buy_density: args.buyDensity,
		volatility_pct: args.volatilityPct
	}];
}
function depthAwareReferencePrice(adsBestFirst, targetIdr) {
	if (!adsBestFirst.length) return {
		price: NaN,
		depth_reached_idr: 0,
		depth_sufficient: false,
		ads_used: 0
	};
	let cum = 0;
	let lastPrice = adsBestFirst[0].price;
	let used = 0;
	for (const a of adsBestFirst) {
		cum += a.available_idr;
		lastPrice = a.price;
		used++;
		if (cum >= targetIdr) return {
			price: lastPrice,
			depth_reached_idr: cum,
			depth_sufficient: true,
			ads_used: used
		};
	}
	return {
		price: lastPrice,
		depth_reached_idr: cum,
		depth_sufficient: false,
		ads_used: used
	};
}
function computeOrderBookImbalance(sellClean, buyClean) {
	const supply = sellClean.reduce((s, a) => s + a.available_idr, 0);
	const demand = buyClean.reduce((s, a) => s + a.available_idr, 0);
	const total = supply + demand;
	if (total === 0) return {
		supply_idr: 0,
		demand_idr: 0,
		imbalance_pct: 0,
		label: "netral (data kosong)"
	};
	const imbalancePct = (demand - supply) / total * 100;
	return {
		supply_idr: supply,
		demand_idr: demand,
		imbalance_pct: imbalancePct,
		label: imbalancePct > CFG.IMBALANCE_THRESHOLD_PCT ? "demand > supply → condong naik" : imbalancePct < -CFG.IMBALANCE_THRESHOLD_PCT ? "supply > demand → condong turun" : "seimbang"
	};
}
function computeMomentumSignal(history) {
	if (history.length < CFG.MOMENTUM_LONG_WINDOW) return {
		available: false,
		label: "belum cukup histori"
	};
	const prices = history.map((p) => p.fair_price);
	const shortAvg = mean(prices.slice(-CFG.MOMENTUM_SHORT_WINDOW));
	const longAvg = mean(prices.slice(-CFG.MOMENTUM_LONG_WINDOW));
	const deltaPct = longAvg ? (shortAvg - longAvg) / longAvg * 100 : 0;
	return {
		available: true,
		delta_pct: deltaPct,
		label: deltaPct > CFG.MOMENTUM_THRESHOLD_PCT ? "momentum condong naik" : deltaPct < -CFG.MOMENTUM_THRESHOLD_PCT ? "momentum condong turun" : "momentum netral"
	};
}
function computePriceOutlook(momentum, imbalance, crossGapPct) {
	let up = 0;
	let down = 0;
	let total = 0;
	if (momentum.available) {
		total++;
		if ((momentum.delta_pct ?? 0) > CFG.MOMENTUM_THRESHOLD_PCT) up++;
		else if ((momentum.delta_pct ?? 0) < -CFG.MOMENTUM_THRESHOLD_PCT) down++;
	}
	if (imbalance && imbalance.imbalance_pct !== void 0) {
		total++;
		if (imbalance.imbalance_pct > CFG.IMBALANCE_THRESHOLD_PCT) up++;
		else if (imbalance.imbalance_pct < -CFG.IMBALANCE_THRESHOLD_PCT) down++;
	}
	if (Number.isFinite(crossGapPct)) {
		total++;
		if (crossGapPct > CFG.CROSS_PLATFORM_GAP_THRESHOLD_PCT) up++;
		else if (crossGapPct < -CFG.CROSS_PLATFORM_GAP_THRESHOLD_PCT) down++;
	}
	return {
		outlook: total === 0 ? "netral (belum cukup sinyal)" : up > down ? `condong naik (${up}/${total} sinyal)` : down > up ? `condong turun (${down}/${total} sinyal)` : `campuran/netral (${up} naik vs ${down} turun dari ${total} sinyal)`,
		votes_up: up,
		votes_down: down,
		total_votes: total
	};
}
function computeBias(history, currentFairPrice) {
	if (history.length < 3) return "neutral (histori belum cukup)";
	const ref = mean(history.slice(-5).map((p) => p.fair_price));
	const deltaPct = (currentFairPrice - ref) / ref * 100;
	if (deltaPct > CFG.BIAS_THRESHOLD_PCT) return "bullish";
	if (deltaPct < -CFG.BIAS_THRESHOLD_PCT) return "bearish";
	return "neutral";
}
/** Rangkai analisis lengkap dari data mentah yang sudah di-fetch. */
function buildSnapshot(input) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const { sellRefRaw, buyRefRaw, history } = input;
	const [sellClean, sellOutliers] = flagOutliers(filterMinLiquidity(sellRefRaw));
	const [buyClean, buyOutliers] = flagOutliers(filterMinLiquidity(buyRefRaw));
	const sellSorted = [...sellClean].sort((a, b) => a.price - b.price);
	const buySorted = [...buyClean].sort((a, b) => b.price - a.price);
	const mySellZone = bestZone(sellSorted, 5);
	const myBuyZone = bestZone(buySorted, 5);
	const lwpSell = liquidityWeightedPrice(sellClean);
	const lwpBuy = liquidityWeightedPrice(buyClean);
	const fairPrice = Number.isFinite(lwpSell) && Number.isFinite(lwpBuy) ? (lwpSell + lwpBuy) / 2 : [lwpSell, lwpBuy].find((v) => Number.isFinite(v)) ?? NaN;
	const totalLiquidity = [...sellClean, ...buyClean].reduce((s, a) => s + a.available_idr, 0);
	const liquidityClass = classifyLiquidity(totalLiquidity);
	const volatilityPct = computeRecentVolatilityPct(history);
	const sellDensity = competitorDensity(sellSorted);
	const buyDensity = competitorDensity(buySorted);
	const capitalIdr = Number.isFinite(fairPrice) ? input.capitalUsdt * fairPrice : NaN;
	const capitalSharePct = Number.isFinite(capitalIdr) && totalLiquidity > 0 ? capitalIdr / totalLiquidity * 100 : 0;
	const depthTargetIdr = Number.isFinite(capitalIdr) ? capitalIdr * CFG.DEPTH_TARGET_FRACTION : 0;
	const sellDepth = depthAwareReferencePrice(sellSorted, depthTargetIdr);
	const buyDepth = depthAwareReferencePrice(buySorted, depthTargetIdr);
	const buyRefPrice = Number.isFinite(buyDepth.price) ? buyDepth.price : myBuyZone[1];
	const sellRefPrice = Number.isFinite(sellDepth.price) ? sellDepth.price : mySellZone[0];
	const candidateBuy = Number.isFinite(buyRefPrice) ? buyRefPrice + input.buyFeeIdr : NaN;
	const candidateSell = sellRefPrice;
	let marginAdjusted = false;
	let minMarginUsed = NaN;
	let marginBreakdown = {};
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
			capitalSharePct
		});
		if (naturalMargin >= minMarginUsed) {
			myBuyPrice = candidateBuy;
			mySellPrice = candidateSell;
		} else {
			const mid = (candidateBuy + candidateSell) / 2;
			myBuyPrice = mid - minMarginUsed / 2;
			mySellPrice = mid + minMarginUsed / 2;
			marginAdjusted = true;
		}
	}
	const myBuyPricePreFee = Number.isFinite(myBuyPrice) ? myBuyPrice - input.buyFeeIdr : NaN;
	const spreadAbs = Number.isFinite(mySellPrice) && Number.isFinite(myBuyPrice) ? mySellPrice - myBuyPrice : NaN;
	const spreadPct = Number.isFinite(spreadAbs) && myBuyPrice ? spreadAbs / myBuyPrice * 100 : NaN;
	const crossGaps = [];
	if (Number.isFinite(fairPrice)) {
		for (const v of Object.values(input.crossPlatform)) if (v) crossGaps.push((fairPrice - v) / v * 100);
	}
	const crossPlatformGapPct = crossGaps.length ? mean(crossGaps) : NaN;
	const bias = Number.isFinite(fairPrice) ? computeBias(history, fairPrice) : "neutral (data tidak cukup)";
	const nextHistory = Number.isFinite(fairPrice) ? [...history, {
		ts: now,
		fair_price: fairPrice
	}].slice(-CFG.HISTORY_MAX_POINTS) : history;
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
		sell_ref_dominant_cluster: priceCluster(sellClean),
		buy_ref_dominant_cluster: priceCluster(buyClean),
		sell_ref_count_raw: sellRefRaw.length,
		sell_ref_count_clean: sellClean.length,
		buy_ref_count_raw: buyRefRaw.length,
		buy_ref_count_clean: buyClean.length,
		sell_ref_outliers: sellOutliers,
		buy_ref_outliers: buyOutliers,
		cross_platform: input.crossPlatform,
		top_sell_ref_ads: sellSorted.slice(0, 5),
		top_buy_ref_ads: buySorted.slice(0, 5),
		history: nextHistory
	};
}
var fmtRp = (x) => Number.isFinite(x) ? "Rp " + Math.round(x).toLocaleString("id-ID") : "—";
var fmtRp2 = (x) => Number.isFinite(x) ? "Rp " + x.toLocaleString("id-ID", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
}) : "—";
var fmtPct = (x, d = 2) => Number.isFinite(x) ? `${x.toFixed(d)}%` : "—";
var liquidityLabel = (c) => ({
	thin: "Tipis",
	normal: "Normal",
	deep: "Dalam"
})[c] ?? c;
var biasLabel = (b) => b.startsWith("bullish") ? "Cenderung naik" : b.startsWith("bearish") ? "Cenderung turun" : "Datar / netral";
var confidenceLabel = (s) => s >= 80 ? "Sangat bisa dipercaya" : s >= 60 ? "Cukup bisa dipercaya" : s >= 40 ? "Hati-hati" : "Rapuh";
//#endregion
export { fmtPct as a, liquidityLabel as c, confidenceLabel as i, parseAds as l, biasLabel as n, fmtRp as o, buildSnapshot as r, fmtRp2 as s, CFG as t };
