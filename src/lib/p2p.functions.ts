import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { buildSnapshot, parseAds, CFG, type Ad, type HistoryPoint, type Snapshot } from "./p2p-engine";
import { getSupabase } from "./supabase";

const BINANCE_P2P_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const INDODAX_TICKER_URL = "https://indodax.com/api/ticker/usdtidr";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr";

const HEADERS = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" };

async function fetchP2pAds(tradeType: "BUY" | "SELL"): Promise<Ad[]> {
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
        merchantCheck: false,
      }),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    return parseAds(data?.data ?? []);
  } catch {
    return [];
  }
}

async function fetchCrossPlatform(): Promise<Record<string, number>> {
  const refs: Record<string, number> = {};
  await Promise.all([
    (async () => {
      try {
        const r: any = await (await fetch(INDODAX_TICKER_URL)).json();
        const v = Number(r?.ticker?.last);
        if (Number.isFinite(v)) refs["indodax_usdt_idr_spot"] = v;
      } catch {
        /* sumber gagal -> jangan diisi angka karangan */
      }
    })(),
    (async () => {
      try {
        const r: any = await (await fetch(COINGECKO_URL)).json();
        const v = Number(r?.tether?.idr);
        if (Number.isFinite(v)) refs["coingecko_usdt_idr"] = v;
      } catch {
        /* idem */
      }
    })(),
  ]);
  return refs;
}

async function fetchNews(): Promise<{ title: string; link: string }[]> {
  const query = "rupiah OR USDT OR tether OR kripto Indonesia OR stablecoin";
  try {
    const resp = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!resp.ok) return [];
    const xml = await resp.text();
    const items: { title: string; link: string }[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) && items.length < 3) {
      const block = m[1] ?? "";
      const title = (/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block)?.[1] ?? "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      const link = (/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/.exec(block)?.[1] ?? "").trim();
      if (title) items.push({ title, link });
    }
    return items;
  } catch {
    return [];
  }
}

// Ambil N titik history terakhir dari Supabase. Kalau Supabase belum
// dikonfigurasi, balikin array kosong -> fallback ke history yang dikirim client.
async function loadHistoryFromDb(): Promise<HistoryPoint[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data, error } = await db
    .from("price_history")
    .select("ts, fair_price")
    .order("ts", { ascending: false })
    .limit(CFG.HISTORY_MAX_POINTS);
  if (error || !data) return [];
  return data.reverse().map((row) => ({ ts: row.ts as string, fair_price: Number(row.fair_price) }));
}

// Simpan titik fair_price terbaru + buang baris lama di luar HISTORY_MAX_POINTS.
async function saveHistoryPoint(point: HistoryPoint): Promise<void> {
  const db = getSupabase();
  if (!db) return;
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
    const [sellRefRaw, buyRefRaw, crossPlatform, newsItems, dbHistory] = await Promise.all([

      fetchP2pAds("BUY"), // kompetitor JUAL -> acuan iklan JUAL saya
      fetchP2pAds("SELL"), // kompetitor BELI -> acuan iklan BELI saya
      fetchCrossPlatform(),
      fetchNews(),
      loadHistoryFromDb(),
    ]);

    // Supabase adalah source of truth kalau sudah dikonfigurasi (persist lintas
    // device & deploy). Kalau belum, fallback ke history yang dikirim client.
    const history = dbHistory.length > 0 ? dbHistory : data.history;

    const snapshot = buildSnapshot({
      sellRefRaw,
      buyRefRaw,
      crossPlatform,
      newsItems,
      history,
      capitalUsdt: data.capitalUsdt,
      buyFeeIdr: data.buyFeeIdr,
    });

    const latest = snapshot.history[snapshot.history.length - 1];
    if (latest) await saveHistoryPoint(latest);

    return snapshot;
  });
