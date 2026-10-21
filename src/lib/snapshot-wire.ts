/**
 * Format kirim snapshot pasar yang hemat transfer (Vercel "Fast Origin Transfer").
 *
 * Snapshot dipoll tiap detik. Bentuk lamanya mengirim setiap iklan berkali-kali (all, top,
 * cluster, outlier) lengkap dengan nama field, ~80 KB per respons. Di sini:
 *  - iklan dikirim SEKALI per sisi sebagai tuple (tanpa nama field); daftar "top" = indeks;
 *  - iklan, berita, dan riwayat harga hanya dikirim bila berubah dari versi yang sudah
 *    dimiliki browser (`have`), selain itu browser memakai salinan sebelumnya.
 * Dipakai server (pack) dan browser (unpack); tidak boleh mengimpor modul server.
 */
import type { Ad, HistoryPoint, Snapshot } from "./p2p-engine";

const AD_FIELDS = [
  "adv_no",
  "price",
  "min_limit_idr",
  "max_limit_idr",
  "raw_max_limit_idr",
  "dynamic_max_limit_idr",
  "available_idr",
  "available_usdt",
  "pay_methods",
  "merchant_name",
  "user_type",
  "is_verified",
  "completion_rate",
  "month_order_count",
  "is_tradable",
  "merchant_level",
  "user_grade",
  "badges",
  "is_pro",
  "merchant_no",
] as const satisfies readonly (keyof Ad)[];

/** Field opsional: null di tuple berarti "tidak ada" (bukan nilai null). */
const OPTIONAL_FIELDS = new Set<string>([
  "raw_max_limit_idr",
  "dynamic_max_limit_idr",
  "is_tradable",
  "merchant_level",
  "user_grade",
  "badges",
  "is_pro",
  "merchant_no",
]);

type AdTuple = (string | number | boolean | string[] | null)[];
type AdsPayload = { sell: AdTuple[]; buy: AdTuple[]; topSell: number[]; topBuy: number[] };

const HEAVY_KEYS = [
  "sell_ref_dominant_cluster",
  "buy_ref_dominant_cluster",
  "sell_ref_outliers",
  "buy_ref_outliers",
  "top_sell_ref_ads",
  "top_buy_ref_ads",
  "all_sell_ads",
  "all_buy_ads",
  "news_items",
  "analyzed_news",
  "macro_sentiment",
  "history",
] as const;

export type SnapshotHave = { ads?: string | undefined; news?: string | undefined; history?: string | undefined };

export type SnapshotWire = Omit<Snapshot, (typeof HEAVY_KEYS)[number]> & {
  v: { ads: string; news: string; history: string };
  /** JSON dari AdsPayload. Dikirim sebagai string: serializer server function membungkus setiap
   *  nilai array dengan objek tambahan, sehingga string jauh lebih ringkas daripada array. */
  ads?: string;
  news?: {
    news_items: Snapshot["news_items"];
    analyzed_news?: Snapshot["analyzed_news"] | undefined;
    macro_sentiment?: Snapshot["macro_sentiment"] | undefined;
  };
  history?: HistoryPoint[];
};

