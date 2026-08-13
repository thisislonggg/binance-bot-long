import { c as createServerFn, i as TSS_SERVER_FUNCTION } from "./createServerFn-CIHAFgYl.mjs";
import { l as parseAds, r as buildSnapshot, t as CFG } from "./p2p-engine-ZnsxIhXi.mjs";
import { i as stringType, n as numberType, r as objectType, t as arrayType } from "../_libs/zod.mjs";
import { t as createClient } from "../_libs/supabase__supabase-js.mjs";
import processModule from "node:process";
//#region node_modules/.nitro/vite/services/ssr/assets/p2p.functions-CeUxwZ-z.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var client = null;
function getSupabase() {
	const url = processModule.env.SUPABASE_URL;
	const key = processModule.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) return null;
	if (!client) client = createClient(url, key, { auth: { persistSession: false } });
	return client;
}
var BINANCE_P2P_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
var INDODAX_TICKER_URL = "https://indodax.com/api/ticker/usdtidr";
var COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr";
var HEADERS = {
	"Content-Type": "application/json",
	"User-Agent": "Mozilla/5.0"
};
async function fetchP2pAds(tradeType) {
	try {
		const resp = await fetch(BINANCE_P2P_URL, {
			method: "POST",
			headers: HEADERS,
			body: JSON.stringify({
				page: 1,
				rows: CFG.ROWS_PER_SIDE,
				payTypes: [],
				asset: CFG.ASSET,
				tradeType,
				fiat: CFG.FIAT,
				publisherType: null,
				merchantCheck: false
			})
		});
		if (!resp.ok) return [];
		return parseAds((await resp.json())?.data ?? []);
	} catch {
		return [];
	}
}
async function fetchCrossPlatform() {
	const refs = {};
	await Promise.all([(async () => {
		try {
			const r = await (await fetch(INDODAX_TICKER_URL)).json();
			const v = Number(r?.ticker?.last);
			if (Number.isFinite(v)) refs["indodax_usdt_idr_spot"] = v;
		} catch {}
	})(), (async () => {
		try {
			const r = await (await fetch(COINGECKO_URL)).json();
			const v = Number(r?.tether?.idr);
			if (Number.isFinite(v)) refs["coingecko_usdt_idr"] = v;
		} catch {}
	})()]);
	return refs;
}
async function fetchNews() {
	const query = "rupiah OR USDT OR tether OR kripto Indonesia OR stablecoin";
	try {
		const resp = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`, { headers: { "User-Agent": "Mozilla/5.0" } });
		if (!resp.ok) return [];
		const xml = await resp.text();
		const items = [];
		const itemRe = /<item>([\s\S]*?)<\/item>/g;
		let m;
		while ((m = itemRe.exec(xml)) && items.length < 3) {
			const block = m[1] ?? "";
			const title = (/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block)?.[1] ?? "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").trim();
			const link = (/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/.exec(block)?.[1] ?? "").trim();
			if (title) items.push({
				title,
				link
			});
		}
		return items;
	} catch {
		return [];
	}
}
async function loadHistoryFromDb() {
	const db = getSupabase();
	if (!db) return [];
	const { data, error } = await db.from("price_history").select("ts, fair_price").order("ts", { ascending: false }).limit(CFG.HISTORY_MAX_POINTS);
	if (error || !data) return [];
	return data.reverse().map((row) => ({
		ts: row.ts,
		fair_price: Number(row.fair_price)
	}));
}
async function saveHistoryPoint(point) {
	const db = getSupabase();
	if (!db) return;
	await db.from("price_history").insert({
		ts: point.ts,
		fair_price: point.fair_price
	});
	const { data: staleRows } = await db.from("price_history").select("id").order("ts", { ascending: false }).range(CFG.HISTORY_MAX_POINTS, CFG.HISTORY_MAX_POINTS + 500);
	const staleIds = (staleRows ?? []).map((r) => r.id);
	if (staleIds.length > 0) await db.from("price_history").delete().in("id", staleIds);
}
var inputSchema = objectType({
	capitalUsdt: numberType().positive().max(1e7).default(1e4),
	buyFeeIdr: numberType().min(0).max(5e3).default(30),
	history: arrayType(objectType({
		ts: stringType(),
		fair_price: numberType()
	})).max(CFG.HISTORY_MAX_POINTS).default([])
});
var getMarketSnapshot_createServerFn_handler = createServerRpc({
	id: "7cd60a3b126682b15fe72609b4818883cf6dfa58fe383f03d92d37359a36dc7d",
	name: "getMarketSnapshot",
	filename: "src/lib/p2p.functions.ts"
}, (opts) => getMarketSnapshot.__executeServer(opts));
var getMarketSnapshot = createServerFn({ method: "POST" }).inputValidator((data) => inputSchema.parse(data)).handler(getMarketSnapshot_createServerFn_handler, async ({ data }) => {
	const [sellRefRaw, buyRefRaw, crossPlatform, newsItems, dbHistory] = await Promise.all([
		fetchP2pAds("BUY"),
		fetchP2pAds("SELL"),
		fetchCrossPlatform(),
		fetchNews(),
		loadHistoryFromDb()
	]);
	const snapshot = buildSnapshot({
		sellRefRaw,
		buyRefRaw,
		crossPlatform,
		newsItems,
		history: dbHistory.length > 0 ? dbHistory : data.history,
		capitalUsdt: data.capitalUsdt,
		buyFeeIdr: data.buyFeeIdr
	});
	const latest = snapshot.history[snapshot.history.length - 1];
	if (latest) await saveHistoryPoint(latest);
	return snapshot;
});
//#endregion
export { getMarketSnapshot_createServerFn_handler };
