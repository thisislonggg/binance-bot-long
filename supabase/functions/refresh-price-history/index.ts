// Edge Function — dipanggil terjadwal oleh pg_cron (lihat ../../003_cron_refresh.sql).
// Ambil order book Binance P2P USDT/IDR, hitung fair_price, simpan ke price_history.
// Ini jalan independen dari app utama (Deno runtime terpisah), jadi data tetap
// ke-refresh walau tidak ada yang membuka dashboard.
//
// Kalkulasi di sini adalah versi RINGKAS dari src/lib/p2p-engine.ts — cukup untuk
// fair_price (liquidity-weighted mid dari dua sisi order book setelah filter
// likuiditas minimum + outlier). Margin/depth/momentum dsb TIDAK dihitung di sini
// karena itu butuh parameter milik user (modal, fee) yang hanya tersedia saat
// dashboard dibuka — snapshot lengkap tetap dihitung live oleh getMarketSnapshot.
//
// Deploy: supabase functions deploy refresh-price-history --no-verify-jwt
// (--no-verify-jwt karena function ini dipanggil oleh pg_net terjadwal, bukan
// oleh user login. SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY otomatis tersedia
// sebagai env var bawaan Edge Function, tidak perlu di-set manual.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ASSET = "USDT";
const FIAT = "IDR";
const ROWS_PER_SIDE = 20;
const MIN_AD_LIQUIDITY_IDR = 1_000_000;
const OUTLIER_MAD_Z = 3.5;
const HISTORY_MAX_POINTS = 100;

type Ad = { price: number; available_idr: number };

async function fetchAds(tradeType: "BUY" | "SELL"): Promise<Ad[]> {
  const resp = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({
      page: 1,
      rows: ROWS_PER_SIDE,
      payTypes: [],
      asset: ASSET,
      tradeType,
      fiat: FIAT,
      publisherType: null,
      merchantCheck: false,
    }),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  const ads: Ad[] = [];
  for (const item of data?.data ?? []) {
    const adv = item?.adv ?? {};
    const price = Number(adv.price);
    const maxLimit = Number(adv.maxSingleTransAmount ?? 0);
    const surplus = Number(adv.surplusAmount ?? 0);
    if (!Number.isFinite(price) || !Number.isFinite(surplus)) continue;
    const availableIdr = maxLimit ? Math.min(surplus * price, maxLimit) : surplus * price;
    ads.push({ price, available_idr: availableIdr });
  }
  return ads;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function cleanAds(ads: Ad[]): Ad[] {
  const filtered = ads.filter((a) => a.available_idr >= MIN_AD_LIQUIDITY_IDR);
  if (filtered.length < 4) return filtered;
  const prices = filtered.map((a) => a.price);
  const med = median(prices);
  const mad = median(prices.map((p) => Math.abs(p - med))) || 1e-9;
  return filtered.filter((a) => Math.abs((0.6745 * (a.price - med)) / mad) <= OUTLIER_MAD_Z);
}

function liquidityWeightedPrice(ads: Ad[]): number {
  const totalW = ads.reduce((s, a) => s + a.available_idr, 0);
  if (totalW === 0) return NaN;
  return ads.reduce((s, a) => s + a.price * a.available_idr, 0) / totalW;
}

Deno.serve(async () => {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(JSON.stringify({ ok: false, error: "SUPABASE_URL/SERVICE_ROLE_KEY belum ada" }), {
        status: 500,
      });
    }
    const db = createClient(url, key);

    const [sellRaw, buyRaw] = await Promise.all([fetchAds("BUY"), fetchAds("SELL")]);
    const sellClean = cleanAds(sellRaw);
    const buyClean = cleanAds(buyRaw);

    const lwpSell = liquidityWeightedPrice(sellClean);
    const lwpBuy = liquidityWeightedPrice(buyClean);
    const fairPrice =
      Number.isFinite(lwpSell) && Number.isFinite(lwpBuy)
        ? (lwpSell + lwpBuy) / 2
        : ([lwpSell, lwpBuy].find((v) => Number.isFinite(v)) ?? NaN);

    if (!Number.isFinite(fairPrice)) {
      return new Response(JSON.stringify({ ok: false, error: "data ads kosong, fair_price tidak valid" }), {
        status: 200,
      });
    }

    await db.from("price_history").insert({ ts: new Date().toISOString(), fair_price: fairPrice });

    // Buang baris lama di luar HISTORY_MAX_POINTS, sama seperti saveHistoryPoint() di app.
    const { data: staleRows } = await db
      .from("price_history")
      .select("id")
      .order("ts", { ascending: false })
      .range(HISTORY_MAX_POINTS, HISTORY_MAX_POINTS + 500);
    const staleIds = (staleRows ?? []).map((r: { id: number }) => r.id);
    if (staleIds.length > 0) {
      await db.from("price_history").delete().in("id", staleIds);
    }

    return new Response(JSON.stringify({ ok: true, fair_price: fairPrice }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
