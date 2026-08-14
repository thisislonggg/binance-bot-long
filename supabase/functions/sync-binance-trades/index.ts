// Edge Function — sinkronisasi transaksi Binance C2C ke tabel trades Supabase
// Dapat dipanggil secara berkala via pg_cron atau cron HTTP external (mis. tiap 3-5 menit).
//
// Deploy: supabase functions deploy sync-binance-trades --no-verify-jwt
//
// Diperlukan Env Vars di Supabase Project:
//   SUPABASE_URL (otomatis)
//   SUPABASE_SERVICE_ROLE_KEY (otomatis)
//   BINANCE_API_KEY
//   BINANCE_API_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const BINANCE_C2C_URL = "https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory";
const SYNC_TS_KEY = "binance_last_sync_ts";

type BinanceC2cOrder = {
  orderNumber: string;
  advNo: string;
  tradeType: "BUY" | "SELL";
  asset: string;
  fiat: string;
  amount: string;
  totalPrice: string;
  unitPrice: string;
  orderStatus: string;
  createTime: number;
  counterPartNickName: string;
  payMethodName?: string;
};

function buildSignature(queryParams: Record<string, string | number>, secret: string): string {
  const raw = Object.entries(queryParams)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return createHmac("sha256", secret).update(raw).digest("hex");
}

async function fetchC2cOrders(
  apiKey: string,
  apiSecret: string,
  tradeType: "BUY" | "SELL",
  startMs: number,
  endMs: number,
): Promise<BinanceC2cOrder[]> {
  const allOrders: BinanceC2cOrder[] = [];
  let page = 1;
  const rows = 100;
  const maxPages = 10;

  while (page <= maxPages) {
    const timestamp = Date.now();
    const params: Record<string, string | number> = {
      tradeType,
      startTimestamp: startMs,
      endTimestamp: endMs,
      page,
      rows,
      timestamp,
      recvWindow: 10_000,
    };

    const signature = buildSignature(params, apiSecret);
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");

    const url = `${BINANCE_C2C_URL}?${qs}&signature=${signature}`;
    const resp = await fetch(url, {
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Binance API error ${resp.status}: ${body}`);
    }

    const json = await resp.json();
    if (!json.success) {
      throw new Error(`Binance C2C error: ${json.message ?? JSON.stringify(json)}`);
    }

    const list = (json.data ?? []) as BinanceC2cOrder[];
    allOrders.push(...list);

    if (list.length < rows) break;
    page++;
  }

  return allOrders;
}

Deno.serve(async () => {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("BINANCE_API_KEY");
    const apiSecret = Deno.env.get("BINANCE_API_SECRET");

    if (!url || !key) {
      return new Response(JSON.stringify({ ok: false, error: "SUPABASE_URL / SERVICE_ROLE_KEY belum di-set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!apiKey || !apiSecret) {
      return new Response(JSON.stringify({ ok: false, error: "BINANCE_API_KEY / SECRET belum di-set" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const db = createClient(url, key);

    // Ambil last sync ts
    const { data: syncSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("key", SYNC_TS_KEY)
      .maybeSingle();

    const lastSync = Number(syncSetting?.value);
    const now = Date.now();
    const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;
    const startMs = Number.isFinite(lastSync) && lastSync > 0 ? lastSync - 5 * 60 * 1000 : now - MS_30_DAYS;
    const endMs = now;

    const [buyOrders, sellOrders] = await Promise.all([
      fetchC2cOrders(apiKey, apiSecret, "BUY", startMs, endMs),
      fetchC2cOrders(apiKey, apiSecret, "SELL", startMs, endMs),
    ]);

    const allOrders = [...buyOrders, ...sellOrders].filter(
      (o) => o.orderStatus === "COMPLETED" && o.asset === "USDT" && o.fiat === "IDR",
    );

    let added = 0;
    let skipped = 0;

    for (const order of allOrders) {
      const unitPrice = Number(order.unitPrice);
      const amountUsdt = Number(order.amount);
      const ts = new Date(order.createTime).toISOString();
      const side = order.tradeType === "BUY" ? "buy" : "sell";
      const noteParts = [
        order.counterPartNickName ? `@${order.counterPartNickName}` : null,
        order.payMethodName ?? null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      const { data: existing } = await db
        .from("trades")
        .select("id")
        .eq("binance_order_no", order.orderNumber)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const { error } = await db.from("trades").insert({
        ts,
        side,
        price: unitPrice,
        amount_usdt: amountUsdt,
        note,
        source: "binance_sync",
        binance_order_no: order.orderNumber,
      });

      if (!error) added++;
      else skipped++;
    }

    await db.from("user_settings").upsert({ key: SYNC_TS_KEY, value: String(now) }, { onConflict: "key" });

    return new Response(JSON.stringify({ ok: true, added, skipped, last_sync_ts: now }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
