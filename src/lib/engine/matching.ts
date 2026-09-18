import { QUALITY_RANK } from "./config";
import { type Point, roadDistanceKm } from "./logistics";
import { inr } from "../format";
import { makeT, type UiLang } from "../i18n";

export type MatchLot = { quantityQt: number; qualityGrade: string; point: Point };
export type MatchDemand = {
  quantityQt: number;
  qualityMin: string;
  pricePerQt: number;
  point: Point;
  buyerVerified: boolean;
};

export type MatchResult = { score: number; reasons: string[]; qualityOk: boolean; distanceKm: number };

const W = { distance: 30, quantity: 25, quality: 20, price: 15, verified: 10 };
const DISTANCE_ZERO_KM = 300;
const PRICE_ZERO_GAP = 0.15;

export function scoreMatch(lot: MatchLot, demand: MatchDemand, bestMandiNetPerQt: number | null, lang: UiLang = "en"): MatchResult {
  const t = makeT(lang);
  const reasons: string[] = [];
  const distanceKm = roadDistanceKm(lot.point, demand.point);

  const distanceScore = W.distance * Math.max(0, 1 - distanceKm / DISTANCE_ZERO_KM);
  reasons.push(t(`~${distanceKm} km between lot and buyer.`, `लॉट और खरीदार के बीच ~${distanceKm} किमी।`));

  const overlap = Math.min(lot.quantityQt, demand.quantityQt) / Math.max(lot.quantityQt, demand.quantityQt);
  const quantityScore = W.quantity * overlap;
  const fit = Math.round(overlap * 100);
  reasons.push(
    t(
      `Buyer wants ${demand.quantityQt} qt, lot has ${lot.quantityQt} qt available (${fit}% fit).`,
      `खरीदार को ${demand.quantityQt} क्विंटल चाहिए, लॉट में ${lot.quantityQt} क्विंटल है (${fit}% मेल)।`
    )
  );

  const qualityOk = (QUALITY_RANK[lot.qualityGrade] ?? 0) >= (QUALITY_RANK[demand.qualityMin] ?? 0);
  const qualityScore = qualityOk ? W.quality : 0;
  reasons.push(
    qualityOk
      ? t(`Grade ${lot.qualityGrade} meets the buyer's minimum (${demand.qualityMin}).`, `ग्रेड ${lot.qualityGrade} खरीदार की न्यूनतम माँग (${demand.qualityMin}) पूरी करता है।`)
      : t(`Grade ${lot.qualityGrade} is BELOW the buyer's minimum (${demand.qualityMin}).`, `ग्रेड ${lot.qualityGrade} खरीदार की न्यूनतम माँग (${demand.qualityMin}) से कम है।`)
  );

  let priceScore = W.price / 2;
  if (bestMandiNetPerQt !== null && bestMandiNetPerQt > 0) {
    const gap = (bestMandiNetPerQt - demand.pricePerQt) / bestMandiNetPerQt;
    priceScore = gap <= 0 ? W.price : W.price * Math.max(0, 1 - gap / PRICE_ZERO_GAP);
    const diff = demand.pricePerQt - bestMandiNetPerQt;
    reasons.push(
      t(
        `Indicative price ${inr(demand.pricePerQt)}/qt is ${inr(Math.abs(diff))} ${diff >= 0 ? "above" : "below"} your best mandi net (${inr(bestMandiNetPerQt)}/qt).`,
        `संकेतित भाव ${inr(demand.pricePerQt)}/क्विंटल, आपकी सबसे अच्छी मंडी शुद्ध आय (${inr(bestMandiNetPerQt)}/क्विंटल) से ${inr(Math.abs(diff))} ${diff >= 0 ? "ज़्यादा" : "कम"} है।`
      )
    );
  }

  const verifiedScore = demand.buyerVerified ? W.verified : 0;
  reasons.push(demand.buyerVerified ? t("Buyer is verified.", "खरीदार सत्यापित है।") : t("Buyer is not verified yet.", "खरीदार अभी सत्यापित नहीं है।"));

  const score = Math.round(distanceScore + quantityScore + qualityScore + priceScore + verifiedScore);
  return { score, reasons, qualityOk, distanceKm };
}
