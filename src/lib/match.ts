import { prisma } from "./prisma";
import { bestMandiNetPerQt, lotInputFor } from "./decision";
import { districtPoint, roadDistanceKm } from "./engine/logistics";
import { scoreMatch, type MatchResult } from "./engine/matching";
import { commodityName, makeT, type UiLang } from "./i18n";

type LotLike = { commodity: string; availableQt: number; qualityGrade: string; district: string };

export type BuyerMatch = MatchResult & {
  demandId: string;
  buyerId: string;
  buyerName: string;
  buyerVerified: boolean;
  district: string;
  quantityWantedQt: number;
  pricePerQt: number;
  qualityMin: string;
  deliveryDays: number;
};

export async function buyerMatchesForLot(lot: LotLike, lang: UiLang = "en"): Promise<BuyerMatch[]> {
  if (lot.availableQt <= 0) return [];
  const lotInput = lotInputFor(lot);
  const [demands, bestNet] = await Promise.all([
    prisma.buyerDemand.findMany({ where: { commodity: lot.commodity }, include: { buyer: true } }),
    bestMandiNetPerQt(lotInput),
  ]);

  return demands
    .map((d) => ({
      demandId: d.id,
      buyerId: d.buyerId,
      buyerName: d.buyer.name,
      buyerVerified: d.buyer.verified,
      district: d.district,
      quantityWantedQt: d.quantityQt,
      pricePerQt: d.pricePerQt,
      qualityMin: d.qualityMin,
      deliveryDays: d.deliveryDays,
      ...scoreMatch(
        { quantityQt: lot.availableQt, qualityGrade: lot.qualityGrade, point: lotInput.point },
        {
          quantityQt: d.quantityQt,
          qualityMin: d.qualityMin,
          pricePerQt: d.pricePerQt,
          point: districtPoint(d.district),
          buyerVerified: d.buyer.verified,
        },
        bestNet,
        lang
      ),
    }))
    .sort((a, b) => b.score - a.score);
}

export type BuyerView =
  | ({ hasDemand: true } & MatchResult)
  | { hasDemand: false; distanceKm: number; reasons: string[] };

// A lot seen from one buyer's side: scored against their best-fitting demand, or unscored
// (distance only) when they have posted no demand for that commodity.
export async function matchForBuyer(lot: LotLike, buyer: { id: string; district: string }, lang: UiLang = "en"): Promise<BuyerView> {
  const matches = await buyerMatchesForLot(lot, lang);
  const mine = matches.find((m) => m.buyerId === buyer.id);
  if (mine) return { hasDemand: true, score: mine.score, reasons: mine.reasons, qualityOk: mine.qualityOk, distanceKm: mine.distanceKm };

  const distanceKm = roadDistanceKm(districtPoint(lot.district), districtPoint(buyer.district));
  return {
    hasDemand: false,
    distanceKm,
    reasons: [
      makeT(lang)(
        `~${distanceKm} km away. Post a ${lot.commodity} demand to get a match score.`,
        `~${distanceKm} किमी दूर। मैच स्कोर के लिए ${commodityName(lot.commodity, lang)} की माँग दर्ज करें।`
      ),
    ],
  };
}
