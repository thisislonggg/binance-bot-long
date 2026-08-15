/**
 * Engine Radar Arbitrase Lintas Bursa (Cross-Platform Arbitrage Scanner)
 * Membandingkan spread harga USDT/IDR antara Binance P2P, Bursa Spot Lokal (Indodax),
 * serta Benchmark Pasar Global & Kurs Acuan Perbankan.
 */

import { fmtPct, fmtRp, fmtRp2 } from "./p2p-engine";

export type ExchangePrice = {
  id: string;
  name: string;
  type: "p2p" | "spot" | "benchmark";
  badge: string;
  buy_price: number; // Harga kita membeli USDT di platform ini
  sell_price: number; // Harga kita menjual USDT di platform ini
  fee_pct: number;
  transfer_fee_idr: number; // Estimasi biaya transfer on-chain (misal TRC20/BEP20 ~1 USDT atau Rp 17.800)
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

export function computeArbitrageRoutes(params: {
  myBuyPrice: number;
  mySellPrice: number;
  indodaxSpotPrice: number;
  coingeckoPrice: number;
  forexRate: number;
}): ArbitrageScanResult {
  const { myBuyPrice, mySellPrice, indodaxSpotPrice, coingeckoPrice, forexRate } = params;
  const now = new Date().toISOString();

  // 1. Daftar Harga Platform
  const exchanges: ExchangePrice[] = [
    {
      id: "binance_p2p",
      name: "Binance P2P (Merchant)",
      type: "p2p",
      badge: "Pasar Utama",
      buy_price: myBuyPrice, // Kita pasang iklan beli di harga ini
      sell_price: mySellPrice, // Kita pasang iklan jual di harga ini
      fee_pct: 0.08, // 0.08% Maker Fee
      transfer_fee_idr: 0,
      status: "active",
    },
    {
      id: "indodax_spot",
      name: "Indodax Spot (USDT/IDR)",
      type: "spot",
      badge: "Bursa Lokal",
      buy_price: indodaxSpotPrice > 0 ? indodaxSpotPrice + 1 : 17770, // Taker beli spot
      sell_price: indodaxSpotPrice > 0 ? indodaxSpotPrice : 17770, // Taker jual spot
      fee_pct: 0.1, // 0.1% spot fee
      transfer_fee_idr: 17800, // ~1 USDT on-chain transfer
      status: indodaxSpotPrice > 0 ? "active" : "delayed",
    },
    {
      id: "coingecko",
      name: "CoinGecko Global",
      type: "benchmark",
      badge: "Acuan Global",
      buy_price: coingeckoPrice > 0 ? coingeckoPrice : 17800,
      sell_price: coingeckoPrice > 0 ? coingeckoPrice : 17800,
      fee_pct: 0,
      transfer_fee_idr: 0,
      status: coingeckoPrice > 0 ? "active" : "delayed",
    },
    {
      id: "forex_bank",
      name: "Kurs Interbank USD/IDR",
      type: "benchmark",
      badge: "Acuan Valas",
      buy_price: forexRate > 0 ? forexRate : 17825,
      sell_price: forexRate > 0 ? forexRate : 17825,
      fee_pct: 0,
      transfer_fee_idr: 0,
      status: forexRate > 0 ? "active" : "delayed",
    },
  ];

  // 2. Kalkulasi Rute Arbitrase
  const opportunities: ArbitrageOpportunity[] = [];

  // RUTE 1: Beli di Spot Indodax ➔ Jual di Binance P2P
  const indodaxBuy = indodaxSpotPrice > 0 ? indodaxSpotPrice + 1 : 17770;
  const p2pSell = mySellPrice;
  const indodaxFee = indodaxBuy * 0.001; // 0.1%
  const p2pMakerSellFee = p2pSell * 0.0008; // 0.08%
  const rute1Gross = p2pSell - indodaxBuy;
  const rute1Fee = indodaxFee + p2pMakerSellFee;
  const rute1Net = rute1Gross - rute1Fee;
  const rute1Roi = (rute1Net / indodaxBuy) * 100;

  opportunities.push({
    id: "spot_indodax_to_binance_p2p",
    title: "Beli Spot Indodax ➔ Jual Iklan Binance P2P",
    direction: "spot_to_p2p",
    buy_platform: "Indodax Spot",
    buy_price: indodaxBuy,
    sell_platform: "Binance P2P",
    sell_price: p2pSell,
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
      `1. Lakukan deposit Rupiah via BI-Fast/VA ke Indodax.`,
      `2. Beli USDT instan di pasar Spot Indodax di harga ~${fmtRp2(indodaxBuy)}.`,
      `3. Tarik/Kirim USDT via jaringan BEP20/TRC20 ke akun Binance Anda.`,
      `4. Pasang iklan Jual di Binance P2P di harga rekomendasi ${fmtRp2(p2pSell)}.`,
    ],
    risk_warning:
      "Perhatikan biaya transfer on-chain (~1 USDT). Disarankan eksekusi untuk volume modal minimal 500 USDT agar biaya transfer tertutup maksimal.",
  });

  // RUTE 2: Beli Iklan Binance P2P ➔ Jual Instan di Spot Indodax
  const p2pBuy = myBuyPrice;
  const indodaxSell = indodaxSpotPrice > 0 ? indodaxSpotPrice : 17770;
  const p2pMakerBuyFee = p2pBuy * 0.0008;
  const indodaxSellFee = indodaxSell * 0.001;
  const rute2Gross = indodaxSell - p2pBuy;
  const rute2Fee = p2pMakerBuyFee + indodaxSellFee;
  const rute2Net = rute2Gross - rute2Fee;
  const rute2Roi = (rute2Net / p2pBuy) * 100;

  opportunities.push({
    id: "binance_p2p_to_spot_indodax",
    title: "Beli Iklan Binance P2P ➔ Jual Spot Indodax",
    direction: "p2p_to_spot",
    buy_platform: "Binance P2P",
    buy_price: p2pBuy,
    sell_platform: "Indodax Spot",
    sell_price: indodaxSell,
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
            : "Harga Spot Lebih Rendah dari P2P",
    execution_steps: [
      `1. Pasang iklan BELI di Binance P2P di harga rekomendasi ${fmtRp2(p2pBuy)}.`,
      `2. Setelah USDT masuk ke dompet Pendanaan Binance, transfer on-chain ke Indodax.`,
      `3. Jual langsung di Spot Indodax di harga ~${fmtRp2(indodaxSell)}.`,
      `4. Tarik saldo Rupiah kembali ke rekening bank via BI-Fast.`,
    ],
    risk_warning:
      "Rute ini biasanya terbuka saat terjadi lonjakan harga sesaat (pump) di pasar spot lokal Indonesia.",
  });

  // RUTE 3: Siklus Murni Merchant P2P (Beli P2P ➔ Jual P2P)
  const rute3Gross = mySellPrice - myBuyPrice;
  const rute3Fee = (myBuyPrice + mySellPrice) * 0.0008;
  const rute3Net = rute3Gross - rute3Fee;
  const rute3Roi = (rute3Net / myBuyPrice) * 100;

  opportunities.push({
    id: "p2p_cycle_merchant",
    title: "Siklus Murni Merchant Binance P2P (Beli ➔ Jual)",
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
      `1. Pasang iklan BELI di ${fmtRp2(myBuyPrice)}.`,
      `2. Pembeli transfer Rupiah ke rekening bank Anda, Anda rilis USDT.`,
      `3. Pasang iklan JUAL di ${fmtRp2(mySellPrice)}.`,
      `4. Pembeli transfer Rupiah masuk kembali ke rekening bank Anda dengan laba bersih.`,
    ],
    risk_warning: "Nol biaya transfer on-chain antar bursa. Aman dan perputaran langsung di dalam perbankan lokal.",
  });

  // Urutkan peluang dari net profit tertinggi
  const sortedOpp = [...opportunities].sort((a, b) => b.net_profit_per_usdt - a.net_profit_per_usdt);
  const best = sortedOpp.find((o) => o.net_profit_per_usdt > 0) || null;

  // Premium P2P vs Kurs Acuan Bank
  const p2pMid = (myBuyPrice + mySellPrice) / 2;
  const refRate = forexRate > 0 ? forexRate : 17825;
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
