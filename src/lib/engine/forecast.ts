export type PricePoint = { date: Date; price: number };
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type TrendFit = {
  slopePerDay: number;
  intercept: number;
  lastX: number;
  residualStd: number;
  r2: number;
  points: number;
  confidence: Confidence;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Ordinary least squares on (days since first point, price). A transparent
// baseline, deliberately not presented as an ML model.
export function fitTrend(series: PricePoint[]): TrendFit | null {
  if (series.length < 5) return null;
  const sorted = [...series].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();
  const xs = sorted.map((p) => (p.date.getTime() - t0) / DAY_MS);
  const ys = sorted.map((p) => p.price);
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const fitted = intercept + slope * xs[i];
    ssRes += (ys[i] - fitted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const residualStd = Math.sqrt(ssRes / Math.max(1, n - 2));

  const confidence: Confidence =
    n >= 21 && r2 >= 0.5 ? "HIGH" : n >= 14 && r2 >= 0.2 ? "MEDIUM" : "LOW";

  return { slopePerDay: slope, intercept, lastX: xs[n - 1], residualStd, r2, points: n, confidence };
}

export function predict(fit: TrendFit, daysAhead: number) {
  const value = fit.intercept + fit.slopePerDay * (fit.lastX + daysAhead);
  const band = 1.64 * fit.residualStd; // ~90% interval under normal residuals
  return { value, low: value - band, high: value + band };
}

// % change between the latest point and the point closest to `days` earlier.
export function pctChange(series: PricePoint[], days: number): number | null {
  if (series.length < 2) return null;
  const sorted = [...series].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = sorted[sorted.length - 1];
  const target = latest.date.getTime() - days * DAY_MS;
  let base: PricePoint | null = null;
  for (const p of sorted) {
    if (p.date.getTime() <= target) base = p;
  }
  if (!base || base.price === 0) return null;
  return ((latest.price - base.price) / base.price) * 100;
}
