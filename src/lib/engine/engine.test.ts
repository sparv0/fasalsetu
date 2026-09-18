import { describe, expect, it } from "vitest";
import { DISTRICT_COORDS, LOADING_PER_QT, MARKET_CHARGES_PCT, MIN_DISTANCE_KM } from "./config";
import { haversineKm, quoteTransport, roadDistanceKm } from "./logistics";
import { fitTrend, pctChange, predict, type PricePoint } from "./forecast";
import { directOfferOption, mandiOption, rankOptions, sellVsStore, type LotInput, type MandiInput } from "./netRealise";
import { scoreMatch } from "./matching";
import { availableOrderActions, lotStatusAfterSale, orderActionAllowed } from "./states";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-18T10:00:00Z");

function linearSeries(start: number, perDay: number, days: number): PricePoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(NOW.getTime() - (days - 1 - i) * DAY),
    price: start + perDay * i,
  }));
}

function mandi(overrides: Partial<MandiInput> = {}): MandiInput {
  return {
    marketId: "m1",
    marketName: "Test APMC",
    district: "Nashik",
    point: DISTRICT_COORDS.Nashik,
    latest: { date: NOW, modal: 2000, min: 1800, max: 2200, arrivalsQt: 500 },
    recentModals: [2000, 2000, 2000, 2000, 2000, 2000, 2000],
    trend: fitTrend(linearSeries(2000, 0, 30)),
    ...overrides,
  };
}

const lot: LotInput = { commodity: "Wheat", quantityQt: 100, district: "Nashik", point: DISTRICT_COORDS.Nashik };

describe("logistics", () => {
  it("estimates realistic road distances between districts", () => {
    const straight = haversineKm(DISTRICT_COORDS.Nashik, DISTRICT_COORDS.Pune);
    expect(straight).toBeGreaterThan(150);
    expect(straight).toBeLessThan(180);
    const road = roadDistanceKm(DISTRICT_COORDS.Nashik, DISTRICT_COORDS.Pune);
    expect(road).toBeGreaterThan(straight);
    expect(road).toBeLessThan(240);
  });

  it("never returns less than the minimum local haul", () => {
    expect(roadDistanceKm(DISTRICT_COORDS.Pune, DISTRICT_COORDS.Pune)).toBe(MIN_DISTANCE_KM);
  });

  it("picks the cheapest vehicle plan", () => {
    expect(quoteTransport(20, 100).vehicle).toMatch(/Tempo/);
    const q = quoteTransport(120, 100);
    expect(q.vehicle).toMatch(/Large truck/);
    expect(q.trips).toBe(1);
    expect(q.loading).toBe(120 * LOADING_PER_QT);
    expect(q.total).toBe(q.freight + q.loading);
  });

  it("charges more for longer hauls and rejects empty loads", () => {
    expect(quoteTransport(50, 300).total).toBeGreaterThan(quoteTransport(50, 30).total);
    expect(() => quoteTransport(0, 10)).toThrow();
  });
});

describe("forecast", () => {
  it("recovers a clean linear trend with high confidence", () => {
    const fit = fitTrend(linearSeries(1000, 10, 30))!;
    expect(fit.slopePerDay).toBeCloseTo(10, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.confidence).toBe("HIGH");
    expect(predict(fit, 7).value).toBeCloseTo(1000 + 10 * 29 + 70, 6);
  });

  it("refuses to fit tiny series", () => {
    expect(fitTrend(linearSeries(1000, 10, 4))).toBeNull();
  });

  it("marks noisy series as low confidence", () => {
    const noisy = linearSeries(1000, 0, 30).map((p, i) => ({ ...p, price: p.price + (i % 2 === 0 ? 150 : -150) }));
    expect(fitTrend(noisy)!.confidence).toBe("LOW");
  });

  it("computes percentage change over a window", () => {
    expect(pctChange(linearSeries(1000, 10, 30), 10)).toBeCloseTo(((1290 - 1190) / 1190) * 100, 6);
    expect(pctChange([], 7)).toBeNull();
  });
});

