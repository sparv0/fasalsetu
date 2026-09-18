import { describe, expect, it } from "vitest";
import { gradeFromParams, lowestGrade, parseQualityParams } from "./quality";
import { canonicalJson, hashTerms, verifyAgreement, type AgreementTerms } from "./agreement";
import { faydaScenarios, percentile } from "./fayda";
import { suggestSchemes, type SchemeProfile } from "./schemes";
import { parsePriceCsv, PRICE_CSV_HEADER } from "./priceCsv";
import { hoursLeft, offerExpiry } from "./states";
import { createRateLimiter } from "../rateLimit";

describe("quality grading", () => {
  it("grades onion by the strictest band all parameters meet", () => {
    expect(gradeFromParams("Onion", { bulbSizeMm: 61, damagedPct: 1.4, sproutedPct: 0.5 }).grade).toBe("PREMIUM");
    const a = gradeFromParams("Onion", { bulbSizeMm: 52, damagedPct: 3.5, sproutedPct: 1.2 });
    expect(a.grade).toBe("A");
    expect(a.limitedBy).toEqual(["Bulb size", "Damaged / diseased", "Sprouted"]);
    const sizeOnly = gradeFromParams("Onion", { bulbSizeMm: 52, damagedPct: 1.5, sproutedPct: 0.8 });
    expect(sizeOnly.grade).toBe("A");
    expect(sizeOnly.limitedBy).toEqual(["Bulb size"]);
    expect(gradeFromParams("Onion", { bulbSizeMm: 30, damagedPct: 20, sproutedPct: 9 }).grade).toBe("C");
  });

  it("grades grains on moisture, foreign matter and damage", () => {
    expect(gradeFromParams("Wheat", { moisturePct: 11.5, foreignMatterPct: 0.6, brokenPct: 2.1 }).grade).toBe("A");
    expect(gradeFromParams("Soybean", { moisturePct: 12.8, foreignMatterPct: 1.2, damagedPct: 2.5 }).grade).toBe("B");
  });

  it("rejects out-of-range units and partial measurement sets", () => {
    expect(parseQualityParams("Wheat", { moisturePct: "45", foreignMatterPct: "1", brokenPct: "1" }).error).toMatch(/Moisture must be between/);
    expect(parseQualityParams("Wheat", { moisturePct: "12" }).error).toMatch(/Enter all 3/);
    expect(parseQualityParams("Wheat", {}).params).toBeNull();
  });

  it("takes the lowest grade when pooling", () => {
    expect(lowestGrade(["PREMIUM", "A", "B"])).toBe("B");
    expect(lowestGrade(["A"])).toBe("A");
  });
});

