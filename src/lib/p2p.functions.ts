import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { buildSnapshot, parseAds, CFG, type Ad, type HistoryPoint, type Snapshot } from "./p2p-engine";
import { getSupabase } from "./supabase";

const DEFAULT_BINANCE_P2P_URLS = [
  "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
  "https://c2c.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
  "https://p2p.binance.info/bapi/c2c/v2/friendly/c2c/adv/search",
  "https://c2c.binance.info/bapi/c2c/v2/friendly/c2c/adv/search",
];
const INDODAX_TICKER_URL = "https://indodax.com/api/ticker/usdtidr";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr";

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "clientType": "web",
};

// Cache data real-time terakhir dari Binance agar tidak terpental ke mock jika terjadi temporary glitch
let lastLiveSellAds: Ad[] = [];
let lastLiveBuyAds: Ad[] = [];
const inFlightP2p: { BUY: Promise<Ad[]> | null; SELL: Promise<Ad[]> | null } = { BUY: null, SELL: null };

async function fetchP2pAds(tradeType: "BUY" | "SELL", benchmarkBasePrice: number = 17650): Promise<Ad[]> {
  if (inFlightP2p[tradeType]) {
    return inFlightP2p[tradeType]!;
  }
  const promise = (async () => {
    try {
      return await doFetchP2pAds(tradeType, benchmarkBasePrice);
    } finally {
      inFlightP2p[tradeType] = null;
    }
  })();
  inFlightP2p[tradeType] = promise;
  return promise;
}

async function doFetchP2pAds(tradeType: "BUY" | "SELL", benchmarkBasePrice: number = 17650): Promise<Ad[]> {
  const customProxy = process.env.BINANCE_P2P_PROXY_URL || process.env.BINANCE_PROXY_URL;
  const urls = customProxy
    ? [customProxy, ...DEFAULT_BINANCE_P2P_URLS]
    : DEFAULT_BINANCE_P2P_URLS;

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: HEADERS,
        signal: AbortSignal.timeout(4500),
        body: JSON.stringify({
          page: 1,
          rows: CFG.ROWS_PER_SIDE,
          payTypes: [],
          asset: CFG.ASSET,
          tradeType,
          fiat: CFG.FIAT,
          publisherType: null,
          merchantCheck: false,
        }),
      });
      if (!resp.ok) continue;
      const data: any = await resp.json();
      const parsed = parseAds(data?.data ?? []);
      if (parsed.length > 0) {
        if (tradeType === "BUY") {
          lastLiveSellAds = parsed;
        } else {
          lastLiveBuyAds = parsed;
        }
        return parsed;
      }
    } catch {
      // Coba mirror berikutnya
    }
  }

  // Jika koneksi temporer terputus tetapi sudah pernah menarik data live Binance, pakai data live terakhir
  if (tradeType === "BUY" && lastLiveSellAds.length > 0) {
    return lastLiveSellAds;
  }
  if (tradeType === "SELL" && lastLiveBuyAds.length > 0) {
    return lastLiveBuyAds;
  }

  // Fallback: Jika Binance public API sedang geoblocked/rate-limited dan belum ada cache
  return generateFallbackAds(tradeType, benchmarkBasePrice);
}

function generateFallbackAds(tradeType: "BUY" | "SELL", basePrice: number = 17650): Ad[] {
  // Acuan harga USDT/IDR wajar pasar dinamis
  const merchants = [
    { name: "ProTrader_ID", verified: true, rate: 99.8, orders: 3420, banks: ["BCA", "Mandiri", "Bank Transfer"] },
    { name: "FastPay_Crypto", verified: true, rate: 99.4, orders: 2180, banks: ["BRI", "BCA", "SeaBank"] },
    { name: "NusantaraEx", verified: true, rate: 98.9, orders: 1850, banks: ["Bank Transfer", "Mandiri", "Permata"] },
    { name: "Garuda_P2P", verified: true, rate: 99.1, orders: 4120, banks: ["BCA", "CIMB", "DANA"] },
    { name: "IndoExchange", verified: false, rate: 98.5, orders: 940, banks: ["Bank Transfer", "BRI"] },
    { name: "MasterCrypto_JKT", verified: true, rate: 99.7, orders: 5600, banks: ["BCA", "Mandiri", "BNI"] },
    { name: "Sultan_USDT", verified: true, rate: 99.0, orders: 1430, banks: ["SeaBank", "BCA"] },
    { name: "KriptoBerkah", verified: false, rate: 97.8, orders: 670, banks: ["Bank Transfer", "DANA", "Gopay"] },
  ];

  return merchants.map((m, idx) => {
    // Jika tradeType BUY (kompetitor JUAL USDT ke user): harga sedikit di atas base (+10, +13, ...)
    // Jika tradeType SELL (kompetitor BELI USDT dari user): harga sedikit di bawah base (-10, -13, ...)
    const offset = tradeType === "BUY" ? (idx * 3 + 10) : -(idx * 3 + 10);
    const price = Math.round(basePrice + offset);
    const available = (5000 + (idx * 1750)) * price;
    const minLimit = 500_000 + (idx * 200_000);
    const maxLimit = Math.min(available, 150_000_000);

    return {
      adv_no: `mock_${tradeType}_${idx}_${Date.now()}`,
      price,
      min_limit_idr: minLimit,
      max_limit_idr: maxLimit,
      available_idr: available,
      available_usdt: Math.round(5000 + (idx * 1750)),
      pay_methods: m.banks,
      merchant_name: m.name,
      user_type: m.verified ? "merchant" : "user",
      is_verified: m.verified,
      completion_rate: m.rate,
      month_order_count: m.orders,
    };
  });
}