/** Hash FNV-1a 32-bit (cukup untuk mendeteksi perubahan, bukan keamanan). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const packAd = (a: Ad): AdTuple => AD_FIELDS.map((f) => (a[f] === undefined ? null : (a[f] as AdTuple[number])));

function unpackAd(t: AdTuple): Ad {
  const ad: Record<string, unknown> = {};
  AD_FIELDS.forEach((f, i) => {
    const v = t[i];
    if (v === null && OPTIONAL_FIELDS.has(f)) return;
    ad[f] = v;
  });
  return ad as Ad;
}

export function packSnapshot(s: Snapshot, have: SnapshotHave): SnapshotWire {
  const allSell = s.all_sell_ads ?? s.top_sell_ref_ads;
  const allBuy = s.all_buy_ads ?? s.top_buy_ref_ads;
  const sell = allSell.map(packAd);
  const buy = allBuy.map(packAd);
  // Daftar "top" (iklan bersih) = indeks ke daftar lengkap. Cocokkan lewat isi, bukan referensi objek.
  const indexOf = (all: Ad[]) => {
    const map = new Map<string, number>();
    all.forEach((a, i) => {
      const key = `${a.adv_no}|${a.price}|${a.merchant_name}`;
      if (!map.has(key)) map.set(key, i);
    });
    return (a: Ad) => map.get(`${a.adv_no}|${a.price}|${a.merchant_name}`) ?? -1;
  };
  const sellIdx = indexOf(allSell);
  const buyIdx = indexOf(allBuy);
  const topSell = s.top_sell_ref_ads.map(sellIdx).filter((i) => i >= 0);
  const topBuy = s.top_buy_ref_ads.map(buyIdx).filter((i) => i >= 0);
  const adsPayload: AdsPayload = { sell, buy, topSell, topBuy };
  const adsJson = JSON.stringify(adsPayload);
  const newsPayload = { news_items: s.news_items, analyzed_news: s.analyzed_news, macro_sentiment: s.macro_sentiment };

  const v = {
    ads: hash(adsJson),
    news: hash(JSON.stringify(newsPayload)),
    history: hash(JSON.stringify(s.history)),
  };

  const rest: Record<string, unknown> = { ...s };
  for (const k of HEAVY_KEYS) delete rest[k];
  return {
    ...(rest as Omit<Snapshot, (typeof HEAVY_KEYS)[number]>),
    v,
    ...(have.ads !== v.ads ? { ads: adsJson } : {}),
    ...(have.news !== v.news ? { news: newsPayload } : {}),
    ...(have.history !== v.history ? { history: s.history } : {}),
  };
}

/** Susun ulang Snapshot lengkap. `prev` = snapshot terakhir di browser (sumber bagian yang tidak dikirim). */
export function unpackSnapshot(w: SnapshotWire, prev: { snapshot: Snapshot; have: SnapshotHave } | null): {
  snapshot: Snapshot;
  have: SnapshotHave;
} {
  const p = prev?.snapshot;
  let allSell: Ad[];
  let allBuy: Ad[];
  let topSell: Ad[];
  let topBuy: Ad[];
  if (w.ads) {
    const ads = JSON.parse(w.ads) as AdsPayload;
    allSell = ads.sell.map(unpackAd);
    allBuy = ads.buy.map(unpackAd);
    topSell = ads.topSell.map((i) => allSell[i]!).filter(Boolean);
    topBuy = ads.topBuy.map((i) => allBuy[i]!).filter(Boolean);
  } else {
    allSell = p?.all_sell_ads ?? [];
    allBuy = p?.all_buy_ads ?? [];
    topSell = p?.top_sell_ref_ads ?? [];
    topBuy = p?.top_buy_ref_ads ?? [];
  }
  const news = w.news ?? {
    news_items: p?.news_items ?? [],
    analyzed_news: p?.analyzed_news,
    macro_sentiment: p?.macro_sentiment,
  };
  const { v, ads: _ads, news: _news, history: _history, ...rest } = w;
  const snapshot = {
    ...rest,
    news_items: news.news_items,
    ...(news.analyzed_news !== undefined ? { analyzed_news: news.analyzed_news } : {}),
    ...(news.macro_sentiment !== undefined ? { macro_sentiment: news.macro_sentiment } : {}),
    sell_ref_dominant_cluster: [],
    buy_ref_dominant_cluster: [],
    sell_ref_outliers: [],
    buy_ref_outliers: [],
    top_sell_ref_ads: topSell,
    top_buy_ref_ads: topBuy,
    all_sell_ads: allSell,
    all_buy_ads: allBuy,
    history: w.history ?? p?.history ?? [],
  } as Snapshot;
  // Versi hanya dicatat untuk bagian yang benar-benar kita pegang.
  const have: SnapshotHave = {
    ...(w.ads || p ? { ads: v.ads } : {}),
    ...(w.news || p ? { news: v.news } : {}),
    ...(w.history || p ? { history: v.history } : {}),
  };
  return { snapshot, have };
}