describe("digital agreement", () => {
  const terms: AgreementTerms = {
    version: "FS-AGR-1",
    offerId: "o1",
    seller: { id: "s", name: "S", district: "Nashik", kind: "FARMER" },
    buyer: { id: "b", name: "B", district: "Pune", verified: true },
    commodity: "Onion",
    qualityGrade: "A",
    qualityBasis: "MEASURED",
    quantityQt: 100,
    pricePerQt: 1950,
    totalValue: 195000,
    deliveryTerms: "Farm-gate.",
    deliveryWindowDays: 3,
    paymentTerms: "On delivery.",
    disputeResolution: "Grievance.",
    agreedAt: "2026-09-18T10:00:00.000Z",
  };

  it("hashes independently of key order", () => {
    const shuffled = JSON.parse(JSON.stringify({ ...terms, buyer: { verified: true, district: "Pune", name: "B", id: "b" } }));
    expect(hashTerms(shuffled)).toBe(hashTerms(terms));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("detects tampering with stored terms", () => {
    const stored = canonicalJson(terms);
    const hash = hashTerms(terms);
    expect(verifyAgreement(stored, hash)).toBe(true);
    expect(verifyAgreement(stored.replace('"pricePerQt":1950', '"pricePerQt":1500'), hash)).toBe(false);
    expect(verifyAgreement("not json", hash)).toBe(false);
  });
});

describe("fayda scenarios", () => {
  it("computes revenue, costs, profit and break-even", () => {
    const r = faydaScenarios({
      areaAcres: 2,
      yieldQtPerAcre: 50,
      costPerAcre: 40000,
      deductionPerQt: 100,
      prices: [{ label: "base", price: 2000 }],
    });
    expect(r.quantityQt).toBe(100);
    expect(r.scenarios[0].revenue).toBe(200000);
    expect(r.scenarios[0].profit).toBe(200000 - 10000 - 80000);
    expect(r.scenarios[0].profitPerAcre).toBe(55000);
    expect(r.breakevenPricePerQt).toBe(900);
  });

  it("interpolates percentiles", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("scheme suggestions", () => {
  const base: SchemeProfile = {
    role: "FARMER",
    state: "Maharashtra",
    landAcres: 3,
    socialCategory: "GENERAL",
    commodities: ["Onion"],
    inFpo: false,
    largestLotQt: 80,
  };

  it("suggests land-based and state schemes with reasons", () => {
    const ids = suggestSchemes(base).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["pm-kisan", "pmfby", "kcc", "mahadbt", "fpo", "enam"]));
    expect(ids).not.toContain("aif");
  });

  it("adapts to the profile", () => {
    expect(suggestSchemes({ ...base, landAcres: 0 }).map((s) => s.id)).not.toContain("pm-kisan");
    expect(suggestSchemes({ ...base, inFpo: true }).map((s) => s.id)).not.toContain("fpo");
    const st = suggestSchemes({ ...base, socialCategory: "ST" }).find((s) => s.id === "mahadbt")!;
    expect(st.why.join(" ")).toMatch(/ST farmers/);
    expect(suggestSchemes({ ...base, role: "FPO" }).map((s) => s.id)).toContain("aif");
  });
});

describe("price CSV import", () => {
  const markets = new Map([["solapur apmc", "m1"]]);
  const now = new Date("2026-09-18T12:00:00+05:30");
  const header = PRICE_CSV_HEADER.join(",");

  it("keeps valid rows and reports each bad row by line", () => {
    const csv = [
      header,
      "Solapur APMC,Wheat,2026-09-17,2400,2500,2600,120",
      "Solapur APMC,wheat,2026-09-16,2600,2500,2700,90",
      "Unknown,Wheat,2026-09-16,1,2,3,4",
      "Solapur APMC,Rice,2026-09-16,1,2,3,4",
      "Solapur APMC,Wheat,17/09/2026,1,2,3,4",
      "Solapur APMC,Wheat,2026-09-25,1,2,3,4",
      "Solapur APMC,Wheat,2026-09-17,2400,2500,2600,120",
    ].join("\n");
    const r = parsePriceCsv(csv, markets, now);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ marketId: "m1", commodity: "Wheat", modalPrice: 2500 });
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(r.errors[0].reason).toMatch(/min ≤ modal ≤ max/);
    expect(r.errors[5].reason).toMatch(/Duplicate/);
  });

  it("rejects a wrong header outright", () => {
    const r = parsePriceCsv("a,b,c\n1,2,3", markets, now);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].reason).toMatch(/Header must be/);
  });
});

describe("offer expiry and rate limiting", () => {
  it("computes expiry and hours left", () => {
    const from = new Date("2026-09-18T00:00:00Z");
    const exp = offerExpiry(from, 48);
    expect(exp.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(hoursLeft(exp, new Date("2026-09-19T12:00:00Z"))).toBe(12);
    expect(hoursLeft(exp, new Date("2026-09-21T00:00:00Z"))).toBe(0);
  });

  it("limits requests per key within a window", () => {
    const check = createRateLimiter(2, 1000);
    expect(check("k", 0).allowed).toBe(true);
    expect(check("k", 10).allowed).toBe(true);
    const blocked = check("k", 20);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect(check("other", 20).allowed).toBe(true);
    expect(check("k", 1000).allowed).toBe(true);
  });
});