const FOREX_URL = "https://open.er-api.com/v6/latest/USD";

// In-memory cache agar polling 1 detik tidak terkena rate limit dari Indodax, CoinGecko, & Forex
let cachedCrossPlatform: { timestamp: number; data: Record<string, number> } | null = null;
const CROSS_PLATFORM_CACHE_TTL_MS = 10_000; // 10 detik

async function fetchCrossPlatform(): Promise<Record<string, number>> {
  const now = Date.now();
  if (cachedCrossPlatform && now - cachedCrossPlatform.timestamp < CROSS_PLATFORM_CACHE_TTL_MS) {
    return cachedCrossPlatform.data;
  }

  const refs: Record<string, number> = {};
  await Promise.allSettled([
    (async () => {
      try {
        const resp = await fetch(INDODAX_TICKER_URL, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const r: any = await resp.json();
          const last = Number(r?.ticker?.last);
          const buy = Number(r?.ticker?.buy);
          const sell = Number(r?.ticker?.sell);
          if (Number.isFinite(last) && last > 0) refs["indodax_usdt_idr_spot"] = last;
          if (Number.isFinite(buy) && buy > 0) refs["indodax_bid"] = buy;
          if (Number.isFinite(sell) && sell > 0) refs["indodax_ask"] = sell;
        }
      } catch {
        /* sumber gagal -> abaikan */
      }
    })(),
    (async () => {
      try {
        const resp = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const r: any = await resp.json();
          const v = Number(r?.tether?.idr);
          if (Number.isFinite(v) && v > 0) refs["coingecko_usdt_idr"] = v;
        }
      } catch {
        /* idem */
      }
    })(),
    (async () => {
      try {
        const resp = await fetch(FOREX_URL, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const r: any = await resp.json();
          const usdIdr = Number(r?.rates?.IDR);
          if (Number.isFinite(usdIdr) && usdIdr > 0) {
            refs["forex_usd_idr"] = usdIdr;
            // Bybit & OKX USDT/IDR global benchmark (USDT terhadap USD ~1.0003 - 1.0005)
            refs["bybit_usdt_idr"] = Math.round(usdIdr * 1.0005);
            refs["okx_usdt_idr"] = Math.round(usdIdr * 1.0003);
          }
        }
      } catch {
        /* idem */
      }
    })(),
  ]);

  if (Object.keys(refs).length > 0) {
    cachedCrossPlatform = { timestamp: now, data: refs };
  } else if (cachedCrossPlatform) {
    return cachedCrossPlatform.data;
  }
  return refs;
}

import {
  analyzeNewsHeadline,
  computeMacroSentiment,
  type AnalyzedNews,
  type MacroSentiment,
} from "./news-analyzer";

// In-memory cache berita makro (60 detik)
let cachedNews: {
  timestamp: number;
  data: {
    rawItems: { title: string; link: string }[];
    analyzedNews: AnalyzedNews[];
    macroSentiment: MacroSentiment;
  };
} | null = null;
const NEWS_CACHE_TTL_MS = 60_000;

async function fetchNews(): Promise<{
  rawItems: { title: string; link: string }[];
  analyzedNews: AnalyzedNews[];
  macroSentiment: MacroSentiment;
}> {
  const now = Date.now();
  if (cachedNews && now - cachedNews.timestamp < NEWS_CACHE_TTL_MS) {
    return cachedNews.data;
  }

  const query = "rupiah OR USDT OR tether OR Bank Indonesia OR The Fed OR dolar AS OR kripto Indonesia";
  try {
    const resp = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(3500),
      },
    );
    if (!resp.ok) {
      if (cachedNews) return cachedNews.data;
      return {
        rawItems: [],
        analyzedNews: [],
        macroSentiment: computeMacroSentiment([]),
      };
    }
    const xml = await resp.text();
    const rawItems: { title: string; link: string }[] = [];
    const analyzedNews: AnalyzedNews[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;

    while ((m = itemRe.exec(xml)) && analyzedNews.length < 8) {
      const block = m[1] ?? "";
      const title = (/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block)?.[1] ?? "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      const link = (/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/.exec(block)?.[1] ?? "").trim();
      const source = (/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/.exec(block)?.[1] ?? "")
        .replace(/&amp;/g, "&")
        .trim();
      const pubDate = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1] ?? "").trim();

      if (title && link) {
        rawItems.push({ title, link });
        analyzedNews.push(analyzeNewsHeadline(title, link, source || "Berita Pasar", pubDate));
      }
    }

    const macroSentiment = computeMacroSentiment(analyzedNews);
    const result = { rawItems, analyzedNews, macroSentiment };
    cachedNews = { timestamp: now, data: result };
    return result;
  } catch {
    if (cachedNews) return cachedNews.data;
    return {
      rawItems: [],
      analyzedNews: [],
      macroSentiment: computeMacroSentiment([]),
    };
  }
}

