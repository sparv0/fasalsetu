import { z } from "zod";
import { loadMarketSeries, loadModalHistory } from "./decision";
import { COMMODITIES } from "./engine/config";
import { districtPoint } from "./engine/logistics";
import { mandiOption } from "./engine/netRealise";
import { predict } from "./engine/forecast";
import { faydaScenarios, percentile } from "./engine/fayda";
import { makeT, type UiLang } from "./i18n";

export const faydaSchema = z.object({
  commodity: z.enum(COMMODITIES),
  areaAcres: z.coerce.number().positive("Area must be more than zero.").max(1000, "Area is too large."),
  yieldQtPerAcre: z.coerce.number().positive("Enter your expected yield.").max(500, "Yield looks unrealistic."),
  costPerAcre: z.coerce.number().min(0, "Cost can't be negative.").max(1_000_000, "Cost looks unrealistic."),
  harvestInDays: z.coerce.number().int().min(0).max(240, "Look-ahead is limited to 240 days."),
});
export type FaydaInput = z.infer<typeof faydaSchema>;

export type FaydaReport = {
  result: ReturnType<typeof faydaScenarios>;
  reference: { market: string; deductionPerQt: number; source: string; confidence?: string };
} | null;

export async function computeFayda(input: FaydaInput, district: string, lang: UiLang = "en"): Promise<FaydaReport> {
  const t = makeT(lang);
  const quantityQt = input.areaAcres * input.yieldQtPerAcre;
  const lot = { commodity: input.commodity, quantityQt, district, point: districtPoint(district) };
  const mandis = await loadMarketSeries(input.commodity);
  const now = new Date();
  const best = mandis.map((m) => ({ m, o: mandiOption(lot, m, now) })).sort((a, b) => b.o.netPerQt - a.o.netPerQt)[0];
  if (!best) return null;

  const deductionPerQt = (best.o.transport!.total + best.o.charges) / quantityQt;
  let prices: { label: string; price: number }[];
  let source: string;
  let confidence: string | undefined;
  if (input.harvestInDays <= 30 && best.m.trend && best.m.trend.confidence !== "LOW") {
    const f = predict(best.m.trend, input.harvestInDays);
    prices = [
      { label: t("Low (trend band)", "कम (रुझान दायरा)"), price: f.low },
      { label: t("Expected (trend)", "अपेक्षित (रुझान)"), price: f.value },
      { label: t("High (trend band)", "ज़्यादा (रुझान दायरा)"), price: f.high },
    ];
    source = t(
      `30-day price trend at ${best.m.marketName}, projected ${input.harvestInDays} days ahead`,
      `${best.m.marketName} का 30 दिन का भाव रुझान, ${input.harvestInDays} दिन आगे तक अनुमानित`
    );
    confidence = best.m.trend.confidence;
  } else {
    const modals = await loadModalHistory(best.m.marketId, input.commodity, 90);
    prices = [
      { label: t("Weak market (P10)", "कमज़ोर बाज़ार (P10)"), price: percentile(modals, 0.1) },
      { label: t("Typical (median)", "सामान्य (मध्य)"), price: percentile(modals, 0.5) },
      { label: t("Strong market (P90)", "मज़बूत बाज़ार (P90)"), price: percentile(modals, 0.9) },
    ];
    source = t(
      `Range of the last 90 days at ${best.m.marketName} — too far ahead to project a trend honestly`,
      `${best.m.marketName} के पिछले 90 दिनों का दायरा — इतने आगे का रुझान ईमानदारी से नहीं बताया जा सकता`
    );
  }
  return {
    result: faydaScenarios({ ...input, deductionPerQt, prices }),
    reference: { market: best.m.marketName, deductionPerQt, source, confidence },
  };
}
