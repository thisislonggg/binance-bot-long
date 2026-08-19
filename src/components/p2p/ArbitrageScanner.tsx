import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Layers,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  computeArbitrageRoutes,
  type ArbitrageOpportunity,
  type ArbitrageScanResult,
} from "@/lib/arbitrage";
import { fmtPct, fmtRp, fmtRp2 } from "@/lib/p2p-engine";

export function ArbitrageScanner({
  myBuyPrice,
  mySellPrice,
  indodaxSpotPrice = 0,
  coingeckoPrice = 0,
  forexRate = 0,
  onRefresh,
  isRefreshing = false,
}: {
  myBuyPrice: number;
  mySellPrice: number;
  indodaxSpotPrice?: number;
  coingeckoPrice?: number;
  forexRate?: number;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const [calcCapitalIdr, setCalcCapitalIdr] = useState<string>("20000000"); // Default 20jt
  const [selectedRouteId, setSelectedRouteId] = useState<string>("spot_indodax_to_binance_p2p");
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);

  const scanResult: ArbitrageScanResult = useMemo(() => {
    return computeArbitrageRoutes({
      myBuyPrice: myBuyPrice || 17780,
      mySellPrice: mySellPrice || 17830,
      indodaxSpotPrice,
      coingeckoPrice,
      forexRate,
    });
  }, [myBuyPrice, mySellPrice, indodaxSpotPrice, coingeckoPrice, forexRate]);

  // Kalkulasi Simulasi Modal
  const capitalNum = parseFloat(calcCapitalIdr) || 0;
  const activeRoute = scanResult.opportunities.find((o) => o.id === selectedRouteId) || scanResult.opportunities[0];

  const simResult = useMemo(() => {
    if (!activeRoute || capitalNum <= 0) return null;

    const buyPrice = activeRoute.buy_price;
    const sellPrice = activeRoute.sell_price;

    // Jumlah USDT yang didapat dari modal
    const usdtAcquired = capitalNum / buyPrice;

    // Fee Beli
    const buyFeeRate = activeRoute.direction === "spot_to_p2p" ? 0.001 : 0.0008;
    const buyFeeIdr = capitalNum * buyFeeRate;

    // Fee Transfer Blockchain (~1 USDT jika antar bursa onchain)
    const transferFeeIdr = activeRoute.direction === "p2p_cycle" ? 0 : 17800;

    // USDT Bersih setelah fee transfer
    const netUsdtToSell = Math.max(0, usdtAcquired - (transferFeeIdr > 0 ? transferFeeIdr / buyPrice : 0));

    // Hasil Penjualan Bruto di platform tujuan
    const grossSaleIdr = netUsdtToSell * sellPrice;

    // Fee Jual
    const sellFeeRate = activeRoute.direction === "p2p_to_spot" ? 0.001 : 0.0008;
    const sellFeeIdr = grossSaleIdr * sellFeeRate;

    // Modal Kas Akhir
    const finalCapitalIdr = grossSaleIdr - sellFeeIdr;

    // Net Realized Profit
    const netProfitIdr = finalCapitalIdr - capitalNum - (activeRoute.direction !== "p2p_cycle" ? 0 : 0);
    const netRoi = (netProfitIdr / capitalNum) * 100;

    return {
      usdtAcquired,
      buyFeeIdr,
      transferFeeIdr,
      netUsdtToSell,
      grossSaleIdr,
      sellFeeIdr,
      finalCapitalIdr,
      netProfitIdr,
      netRoi,
    };
  }, [activeRoute, capitalNum]);

  return (
    <div className="space-y-5">
      {/* ── Top Header & Hero Opportunity Card ─────────────────────────────── */}
      <div className="panel p-4.5 space-y-3.5 border-primary/30">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-primary" />
            <div>
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                Radar Arbitrase Lintas Bursa USDT/IDR
              </h3>
              <p className="text-xs text-muted-foreground">
                Pindai selisih harga instan antara Binance P2P, Indodax Spot, dan acuan pasar.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {scanResult.p2p_status === "premium" ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-400">
                <TrendingUp className="size-3.5" /> P2P Premium (+{fmtPct(scanResult.p2p_premium_pct)})
              </span>
            ) : scanResult.p2p_status === "discount" ? (
              <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 border border-rose-500/30 px-2.5 py-1 text-xs font-bold text-rose-400">
                P2P Diskon ({fmtPct(scanResult.p2p_premium_pct)})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-surface-3 border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                P2P Paritas (~0%)
              </span>
            )}

            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="h-7 gap-1 text-xs bg-surface-2 hover:bg-surface-3"
              >
                <RefreshCw className={isRefreshing ? "size-3 animate-spin" : "size-3"} />
                <span>Pindai Ulang</span>
              </Button>
            )}
          </div>
        </div>

        {/* Peluang Terbaik Detik Ini */}
        {scanResult.best_opportunity ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex size-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  Peluang Terbaik: {scanResult.best_opportunity.title}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Beli di <strong>{scanResult.best_opportunity.buy_platform} ({fmtRp2(scanResult.best_opportunity.buy_price)})</strong> ➔ Jual di <strong>{scanResult.best_opportunity.sell_platform} ({fmtRp2(scanResult.best_opportunity.sell_price)})</strong>
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[0.65rem] text-muted-foreground uppercase font-semibold">Laba Bersih Riil</div>
                <div className="text-base font-extrabold text-emerald-400">
                  +{fmtRp(scanResult.best_opportunity.net_profit_per_usdt)} <span className="text-xs font-normal text-muted-foreground">/ USDT</span>
                </div>
              </div>

              <div className="text-right border-l border-emerald-500/30 pl-4">
                <div className="text-[0.65rem] text-muted-foreground uppercase font-semibold">Estimasi ROI</div>
                <div className="text-base font-extrabold text-emerald-400">
                  +{fmtPct(scanResult.best_opportunity.net_roi_pct)}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground text-center">
            Pasar saat ini seimbang, belum terdeteksi celah arbitrase signifikan antar bursa.
          </div>
        )}
      </div>

      {/* ── Tabel Perbandingan Harga Lintas Platform ──────────────────────── */}
      <div className="panel p-4 space-y-3">
        <div className="border-b border-border pb-2">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
            Tabel Harga Pasar Multi-Bursa Real-Time
          </h3>
          <p className="text-xs text-muted-foreground">
            Perbandingan harga beli & jual langsung pada setiap platform trading terverifikasi.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                <th className="py-2.5 pr-4 text-left font-semibold">Platform Bursa</th>
                <th className="py-2.5 pr-4 text-left font-semibold">Tipe Pasar</th>
                <th className="py-2.5 pr-4 text-right font-semibold">Harga Beli Kita</th>
                <th className="py-2.5 pr-4 text-right font-semibold">Harga Jual Kita</th>
                <th className="py-2.5 pr-4 text-right font-semibold">Biaya Fee</th>
                <th className="py-2.5 text-center font-semibold">Status Feed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {scanResult.exchanges.map((ex) => (
                <tr key={ex.id} className="hover:bg-surface-2/60 transition-colors">
                  <td className="py-2.5 pr-4 font-semibold text-foreground flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary" />
                    <span>{ex.name}</span>
                    <span className="rounded bg-surface-3 px-1.5 py-0.2 text-[0.6rem] text-muted-foreground">
                      {ex.badge}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground capitalize">{ex.type}</td>
                  <td className="py-2.5 pr-4 text-right num font-bold text-bid">{fmtRp2(ex.buy_price)}</td>
                  <td className="py-2.5 pr-4 text-right num font-bold text-ask">{fmtRp2(ex.sell_price)}</td>
                  <td className="py-2.5 pr-4 text-right text-muted-foreground">
                    {ex.fee_pct > 0 ? `${ex.fee_pct}%` : "0% (Acuan)"}
                  </td>
                  <td className="py-2.5 text-center">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[0.65rem] font-medium ${
                        ex.status === "active"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-amber-500/15 text-amber-400"
                      }`}
                    >
                      <span className="size-1.5 rounded-full bg-current" />
                      {ex.status === "active" ? "Aktif" : "Tertunda"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Kartu Rute Peluang Arbitrase ─────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
            Daftar Rute Arbitrase yang Dapat Dieksekusi
          </h3>
          <span className="text-xs text-muted-foreground">
            {scanResult.opportunities.length} rute terdeteksi
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          {scanResult.opportunities.map((opp) => {
            const isLucrative = opp.status === "lucrative";
            const isModerate = opp.status === "moderate";
            const isExpanded = expandedRouteId === opp.id;

            return (
              <div
                key={opp.id}
                className={`panel p-4 space-y-3 flex flex-col justify-between transition-all ${
                  isLucrative
                    ? "border-emerald-500/40 bg-emerald-500/5 shadow-sm"
                    : isModerate
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-border"
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider border ${
                        isLucrative
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : isModerate
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            : "bg-surface-3 text-muted-foreground border-border"
                      }`}
                    >
                      {opp.status_label}
                    </span>

                    <span className="num text-xs font-bold text-foreground">
                      ROI: +{fmtPct(opp.net_roi_pct)}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-foreground">{opp.title}</h4>

                  {/* Visual Route */}
                  <div className="rounded bg-surface-2 p-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="text-[0.65rem] text-muted-foreground">Beli di {opp.buy_platform}</div>
                      <div className="num font-bold text-bid">{fmtRp2(opp.buy_price)}</div>
                    </div>

                    <ArrowRight className="size-4 text-muted-foreground" />

                    <div className="text-right">
                      <div className="text-[0.65rem] text-muted-foreground">Jual di {opp.sell_platform}</div>
                      <div className="num font-bold text-ask">{fmtRp2(opp.sell_price)}</div>
                    </div>
                  </div>

                  {/* Financial Breakdown */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Spread Kotor:</span>
                      <span className="num font-medium text-foreground">+{fmtRp(opp.gross_spread_idr)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Estimasi Fee (Beli + Jual):</span>
                      <span className="num font-medium text-rose-400">-{fmtRp(opp.total_fee_per_usdt)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/60 pt-1.5 font-bold">
                      <span>Laba Bersih Riil:</span>
                      <span className={`num text-sm ${opp.net_profit_per_usdt > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {opp.net_profit_per_usdt > 0 ? `+${fmtRp(opp.net_profit_per_usdt)}` : fmtRp(opp.net_profit_per_usdt)} / USDT
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => setExpandedRouteId(isExpanded ? null : opp.id)}
                    className="flex w-full items-center justify-between text-[0.7rem] text-primary hover:underline font-semibold"
                  >
                    <span>{isExpanded ? "Tutup Langkah Eksekusi" : "Lihat Langkah Eksekusi"}</span>
                    {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  </button>

                  {isExpanded && (
                    <div className="rounded bg-surface-3/80 p-2.5 space-y-2 text-[0.7rem] text-muted-foreground border border-border animate-in fade-in-50">
                      <div className="font-semibold text-foreground">Langkah Praktis:</div>
                      <ul className="space-y-1 pl-1">
                        {opp.execution_steps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                      <p className="text-[0.65rem] text-amber-400/90 border-t border-border/40 pt-1.5">
                        ⚠️ {opp.risk_warning}
                      </p>
                    </div>
                  )}

                  <Button
                    size="sm"
                    variant={selectedRouteId === opp.id ? "default" : "outline"}
                    onClick={() => {
                      setSelectedRouteId(opp.id);
                      const el = document.getElementById("sim-calc");
                      if (el) el.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="w-full text-xs h-7.5"
                  >
                    {selectedRouteId === opp.id ? "✓ Rute Aktif di Simulasi" : "Simulasikan Modal Ini"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Kalkulator Simulasi Arbitrase Multi-Modal ─────────────────────── */}
      <div id="sim-calc" className="panel p-4.5 space-y-4 border-primary/25">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Calculator className="size-4 text-primary" />
            <div>
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                Simulasi Laba Bersih Modal Arbitrase
              </h3>
              <p className="text-xs text-muted-foreground">
                Hitung proyeksi hasil kas akhir setelah seluruh potongan fee bursa & transfer.
              </p>
            </div>
          </div>

          <span className="rounded bg-surface-2 border border-border px-2.5 py-1 text-xs font-semibold text-primary">
            Rute: {activeRoute?.title ?? "P2P Arbitrage"}
          </span>
        </div>

        {/* Input Modal */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Modal Kerja Awal (IDR)</Label>
            <Input
              type="number"
              value={calcCapitalIdr}
              onChange={(e) => setCalcCapitalIdr(e.target.value)}
              placeholder="20000000"
              className="bg-surface-2 text-xs h-8.5 font-bold num"
            />
            <div className="flex gap-1.5 pt-1">
              {["10000000", "20000000", "50000000", "100000000"].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCalcCapitalIdr(v)}
                  className="rounded bg-surface-3 px-2 py-0.5 text-[0.65rem] text-muted-foreground hover:text-foreground"
                >
                  {Number(v) / 1_000_000}jt
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Harga Beli Acuan ({activeRoute?.buy_platform ?? "Platform Beli"})</Label>
            <div className="rounded border border-border bg-surface-2 px-3 py-1.5 text-xs font-bold num text-bid h-8.5 flex items-center">
              {fmtRp2(activeRoute?.buy_price ?? 0)}
            </div>
            <span className="text-[0.65rem] text-muted-foreground">Termasuk fee platform</span>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Harga Jual Acuan ({activeRoute?.sell_platform ?? "Platform Jual"})</Label>
            <div className="rounded border border-border bg-surface-2 px-3 py-1.5 text-xs font-bold num text-ask h-8.5 flex items-center">
              {fmtRp2(activeRoute?.sell_price ?? 0)}
            </div>
            <span className="text-[0.65rem] text-muted-foreground">Termasuk fee platform</span>
          </div>
        </div>

        {/* Hasil Simulasi Breakdown */}
        {simResult && (
          <div className="rounded-lg border border-border bg-surface-2/80 p-4 space-y-3.5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              <div className="space-y-0.5">
                <span className="text-[0.65rem] text-muted-foreground">Volume USDT Didapat</span>
                <div className="num font-bold text-foreground text-sm">
                  {simResult.usdtAcquired.toLocaleString("id-ID", { maximumFractionDigits: 2 })} USDT
                </div>
              </div>

              <div className="space-y-0.5">
                <span className="text-[0.65rem] text-muted-foreground">Total Fee Trading</span>
                <div className="num font-bold text-rose-400 text-sm">
                  -{fmtRp(simResult.buyFeeIdr + simResult.sellFeeIdr)}
                </div>
              </div>

              <div className="space-y-0.5">
                <span className="text-[0.65rem] text-muted-foreground">Fee Transfer Jaringan</span>
                <div className="num font-bold text-muted-foreground text-sm">
                  {simResult.transferFeeIdr > 0 ? `-${fmtRp(simResult.transferFeeIdr)}` : "Rp 0 (P2P)"}
                </div>
              </div>

              <div className="space-y-0.5">
                <span className="text-[0.65rem] text-muted-foreground">Kas Akhir Rupiah</span>
                <div className="num font-bold text-foreground text-sm">
                  {fmtRp(simResult.finalCapitalIdr)}
                </div>
              </div>
            </div>

            {/* Total Profit Hero Box */}
            <div className="rounded border border-primary/30 bg-primary/10 p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[0.7rem] font-bold text-primary uppercase tracking-wider">
                  Proyeksi Laba Bersih Bersih (Net Profit)
                </span>
                <p className="text-xs text-muted-foreground">
                  Keuntungan riil setelah semua biaya perputaran modal satu siklus.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-2xl font-extrabold text-foreground num">
                  {simResult.netProfitIdr >= 0 ? `+${fmtRp(simResult.netProfitIdr)}` : fmtRp(simResult.netProfitIdr)}
                </div>
                <span className="rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-1 text-xs font-bold">
                  ROI: +{fmtPct(simResult.netRoi)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
