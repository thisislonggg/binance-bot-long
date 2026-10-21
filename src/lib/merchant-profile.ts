/**
 * Profil merchant kompetitor dari Binance (GET /sapi/v1/c2c/agent/merchant/getAdDetails).
 * Berisi statistik 30 hari merchant dan SEMUA iklan aktifnya, untuk membantu menilai kompetitor
 * (mis. satu merchant memasang beberapa iklan sekaligus) sebelum di-blacklist / whitelist.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "./auth";
import { binanceAgentRequest } from "./binance-merchant";

export type MerchantProfileAd = {
  advNo: string;
  tradeType: "BUY" | "SELL";
  price: number;
  surplusUsdt: number;
  minLimitIdr: number;
  maxLimitIdr: number;
  payMethods: string[];
  payTimeLimit: number | null;
  online: boolean;
  remarks: string;
};

export type MerchantProfile = {
  ok: boolean;
  error?: string;
  merchant?: {
    nickName: string;
    userType: string;
    orderCount: number | null;
    monthOrderCount: number | null;
    monthFinishRatePct: number | null;
    completed30d: number | null;
    avgReleaseSec30d: number | null;
    avgPaySec30d: number | null;
    registerDays: number | null;
    firstOrderDays: number | null;
  };
  sellAds: MerchantProfileAd[];
  buyAds: MerchantProfileAd[];
  fetchedAt: number;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? null : n;
};

function mapAd(raw: Record<string, unknown>): MerchantProfileAd {
  const methods = Array.isArray(raw["tradeMethods"]) ? (raw["tradeMethods"] as Record<string, unknown>[]) : [];
  return {
    advNo: String(raw["advNo"] ?? ""),
    tradeType: String(raw["tradeType"] ?? "").toUpperCase() === "BUY" ? "BUY" : "SELL",
    price: num(raw["price"]) ?? 0,
    surplusUsdt: num(raw["tradableQuantity"] ?? raw["surplusAmount"]) ?? 0,
    minLimitIdr: num(raw["minSingleTransAmount"]) ?? 0,
    maxLimitIdr: num(raw["maxSingleTransAmount"]) ?? 0,
    payMethods: methods.map((m) => String(m["tradeMethodName"] ?? m["identifier"] ?? "?")),
    payTimeLimit: num(raw["payTimeLimit"]),
    online: Number(raw["advStatus"]) === 1,
    // Teks bebas dari merchant: hanya ditampilkan sebagai teks biasa.
    remarks: String(raw["remarks"] ?? "").slice(0, 600),
  };
}

const CACHE_MS = 60_000;
const cacheStore = globalThis as unknown as { __p2pMerchantProfileCache?: Map<string, MerchantProfile> };

export async function getMerchantProfileInternal(merchantNo: string): Promise<MerchantProfile> {
  const cache = (cacheStore.__p2pMerchantProfileCache ??= new Map());
  const hit = cache.get(merchantNo);
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit;

  const res = await binanceAgentRequest<{ merchant?: Record<string, unknown>; sellList?: unknown[]; buyList?: unknown[] }>({
    endpoint: "/sapi/v1/c2c/agent/merchant/getAdDetails",
    method: "GET",
    queryParams: { merchantNo },
  });
  if (!res.ok || !res.data) {
    return { ok: false, error: res.message || res.error || String(res.code ?? "Gagal memuat profil"), sellAds: [], buyAds: [], fetchedAt: Date.now() };
  }
  const m = res.data.merchant ?? {};
  const rate = num(m["monthFinishRate"]);
  const profile: MerchantProfile = {
    ok: true,
    merchant: {
      nickName: String(m["nickName"] ?? ""),
      userType: String(m["userType"] ?? ""),
      orderCount: num(m["orderCount"]),
      monthOrderCount: num(m["monthOrderCount"]),
      monthFinishRatePct: rate === null ? null : rate <= 1 ? Math.round(rate * 1000) / 10 : Math.round(rate * 10) / 10,
      completed30d: num(m["completedOrderNumOfLatest30day"]),
      avgReleaseSec30d: num(m["avgReleaseTimeOfLatest30day"]),
      avgPaySec30d: num(m["avgPayTimeOfLatest30day"]),
      registerDays: num(m["registerDays"]),
      firstOrderDays: num(m["firstOrderDays"]),
    },
    sellAds: (res.data.sellList ?? []).map((a) => mapAd(a as Record<string, unknown>)).sort((a, b) => a.price - b.price),
    buyAds: (res.data.buyList ?? []).map((a) => mapAd(a as Record<string, unknown>)).sort((a, b) => b.price - a.price),
    fetchedAt: Date.now(),
  };
  cache.set(merchantNo, profile);
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return profile;
}

export const getMerchantProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ sessionToken: z.string().optional(), merchantNo: z.string().regex(/^[A-Za-z0-9]{6,64}$/) }).parse(data),
  )
  .handler(async ({ data }): Promise<MerchantProfile> => {
    await requireSession(data.sessionToken);
    return getMerchantProfileInternal(data.merchantNo);
  });
