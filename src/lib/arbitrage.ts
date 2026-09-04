/**
 * Engine Radar Arbitrase Lintas Bursa (Cross-Platform Arbitrage Scanner)
 * Membandingkan spread harga USDT/IDR antara Binance P2P, Bursa Spot Lokal (Indodax Orderbook),
 * serta Benchmark Pasar Global (Bybit, OKX, CoinGecko) & Kurs Valas USD/IDR.
 */

import { fmtPct, fmtRp, fmtRp2 } from "./p2p-engine";

export type ExchangePrice = {
  id: string;
  name: string;
  type: "p2p" | "spot" | "benchmark";
  badge: string;
  buy_price: number; // Harga saat kita MEMBELI USDT di platform ini (Orderbook Ask / Terendah Jual)
  sell_price: number; // Harga saat kita MENJUAL USDT di platform ini (Orderbook Bid / Tertinggi Beli)
  last_price?: number; // Harga transaksi pasar terakhir (Last trade)
  spread_idr?: number; // Spread antara harga beli dan jual di bursa tersebut
  fee_taker_pct: number;
  fee_maker_pct: number;
  transfer_fee_idr: number; // Biaya transfer on-chain blockchain (1 USDT)
  notes: string;
  status: "active" | "delayed";
};

export type ArbitrageOpportunity = {
  id: string;
  title: string;
  direction: "spot_to_p2p" | "p2p_to_spot" | "p2p_cycle";
  buy_platform: string;
  buy_price: number;
  sell_platform: string;
  sell_price: number;
  gross_spread_idr: number;
  total_fee_per_usdt: number;
  net_profit_per_usdt: number;
  net_roi_pct: number;
  status: "lucrative" | "moderate" | "thin" | "negative";
  status_label: string;
  execution_steps: string[];
  risk_warning: string;
};

export type ArbitrageScanResult = {
  timestamp: string;
  exchanges: ExchangePrice[];
  opportunities: ArbitrageOpportunity[];
  best_opportunity: ArbitrageOpportunity | null;
  p2p_premium_pct: number;
  p2p_premium_idr: number;
  p2p_status: "premium" | "discount" | "par";
};

export type ArbitrageInputParams = {
  myBuyPrice: number;
  mySellPrice: number;
  indodaxAsk?: number; // Harga Ask orderbook (saat klik BUY USDT di Indodax)
  indodaxBid?: number; // Harga Bid orderbook (saat klik SELL USDT di Indodax)
  indodaxLast?: number; // Harga transaksi terakhir Indodax
  indodaxSpotPrice?: number; // Fallback legacy
  coingeckoPrice?: number;
  forexRate?: number;
  bybitPrice?: number;
  okxPrice?: number;
};