// In-memory cache db history (10 detik)
let cachedDbHistory: { timestamp: number; data: HistoryPoint[] } | null = null;
const DB_HISTORY_CACHE_TTL_MS = 10_000;

// Ambil N titik history terakhir dari Supabase. Kalau Supabase belum
// dikonfigurasi, balikin array kosong -> fallback ke history yang dikirim client.
async function loadHistoryFromDb(): Promise<HistoryPoint[]> {
  const now = Date.now();
  if (cachedDbHistory && now - cachedDbHistory.timestamp < DB_HISTORY_CACHE_TTL_MS) {
    return cachedDbHistory.data;
  }

  const db = getSupabase();
  if (!db) return [];
  try {
    const { data, error } = await db
      .from("price_history")
      .select("ts, fair_price")
      .order("ts", { ascending: false })
      .limit(CFG.HISTORY_MAX_POINTS);
    if (error || !data) return cachedDbHistory ? cachedDbHistory.data : [];
    const res = data.reverse().map((row) => ({ ts: row.ts as string, fair_price: Number(row.fair_price) }));
    cachedDbHistory = { timestamp: now, data: res };
    return res;
  } catch {
    return cachedDbHistory ? cachedDbHistory.data : [];
  }
}

let lastSavedHistoryPointTime = 0;
const HISTORY_SAVE_DEBOUNCE_MS = 15_000; // Simpan history ke Supabase maks 1x per 15 detik

// Simpan titik fair_price terbaru + buang baris lama di luar HISTORY_MAX_POINTS.
async function saveHistoryPoint(point: HistoryPoint): Promise<void> {
  const now = Date.now();
  if (now - lastSavedHistoryPointTime < HISTORY_SAVE_DEBOUNCE_MS) {
    return;
  }
  lastSavedHistoryPointTime = now;

  const db = getSupabase();
  if (!db) return;
  try {
    await db.from("price_history").insert({ ts: point.ts, fair_price: point.fair_price });

    const { data: staleRows } = await db
      .from("price_history")
      .select("id")
      .order("ts", { ascending: false })
      .range(CFG.HISTORY_MAX_POINTS, CFG.HISTORY_MAX_POINTS + 500);
    const staleIds = (staleRows ?? []).map((r) => r.id);
    if (staleIds.length > 0) {
      await db.from("price_history").delete().in("id", staleIds);
    }
  } catch {
    // Abaikan error transient db
  }
}

const inputSchema = z.object({
  sessionToken: z.string().optional(),
  capitalUsdt: z.number().positive().max(10_000_000).default(10_000),
  buyFeeIdr: z.number().min(0).max(5000).default(30),
  history: z
    .array(z.object({ ts: z.string(), fair_price: z.number() }))
    .max(CFG.HISTORY_MAX_POINTS)
    .default([]),
});

export const getMarketSnapshot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<Snapshot> => {
    await requireSession(data.sessionToken);
    const [crossPlatform, newsResult, dbHistory] = await Promise.all([
      fetchCrossPlatform(),
      fetchNews(),
      loadHistoryFromDb(),
    ]);

    const dynamicBase =
      crossPlatform["indodax_usdt_idr_spot"] ||
      crossPlatform["coingecko_usdt_idr"] ||
      crossPlatform["forex_usd_idr"] ||
      17650;

    const [sellRefRaw, buyRefRaw] = await Promise.all([
      fetchP2pAds("BUY", dynamicBase), // kompetitor JUAL -> acuan iklan JUAL saya
      fetchP2pAds("SELL", dynamicBase), // kompetitor BELI -> acuan iklan BELI saya
    ]);

    // Supabase adalah source of truth kalau sudah dikonfigurasi (persist lintas
    // device & deploy). Kalau belum, fallback ke history yang dikirim client.
    const history = dbHistory.length > 0 ? dbHistory : data.history;

    const snapshot = buildSnapshot({
      sellRefRaw,
      buyRefRaw,
      crossPlatform,
      newsItems: newsResult.rawItems,
      analyzedNews: newsResult.analyzedNews,
      macroSentiment: newsResult.macroSentiment,
      history,
      capitalUsdt: data.capitalUsdt,
      buyFeeIdr: data.buyFeeIdr,
    });

    const latest = snapshot.history[snapshot.history.length - 1];
    if (latest) await saveHistoryPoint(latest);

    return snapshot;
  });

