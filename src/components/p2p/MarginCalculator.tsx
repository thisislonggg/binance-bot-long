import { Calculator, Sparkles, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

import { fmtRp, fmtRp2 } from "@/lib/p2p-engine";

export function MarginCalculator({
  defaultBuyPrice,
  defaultSellPrice,
}: {
  defaultBuyPrice: number;
  defaultSellPrice: number;
}) {
  const [usdtAmount, setUsdtAmount] = useState<number>(2500);
  const [buyPrice, setBuyPrice] = useState<number>(defaultBuyPrice || 16200);
  const [sellPrice, setSellPrice] = useState<number>(defaultSellPrice || 16350);
  const [dailyTurnover, setDailyTurnover] = useState<number>(2); // 2x putaran per hari
  const [buyMethod, setBuyMethod] = useState<"maker" | "taker">("taker");

  // Update jika default harga berubah
  useMemo(() => {
    if (defaultBuyPrice > 0) setBuyPrice(defaultBuyPrice);
    if (defaultSellPrice > 0) setSellPrice(defaultSellPrice);
  }, [defaultBuyPrice, defaultSellPrice]);

  const BINANCE_FEE_RATE = 0.0007; // 0.07% Maker Fee

  const capitalIdr = usdtAmount * buyPrice;
  const revenueIdr = usdtAmount * sellPrice;
  // Jika Beli Langsung dari merchant lain (Taker), fee beli = 0 (Bebas Fee Beli)!
  const buyFeeIdr = buyMethod === "taker" ? 0 : capitalIdr * BINANCE_FEE_RATE;
  const sellFeeIdr = revenueIdr * BINANCE_FEE_RATE;
  const totalFeePerCycle = buyFeeIdr + sellFeeIdr;

  const grossProfitPerCycleIdr = revenueIdr - capitalIdr;
  const netProfitPerCycleIdr = grossProfitPerCycleIdr - totalFeePerCycle;
  const netMarginPct = capitalIdr > 0 ? (netProfitPerCycleIdr / capitalIdr) * 100 : 0;
  const netMarginPerUsdt = usdtAmount > 0 ? netProfitPerCycleIdr / usdtAmount : 0;

  const dailyNetProfitIdr = netProfitPerCycleIdr * dailyTurnover;
  const monthlyNetProfitIdr = dailyNetProfitIdr * 30;

  const quickAmounts = [500, 1000, 2500, 5000, 10000];

  return (
    <div className="panel p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Calculator className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Kalkulator Simulasi Margin & Perputaran Modal</h3>
            <p className="text-xs text-muted-foreground">
              {buyMethod === "taker"
                ? "Simulasi Beli Langsung (Taker 0% Fee Beli): Fee hanya terhitung saat menjual (0.07%)."
                : "Simulasi Iklan Sendiri (Maker): Fee 0.07% Beli + 0.07% Jual."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="size-3.5" />
          <span>Net Spread: +{fmtRp(netMarginPerUsdt)} / USDT ({netMarginPct.toFixed(2)}%)</span>
        </div>
      </div>

      {/* Toggle Metode Beli */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-surface-2/60 p-2.5 text-xs">
        <span className="font-semibold text-foreground">Metode Beli USDT:</span>
        <div className="inline-flex rounded-md bg-surface p-0.5 border border-border">
          <button
            type="button"
            onClick={() => setBuyMethod("taker")}
            className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
              buyMethod === "taker"
                ? "bg-cyan-500/20 text-cyan-400 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Beli Langsung Merchant Lain (Taker · Bebas Fee Beli)
          </button>
          <button
            type="button"
            onClick={() => setBuyMethod("maker")}
            className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
              buyMethod === "maker"
                ? "bg-primary/20 text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Iklan Sendiri (Maker · Fee 0.07%)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Input Parameters (Left Side) */}
        <div className="space-y-4 lg:col-span-6">
          {/* Modal USDT */}
          <div>
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-muted-foreground uppercase">Modal USDT yang Diputar</span>
              <span className="num font-bold text-foreground">{usdtAmount.toLocaleString("id-ID")} USDT</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {quickAmounts.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setUsdtAmount(amt)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    usdtAmount === amt
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "bg-surface-2 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {amt.toLocaleString()} USDT
                </button>
              ))}
            </div>
            <input
              type="range"
              min={100}
              max={25000}
              step={100}
              value={usdtAmount}
              onChange={(e) => setUsdtAmount(Number(e.target.value))}
              className="mt-3 w-full accent-primary"
            />
          </div>

          {/* Harga Beli & Harga Jual */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">
                Harga Pasang BELI (IDR)
              </label>
              <input
                type="number"
                value={buyPrice}
                onChange={(e) => setBuyPrice(Number(e.target.value))}
                className="num mt-1.5 w-full rounded-lg border border-border/80 bg-surface-2 px-3 py-2 text-sm font-semibold text-bid focus:outline-none focus:ring-1 focus:ring-bid"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">
                Harga Pasang JUAL (IDR)
              </label>
              <input
                type="number"
                value={sellPrice}
                onChange={(e) => setSellPrice(Number(e.target.value))}
                className="num mt-1.5 w-full rounded-lg border border-border/80 bg-surface-2 px-3 py-2 text-sm font-semibold text-ask focus:outline-none focus:ring-1 focus:ring-ask"
              />
            </div>
          </div>

          {/* Kecepatan Putaran Modal per Hari */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">
              Target Perputaran Modal per Hari ({dailyTurnover}x putaran)
            </label>
            <div className="mt-2 flex gap-2">
              {[1, 2, 3, 5, 8].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDailyTurnover(t)}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    dailyTurnover === t
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "bg-surface-2 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}x / hari
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Hasil Perhitungan / Output Proyeksi (Right Side) */}
        <div className="rounded-xl border border-border/80 bg-surface-2/40 p-5 space-y-4 lg:col-span-6 flex flex-col justify-between">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
              <span>Total Modal Beli</span>
              <span className="num font-bold text-foreground text-sm">{fmtRp(capitalIdr)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
              <span>Total Omset Penjualan</span>
              <span className="num font-bold text-foreground text-sm">{fmtRp(revenueIdr)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
              <span>{buyMethod === "taker" ? "Fee Binance (0% Beli + 0.07% Jual Saja)" : "Fee Binance (0.07% Beli + 0.07% Jual)"}</span>
              <span className="num font-semibold text-ask text-xs">-{fmtRp(totalFeePerCycle)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
              <span>Laba Bersih per Putaran</span>
              <span className="num font-bold text-bid text-base">+{fmtRp(netProfitPerCycleIdr)}</span>
            </div>
          </div>

          {/* Big Profit Highlight Cards */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-lg border border-bid/25 bg-bid/10 p-3.5">
              <div className="flex items-center gap-1 text-[0.65rem] font-bold tracking-wider text-bid uppercase">
                <TrendingUp className="size-3" />
                <span>Net Profit / Hari</span>
              </div>
              <div className="num mt-1.5 text-lg font-extrabold text-bid">
                +{fmtRp(dailyNetProfitIdr)}
              </div>
              <div className="text-[0.65rem] text-muted-foreground mt-0.5">
                {dailyTurnover}x putaran ({fmtRp(capitalIdr * dailyTurnover)} volume)
              </div>
            </div>

            <div className="rounded-lg border border-primary/25 bg-primary/10 p-3.5">
              <div className="flex items-center gap-1 text-[0.65rem] font-bold tracking-wider text-primary uppercase">
                <Sparkles className="size-3" />
                <span>Proyeksi Net / Bulan</span>
              </div>
              <div className="num mt-1.5 text-lg font-extrabold text-primary">
                +{fmtRp(monthlyNetProfitIdr)}
              </div>
              <div className="text-[0.65rem] text-muted-foreground mt-0.5">
                Net ROI: {(netMarginPct * dailyTurnover * 30).toFixed(1)}% / bulan
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