export function computeArbitrageRoutes(params: ArbitrageInputParams): ArbitrageScanResult {
  const {
    myBuyPrice = 17650,
    mySellPrice = 17700,
    indodaxAsk,
    indodaxBid,
    indodaxLast,
    indodaxSpotPrice,
    coingeckoPrice = 0,
    forexRate = 0,
    bybitPrice = 0,
    okxPrice = 0,
  } = params;
  const now = new Date().toISOString();

  // ── Penentuan Harga Eksekusi Nyata Indodax ─────────────────────────────────
  // Saat kita klik BUY di Indodax: kita bayar harga ASK orderbook terendah (ticker.sell)
  // Saat kita klik SELL di Indodax: kita menerima harga BID orderbook tertinggi (ticker.buy)
  // Harga last adalah harga histori transaksi sebelumnya (bisa beda dengan bid/ask)
  const baseIndodax = indodaxLast || indodaxSpotPrice || 17650;
  const effectiveIndodaxAsk = indodaxAsk && indodaxAsk > 0 ? indodaxAsk : baseIndodax + 1;
  const effectiveIndodaxBid = indodaxBid && indodaxBid > 0 ? indodaxBid : baseIndodax - 1;
  const effectiveIndodaxLast = indodaxLast || baseIndodax;

  const effectiveBybit = bybitPrice > 0 ? bybitPrice : (forexRate > 0 ? Math.round(forexRate * 1.0005) : 17870);
  const effectiveOkx = okxPrice > 0 ? okxPrice : (forexRate > 0 ? Math.round(forexRate * 1.0003) : 17865);
  const effectiveForex = forexRate > 0 ? forexRate : 17860;
  const effectiveCoingecko = coingeckoPrice > 0 ? coingeckoPrice : 17775;

  // ── 1. Tabel Daftar Harga Multi-Bursa Real-Time ───────────────────────────
  const exchanges: ExchangePrice[] = [
    {
      id: "binance_p2p",
      name: "Binance P2P (Merchant)",
      type: "p2p",
      badge: "Pasar Utama",
      buy_price: myBuyPrice, // Kita pasang iklan beli di harga ini
      sell_price: mySellPrice, // Kita pasang iklan jual di harga ini
      last_price: (myBuyPrice + mySellPrice) / 2,
      spread_idr: mySellPrice - myBuyPrice,
      fee_taker_pct: 0,
      fee_maker_pct: 0.07, // 0.07% Maker Fee
      transfer_fee_idr: 0,
      notes: "Fee 0.07% per transaksi. Tanpa biaya transfer on-chain jika diputar di dalam Binance.",
      status: "active",
    },
    {
      id: "indodax_spot",
      name: "Indodax Spot (USDT/IDR)",
      type: "spot",
      badge: "Bursa Spot Lokal",
      buy_price: effectiveIndodaxAsk, // Harga saat kita klik BUY (Ask terendah di orderbook)
      sell_price: effectiveIndodaxBid, // Harga saat kita klik SELL (Bid tertinggi di orderbook)
      last_price: effectiveIndodaxLast, // Harga transaksi pasar terakhir
      spread_idr: effectiveIndodaxAsk - effectiveIndodaxBid,
      fee_taker_pct: 0.3, // 0.30% instant market order fee
      fee_maker_pct: 0.1, // 0.10% limit order fee
      transfer_fee_idr: Math.round(effectiveIndodaxAsk * 1.0), // ~1 USDT on-chain transfer fee
      notes: `Orderbook Ask (Beli): ${fmtRp2(effectiveIndodaxAsk)} | Bid (Jual): ${fmtRp2(effectiveIndodaxBid)} | Last: ${fmtRp2(effectiveIndodaxLast)}`,
      status: effectiveIndodaxLast > 0 ? "active" : "delayed",
    },
    {
      id: "bybit",
      name: "Bybit Global",
      type: "benchmark",
      badge: "Global Exchange",
      buy_price: effectiveBybit,
      sell_price: effectiveBybit,
      last_price: effectiveBybit,
      spread_idr: 0,
      fee_taker_pct: 0.1,
      fee_maker_pct: 0.1,
      transfer_fee_idr: Math.round(effectiveBybit * 1.0),
      notes: "Benchmark harga USDT/IDR global Bybit.",
      status: bybitPrice > 0 ? "active" : "delayed",
    },
    {
      id: "okx",
      name: "OKX Global",
      type: "benchmark",
      badge: "Global Exchange",
      buy_price: effectiveOkx,
      sell_price: effectiveOkx,
      last_price: effectiveOkx,
      spread_idr: 0,
      fee_taker_pct: 0.1,
      fee_maker_pct: 0.08,
      transfer_fee_idr: Math.round(effectiveOkx * 1.0),
      notes: "Benchmark harga USDT/IDR global OKX.",
      status: okxPrice > 0 ? "active" : "delayed",
    },
    {
      id: "coingecko",
      name: "CoinGecko Rate",
      type: "benchmark",
      badge: "Acuan Agregator",
      buy_price: effectiveCoingecko,
      sell_price: effectiveCoingecko,
      last_price: effectiveCoingecko,
      spread_idr: 0,
      fee_taker_pct: 0,
      fee_maker_pct: 0,
      transfer_fee_idr: 0,
      notes: "Rata-rata tertimbang harga Tether global dalam Rupiah.",
      status: coingeckoPrice > 0 ? "active" : "delayed",
    },
    {
      id: "forex_bank",
      name: "Kurs Bank USD/IDR",
      type: "benchmark",
      badge: "Acuan Pasar Valas",
      buy_price: effectiveForex,
      sell_price: effectiveForex,
      last_price: effectiveForex,
      spread_idr: 0,
      fee_taker_pct: 0,
      fee_maker_pct: 0,
      transfer_fee_idr: 0,
      notes: "Kurs acuan transaksi pasar uang antar bank.",
      status: forexRate > 0 ? "active" : "delayed",
    },
  ];

  // ── 2. Kalkulasi Rute Arbitrase Presisi ────────────────────────────────────
  const opportunities: ArbitrageOpportunity[] = [];

  // ── RUTE 1: Beli di Spot Indodax (Klik BUY / Ask) ➔ Jual di Binance P2P ────
  // Saat beli di Indodax, kita membayar harga Ask (effectiveIndodaxAsk) + 0.3% taker fee
  // Saat jual di Binance P2P, kita pasang iklan di harga mySellPrice - 0.07% maker fee
  const indodaxBuyCost = effectiveIndodaxAsk * 1.003; // Termasuk fee beli Indodax 0.3%
  const p2pSellNet = mySellPrice * 0.9993; // Termasuk fee jual Binance P2P 0.07%
  const rute1Gross = mySellPrice - effectiveIndodaxAsk;
  const rute1Fee = (effectiveIndodaxAsk * 0.003) + (mySellPrice * 0.0007);
  const rute1Net = p2pSellNet - indodaxBuyCost;
  const rute1Roi = indodaxBuyCost > 0 ? (rute1Net / indodaxBuyCost) * 100 : 0;

  opportunities.push({
    id: "spot_indodax_to_binance_p2p",
    title: "Beli Spot Indodax (Klik BUY / Ask) ➔ Jual Iklan Binance P2P",
    direction: "spot_to_p2p",
    buy_platform: `Indodax Spot (Ask: ${fmtRp2(effectiveIndodaxAsk)})`,
    buy_price: effectiveIndodaxAsk,
    sell_platform: `Binance P2P (${fmtRp2(mySellPrice)})`,
    sell_price: mySellPrice,
    gross_spread_idr: rute1Gross,
    total_fee_per_usdt: rute1Fee,
    net_profit_per_usdt: rute1Net,
    net_roi_pct: rute1Roi,
    status: rute1Net >= 30 ? "lucrative" : rute1Net >= 10 ? "moderate" : rute1Net > 0 ? "thin" : "negative",
    status_label:
      rute1Net >= 30
        ? "Celah Terbuka Lebar (Sangat Menguntungkan)"
        : rute1Net >= 10
          ? "Celah Sedang (Layak Eksekusi)"
          : rute1Net > 0
            ? "Spread Tipis (Perhatikan Fee Transfer)"
            : "Tidak Ada Celah Arbitrase",
    execution_steps: [
      `1. Lakukan deposit Rupiah via VA/BI-Fast ke akun Indodax Anda.`,
      `2. Beli USDT instan di pasar Spot Indodax di harga Ask ~${fmtRp2(effectiveIndodaxAsk)} (bukan harga Last).`,
      `3. Kirim USDT via jaringan BEP20/TRC20 ke dompet Pendanaan Binance Anda (biaya transfer ~1 USDT).`,
      `4. Pasang iklan JUAL di Binance P2P di harga rekomendasi ${fmtRp2(mySellPrice)}.`,
    ],
    risk_warning:
      "Perhatikan bahwa harga beli instan di Indodax adalah harga ASK orderbook (terendah di antrian jual), bukan harga Last. Terdapat biaya penarikan on-chain 1 USDT.",
  });

  // ── RUTE 2: Beli Iklan Binance P2P ➔ Jual Instan di Spot Indodax (Klik SELL / Bid) ──
  // Saat beli di Binance P2P: harga myBuyPrice + 0.07% maker fee
  // Saat jual instan di Indodax: kita mendapat harga Bid (effectiveIndodaxBid) - 0.3% taker fee
  const p2pBuyCost = myBuyPrice * 1.0007;
  const indodaxSellNet = effectiveIndodaxBid * 0.997;
  const rute2Gross = effectiveIndodaxBid - myBuyPrice;
  const rute2Fee = (myBuyPrice * 0.0007) + (effectiveIndodaxBid * 0.003);
  const rute2Net = indodaxSellNet - p2pBuyCost;
  const rute2Roi = p2pBuyCost > 0 ? (rute2Net / p2pBuyCost) * 100 : 0;

  opportunities.push({
    id: "binance_p2p_to_spot_indodax",
    title: "Beli Iklan Binance P2P ➔ Jual Spot Indodax (Klik SELL / Bid)",
    direction: "p2p_to_spot",
    buy_platform: `Binance P2P (${fmtRp2(myBuyPrice)})`,
    buy_price: myBuyPrice,
    sell_platform: `Indodax Spot (Bid: ${fmtRp2(effectiveIndodaxBid)})`,
    sell_price: effectiveIndodaxBid,
    gross_spread_idr: rute2Gross,
    total_fee_per_usdt: rute2Fee,
    net_profit_per_usdt: rute2Net,
    net_roi_pct: rute2Roi,
    status: rute2Net >= 30 ? "lucrative" : rute2Net >= 10 ? "moderate" : rute2Net > 0 ? "thin" : "negative",
    status_label:
      rute2Net >= 30
        ? "Celah Terbuka (Pump Spot Lokal)"
        : rute2Net >= 10
          ? "Celah Sedang"
          : rute2Net > 0
            ? "Spread Tipis"
            : "Harga Bid Indodax Lebih Rendah dari P2P",
    execution_steps: [
      `1. Pasang iklan BELI di Binance P2P di harga rekomendasi ${fmtRp2(myBuyPrice)}.`,
      `2. Setelah USDT masuk ke dompet Pendanaan Binance, transfer on-chain ke akun Indodax.`,
      `3. Jual instan di Spot Indodax di harga Bid ~${fmtRp2(effectiveIndodaxBid)} (bukan harga Last).`,
      `4. Tarik saldo Rupiah kembali ke rekening bank via BI-Fast.`,
    ],
    risk_warning:
      "Harga jual instan di Indodax adalah harga BID orderbook (tertinggi di antrian beli). Rute ini menguntungkan saat terjadi lonjakan harga sesaat di bursa lokal.",
  });

  // ── RUTE 3: Siklus Murni Merchant P2P (Beli P2P ➔ Jual P2P) ───────────────
  const rute3Gross = mySellPrice - myBuyPrice;
  const rute3Fee = (myBuyPrice + mySellPrice) * 0.0007;
  const rute3Net = (mySellPrice * 0.9993) - (myBuyPrice * 1.0007);
  const rute3Roi = p2pBuyCost > 0 ? (rute3Net / p2pBuyCost) * 100 : 0;

  opportunities.push({
    id: "p2p_cycle_merchant",
    title: "Siklus Murni Merchant Binance P2P (Beli P2P ➔ Jual P2P)",
    direction: "p2p_cycle",
    buy_platform: "Binance P2P (Iklan Beli)",
    buy_price: myBuyPrice,
    sell_platform: "Binance P2P (Iklan Jual)",
    sell_price: mySellPrice,
    gross_spread_idr: rute3Gross,
    total_fee_per_usdt: rute3Fee,
    net_profit_per_usdt: rute3Net,
    net_roi_pct: rute3Roi,
    status: rute3Net >= 30 ? "lucrative" : rute3Net >= 10 ? "moderate" : "thin",
    status_label: "Siklus Utama Merchant (Tanpa Biaya Blockchain)",
    execution_steps: [
      `1. Pasang iklan BELI di ${fmtRp2(myBuyPrice)} (+1 Rupiah di atas kompetitor teratas).`,
      `2. Pembeli transfer Rupiah ke rekening bank Anda, Anda rilis USDT.`,
      `3. Pasang iklan JUAL di ${fmtRp2(mySellPrice)} (-1 Rupiah di bawah kompetitor terendah).`,
      `4. Pembeli transfer Rupiah masuk kembali ke rekening bank Anda dengan laba bersih.`,
    ],
    risk_warning: "Nol biaya transfer on-chain antar bursa. Perputaran modal langsung di dalam perbankan lokal.",
  });

  // Urutkan peluang dari net profit tertinggi
  const sortedOpp = [...opportunities].sort((a, b) => b.net_profit_per_usdt - a.net_profit_per_usdt);
  const best = sortedOpp.find((o) => o.net_profit_per_usdt > 0) || null;

  // Premium P2P vs Kurs Acuan Bank
  const p2pMid = (myBuyPrice + mySellPrice) / 2;
  const refRate = effectiveForex;
  const premiumIdr = p2pMid - refRate;
  const premiumPct = (premiumIdr / refRate) * 100;
  const p2pStatus: "premium" | "discount" | "par" =
    premiumPct > 0.05 ? "premium" : premiumPct < -0.05 ? "discount" : "par";

  return {
    timestamp: now,
    exchanges,
    opportunities: sortedOpp,
    best_opportunity: best,
    p2p_premium_pct: premiumPct,
    p2p_premium_idr: premiumIdr,
    p2p_status: p2pStatus,
  };
}
