/**
 * Deteksi "war" antar bot: beberapa merchant saling overcut +Rp1 berulang kali sehingga harga
 * acuan naik (sisi beli) / turun (sisi jual) bertahap dalam waktu singkat. Pergerakan pasar yang
 * wajar biasanya berupa satu lompatan; war berupa banyak langkah kecil searah.
 *
 * Saat war terdeteksi, harga ditahan di level sebelum war dimulai (titik terendah jendela untuk
 * sisi beli, tertinggi untuk sisi jual) sampai tidak ada langkah searah selama masa cooldown.
 */

export type PriceWarConfig = {
  enabled: boolean;
  /** Jendela pengamatan (detik). */
  windowSec: number;
  /** Minimal jumlah langkah searah di dalam jendela. */
  minSteps: number;
  /** Minimal total pergerakan harga di dalam jendela (Rp). */
  minMoveRp: number;
  /** War dianggap selesai setelah tidak ada langkah searah selama ini (detik). */
  cooldownSec: number;
};

export type PriceWarSide = {
  samples: { t: number; p: number }[];
  active: boolean;
  /** Harga yang ditahan selama war aktif. */
  holdPrice: number;
  /** Harga paling ekstrem yang dicapai pasar selama war. */
  peakPrice: number;
  since: number;
  lastStepAt: number;
};

export const EMPTY_WAR_SIDE: PriceWarSide = {
  samples: [],
  active: false,
  holdPrice: 0,
  peakPrice: 0,
  since: 0,
  lastStepAt: 0,
};

/**
 * Perbarui status war untuk satu sisi. `direction` adalah arah yang berbahaya:
 * "up" untuk harga beli (naik = bayar lebih mahal), "down" untuk harga jual.
 * Fungsi murni: memanggilnya ulang dengan harga yang sama tidak mengubah hasil.
 */
export function updatePriceWarSide(
  prev: PriceWarSide,
  price: number,
  now: number,
  cfg: PriceWarConfig,
  direction: "up" | "down",
): PriceWarSide {
  if (!cfg.enabled) return EMPTY_WAR_SIDE;
  if (!Number.isFinite(price) || price <= 0) return prev;

  const windowMs = Math.max(5, cfg.windowSec) * 1000;
  const sign = direction === "up" ? 1 : -1;
  const last = prev.samples[prev.samples.length - 1];
  const stepped = last !== undefined && (price - last.p) * sign > 0;

  let samples = last && last.p === price ? prev.samples : [...prev.samples, { t: now, p: price }];
  // Simpan satu sampel sebelum jendela sebagai titik awal pergerakan.
  const firstInWindow = samples.findIndex((s) => now - s.t <= windowMs);
  if (firstInWindow > 1) samples = samples.slice(firstInWindow - 1);
  if (samples.length > 200) samples = samples.slice(-200);

  let state: PriceWarSide = { ...prev, samples };

  if (state.active) {
    if (stepped) state.lastStepAt = now;
    state.peakPrice = direction === "up" ? Math.max(state.peakPrice, price) : Math.min(state.peakPrice, price);
    if (now - state.lastStepAt >= Math.max(5, cfg.cooldownSec) * 1000) {
      // War reda: lepas penahanan dan mulai pengamatan baru dari harga sekarang.
      return { ...EMPTY_WAR_SIDE, samples: [{ t: now, p: price }] };
    }
    return state;
  }

  let steps = 0;
  for (let i = 1; i < samples.length; i++) {
    const cur = samples[i]!;
    const before = samples[i - 1]!;
    if ((cur.p - before.p) * sign > 0 && now - cur.t <= windowMs) steps++;
  }
  const prices = samples.map((s) => s.p);
  const start = direction === "up" ? Math.min(...prices) : Math.max(...prices);
  const move = (price - start) * sign;

  if (steps >= cfg.minSteps && move >= cfg.minMoveRp) {
    state = { samples, active: true, holdPrice: start, peakPrice: price, since: now, lastStepAt: now };
  }
  return state;
}

/** Harga final setelah penahanan war (tidak pernah lebih buruk dari harga mentah). */
export function applyPriceWarHold(rawPrice: number, side: PriceWarSide, direction: "up" | "down"): number {
  if (!side.active || side.holdPrice <= 0) return rawPrice;
  return direction === "up" ? Math.min(rawPrice, side.holdPrice) : Math.max(rawPrice, side.holdPrice);
}