describe("net realisation", () => {
  it("deducts transport and market charges from gross value", () => {
    const o = mandiOption(lot, mandi({ point: DISTRICT_COORDS.Pune }), NOW);
    const gross = 2000 * 100;
    expect(o.grossValue).toBe(gross);
    expect(o.charges).toBeCloseTo(gross * MARKET_CHARGES_PCT);
    expect(o.netTotal).toBeCloseTo(gross - o.transport!.total - o.charges);
    expect(o.netPerQt).toBeCloseTo(o.netTotal / 100);
    expect(o.confidence).toBe("HIGH");
  });

  it("lowers confidence for stale or volatile data", () => {
    const stale = mandiOption(lot, mandi({ latest: { date: new Date(NOW.getTime() - 5 * DAY), modal: 2000, min: 1900, max: 2100, arrivalsQt: 500 } }), NOW);
    expect(stale.confidence).toBe("LOW");
    const volatile = mandiOption(lot, mandi({ recentModals: [1600, 2400, 1600, 2400, 1600, 2400, 2000] }), NOW);
    expect(volatile.confidence).toBe("MEDIUM");
  });

  it("treats a farm-gate offer as price × quantity with no deductions", () => {
    const o = directOfferOption({
      offerId: "o1",
      buyerName: "B",
      buyerDistrict: "Pune",
      buyerVerified: false,
      pricePerQt: 2100,
      counterPricePerQt: null,
      quantityQt: 40,
      status: "PENDING",
    });
    expect(o.netTotal).toBe(84000);
    expect(o.charges).toBe(0);
    expect(o.confidence).toBe("MEDIUM");
  });

  it("ranks the nearer market above a slightly pricier distant one when transport eats the gain", () => {
    const near = mandiOption(lot, mandi({ marketId: "near" }), NOW);
    const far = mandiOption(
      lot,
      mandi({ marketId: "far", point: DISTRICT_COORDS.Solapur, latest: { date: NOW, modal: 2050, min: 1900, max: 2200, arrivalsQt: 500 } }),
      NOW
    );
    expect(rankOptions([far, near])[0].id).toBe("near");
  });
});

describe("sell vs store", () => {
  const facility = { name: "Store", district: "Nashik", point: DISTRICT_COORDS.Nashik, costPerQtPerDay: 0.4 };

  it("says sell now when prices are flat", () => {
    const m = mandi();
    const r = sellVsStore(lot, [m], mandiOption(lot, m, NOW), facility);
    expect(r.verdict).toBe("SELL_NOW");
    expect(r.scenarios).toHaveLength(2);
  });

  it("recommends storage when a reliable rising trend beats all costs", () => {
    const m = mandi({ trend: fitTrend(linearSeries(1500, 25, 30)) });
    const r = sellVsStore(lot, [m], mandiOption(lot, m, NOW), facility);
    expect(r.verdict).toBe("STORE");
    expect(r.best!.netTotal).toBeGreaterThan(r.sellNowNet);
  });

  it("falls back to sell now when there is no facility", () => {
    const m = mandi();
    const r = sellVsStore(lot, [m], mandiOption(lot, m, NOW), null);
    expect(r.verdict).toBe("SELL_NOW");
    expect(r.facility).toBeNull();
  });
});

describe("buyer matching", () => {
  const demand = { quantityQt: 100, qualityMin: "B", pricePerQt: 2100, point: DISTRICT_COORDS.Nashik, buyerVerified: true };
  const matchLot = { quantityQt: 100, qualityGrade: "A", point: DISTRICT_COORDS.Nashik };

  it("gives a near-perfect score to a local, verified, well-priced exact fit", () => {
    const r = scoreMatch(matchLot, demand, 2000);
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(r.qualityOk).toBe(true);
  });

  it("penalises quality below the buyer's minimum", () => {
    const good = scoreMatch(matchLot, demand, 2000);
    const bad = scoreMatch({ ...matchLot, qualityGrade: "C" }, demand, 2000);
    expect(bad.qualityOk).toBe(false);
    expect(good.score - bad.score).toBe(20);
  });

  it("scores distant buyers lower", () => {
    const far = scoreMatch(matchLot, { ...demand, point: DISTRICT_COORDS.Solapur }, 2000);
    expect(far.score).toBeLessThan(scoreMatch(matchLot, demand, 2000).score);
  });
});

describe("order state machine", () => {
  it("only lets the right party act at the right step", () => {
    expect(orderActionAllowed("BOOK_LOGISTICS", "CREATED", "BUYER")).toBeNull();
    expect(orderActionAllowed("BOOK_LOGISTICS", "CREATED", "FARMER")).toMatch(/only the buyer/i);
    expect(orderActionAllowed("CONFIRM_PAYMENT", "DELIVERED", "FARMER")).toMatch(/needs it to be/);
    expect(orderActionAllowed("CLOSE", "PAID", null)).not.toBeNull();
  });

  it("walks the full flow with alternating parties", () => {
    expect(availableOrderActions("CREATED", "BUYER")).toEqual(["BOOK_LOGISTICS"]);
    expect(availableOrderActions("LOGISTICS_BOOKED", "FARMER")).toEqual(["MARK_IN_TRANSIT"]);
    expect(availableOrderActions("IN_TRANSIT", "BUYER")).toEqual(["MARK_DELIVERED"]);
    expect(availableOrderActions("DELIVERED", "BUYER")).toEqual(["INITIATE_PAYMENT"]);
    expect(availableOrderActions("PAYMENT_INITIATED", "FARMER")).toEqual(["CONFIRM_PAYMENT"]);
    expect(availableOrderActions("PAID", "FARMER")).toEqual(["CLOSE"]);
    expect(availableOrderActions("CLOSED", "BUYER")).toEqual([]);
  });

  it("derives lot status from remaining quantity", () => {
    expect(lotStatusAfterSale(100, 0)).toBe("SOLD");
    expect(lotStatusAfterSale(100, 40)).toBe("PARTIALLY_SOLD");
    expect(lotStatusAfterSale(100, 100)).toBe("OPEN");
  });
});
