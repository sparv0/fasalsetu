import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commodityName, makeT, qtyL, statusName } from "./i18n";
import { localizeMessage } from "./actionMessages";
import { DISTRICT_COORDS } from "./engine/config";
import { fitTrend } from "./engine/forecast";
import { mandiOption, sellVsStore } from "./engine/netRealise";
import { scoreMatch } from "./engine/matching";
import { suggestSchemes } from "./engine/schemes";

const DEVANAGARI = /[ऀ-ॿ]/;
const NOW = new Date("2026-09-18T10:00:00Z");

describe("ui helpers", () => {
  it("switches strings by language and falls back to English for Marathi UI", () => {
    expect(makeT("hi")("Sell now", "अभी बेचें")).toBe("अभी बेचें");
    expect(makeT("en")("Sell now", "अभी बेचें")).toBe("Sell now");
    expect(makeT("mr")("Sell now", "अभी बेचें")).toBe("Sell now");
    expect(commodityName("Onion", "hi")).toBe("प्याज");
    expect(qtyL(120, "hi")).toBe("120 क्विंटल");
    expect(statusName("PARTIALLY_SOLD", "hi")).toBe("आंशिक बिका");
  });
});

describe("engine output in Hindi", () => {
  const lot = { commodity: "Onion", quantityQt: 100, district: "Nashik", point: DISTRICT_COORDS.Nashik };
  const series = Array.from({ length: 30 }, (_, i) => ({ date: new Date(NOW.getTime() - (29 - i) * 86400000), price: 2000 }));
  const m = {
    marketId: "m",
    marketName: "Nashik APMC",
    district: "Nashik",
    point: DISTRICT_COORDS.Nashik,
    latest: { date: NOW, modal: 2000, min: 1900, max: 2100, arrivalsQt: 500 },
    recentModals: [2000, 2000, 2000],
    trend: fitTrend(series),
  };

  it("keeps numbers identical and only changes the words", () => {
    const en = mandiOption(lot, m, NOW, "en");
    const hi = mandiOption(lot, m, NOW, "hi");
    expect(hi.netTotal).toBe(en.netTotal);
    expect(hi.reasons.every((r) => DEVANAGARI.test(r))).toBe(true);
    const verdict = sellVsStore(lot, [m], hi, null, "hi");
    expect(verdict.reason).toContain("प्याज");
  });

  it("localises match reasons and scheme suggestions", () => {
    const r = scoreMatch(
      { quantityQt: 100, qualityGrade: "A", point: DISTRICT_COORDS.Nashik },
      { quantityQt: 100, qualityMin: "B", pricePerQt: 2100, point: DISTRICT_COORDS.Pune, buyerVerified: true },
      2000,
      "hi"
    );
    expect(r.reasons.every((x) => DEVANAGARI.test(x))).toBe(true);
    const s = suggestSchemes(
      { role: "FARMER", state: "Maharashtra", landAcres: 3, socialCategory: "ST", commodities: ["Onion"], inFpo: false, largestLotQt: 50 },
      "hi"
    );
    expect(s.length).toBeGreaterThan(3);
    expect(s.every((x) => DEVANAGARI.test(x.summary))).toBe(true);
  });
});

describe("server message catalogue", () => {
  it("translates fixed and templated messages", () => {
    expect(localizeMessage("Lot not found.", "hi")).toBe("लॉट नहीं मिला।");
    expect(localizeMessage("Lot not found.", "en")).toBe("Lot not found.");
    expect(localizeMessage("Offer sent: ₹1,880/qt for 100 qt. It expires in 48 hours if not answered.", "hi")).toBe(
      "ऑफ़र भेजा: ₹1,880/क्विंटल, 100 क्विंटल के लिए। जवाब न मिलने पर 48 घंटे में समाप्त हो जाएगा।"
    );
    expect(localizeMessage("Onion lot of 45 qt created — grade A, measured, limited by bulb size.", "hi")).toBe(
      "प्याज का 45 क्विंटल का लॉट बना — ग्रेड A, मापा गया (कंद का आकार के कारण)।"
    );
    expect(localizeMessage("Pickup booked: 1 × Truck (10 T), 8 km, ₹2,000 (mock provider).", "hi")).toContain("पिकअप बुक");
  });

  it("has a Hindi version of every fixed message the server can return", () => {
    const files = ["actions.ts", "accessActions.ts", "media.ts", "ai/actions.ts", "ai/gemini.ts"].map((f) =>
      readFileSync(path.join(__dirname, f), "utf8")
    );
    const fixed = new Set<string>();
    const re = /(?:ActionError|AiError)\(\s*"([^"]+)"|error:\s*"([^"]+)"|\.(?:min|max|positive|int)\([^,"]*,?\s*"([^"]+)"\)/g;
    for (const src of files) {
      for (const m of src.matchAll(re)) fixed.add(m[1] ?? m[2] ?? m[3]);
    }
    expect(fixed.size).toBeGreaterThan(40);
    const missing = [...fixed].filter((msg) => localizeMessage(msg, "hi") === msg);
    expect(missing).toEqual([]);
  });
});
