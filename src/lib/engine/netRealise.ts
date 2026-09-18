import {
  MARKET_CHARGES_PCT,
  SHRINKAGE_PER_DAY,
  STORAGE_HANDLING_PER_QT,
  STORAGE_HORIZONS_DAYS,
  STORAGE_MIN_GAIN_PCT,
} from "./config";
import { type Confidence, type TrendFit, predict } from "./forecast";
import { type Point, type TransportQuote, quoteTransport, roadDistanceKm } from "./logistics";
import { inr } from "../format";
import { commodityName, makeT, type UiLang } from "../i18n";

const DAY_MS = 24 * 60 * 60 * 1000;

export type LotInput = { commodity: string; quantityQt: number; district: string; point: Point };

export type MandiInput = {
  marketId: string;
  marketName: string;
  district: string;
  point: Point;
  latest: { date: Date; modal: number; min: number; max: number; arrivalsQt: number };
  recentModals: number[];
  trend: TrendFit | null;
};

export type DirectOfferInput = {
  offerId: string;
  buyerName: string;
  buyerDistrict: string;
  buyerVerified: boolean;
  pricePerQt: number;
  counterPricePerQt: number | null;
  quantityQt: number;
  status: string;
};

export type SellOption = {
  kind: "MANDI" | "DIRECT_OFFER";
  id: string;
  label: string;
  district: string;
  quantityQt: number;
  pricePerQt: number;
  distanceKm: number | null;
  transport: TransportQuote | null;
  charges: number;
  grossValue: number;
  netTotal: number;
  netPerQt: number;
  confidence: Confidence;
  freshnessDays: number | null;
  reasons: string[];
  offerStatus?: string;
};

const DOWNGRADE: Record<Confidence, Confidence> = { HIGH: "MEDIUM", MEDIUM: "LOW", LOW: "LOW" };

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function mandiOption(lot: LotInput, m: MandiInput, now: Date, lang: UiLang = "en"): SellOption {
  const t = makeT(lang);
  const distanceKm = roadDistanceKm(lot.point, m.point);
  const transport = quoteTransport(lot.quantityQt, distanceKm);
  const grossValue = m.latest.modal * lot.quantityQt;
  const charges = grossValue * MARKET_CHARGES_PCT;
  const netTotal = grossValue - transport.total - charges;
  const freshnessDays = Math.max(0, Math.floor((now.getTime() - m.latest.date.getTime()) / DAY_MS));

  let confidence: Confidence =
    freshnessDays <= 1 && m.latest.arrivalsQt >= 100
      ? "HIGH"
      : freshnessDays <= 3 && m.latest.arrivalsQt >= 30
        ? "MEDIUM"
        : "LOW";
  const cv = coefficientOfVariation(m.recentModals);
  const volatile = cv > 0.08;
  if (volatile) confidence = DOWNGRADE[confidence];

  const arrivals = Math.round(m.latest.arrivalsQt);
  const reasons = [
    t(
      `Latest modal price ${inr(m.latest.modal)}/qt (range ${inr(m.latest.min)}–${inr(m.latest.max)}), ${freshnessDays === 0 ? "reported today" : `${freshnessDays} day(s) old`}, ${arrivals} qt arrivals.`,
      `ताज़ा मॉडल भाव ${inr(m.latest.modal)}/क्विंटल (दायरा ${inr(m.latest.min)}–${inr(m.latest.max)}), ${freshnessDays === 0 ? "आज का भाव" : `${freshnessDays} दिन पुराना`}, आवक ${arrivals} क्विंटल।`
    ),
    t(
      `Transport ≈ ${distanceKm} km by ${transport.trips} × ${transport.vehicle}: freight ${inr(transport.freight)} + loading ${inr(transport.loading)}.`,
      `ढुलाई ≈ ${distanceKm} किमी, ${transport.trips} × ${transport.vehicle}: भाड़ा ${inr(transport.freight)} + लदाई ${inr(transport.loading)}।`
    ),
    t(
      `Market charges ${(MARKET_CHARGES_PCT * 100).toFixed(0)}% of gross (${inr(charges)}).`,
      `मंडी शुल्क कुल बिक्री का ${(MARKET_CHARGES_PCT * 100).toFixed(0)}% (${inr(charges)})।`
    ),
  ];
  if (volatile) {
    reasons.push(
      t(
        `Prices swung ${(cv * 100).toFixed(1)}% over the last week — confidence lowered.`,
        `पिछले हफ्ते भाव ${(cv * 100).toFixed(1)}% ऊपर-नीचे हुए — भरोसा कम किया गया।`
      )
    );
  }

  return {
    kind: "MANDI",
    id: m.marketId,
    label: m.marketName,
    district: m.district,
    quantityQt: lot.quantityQt,
    pricePerQt: m.latest.modal,
    distanceKm,
    transport,
    charges,
    grossValue,
    netTotal,
    netPerQt: netTotal / lot.quantityQt,
    confidence,
    freshnessDays,
    reasons,
  };
}

export function directOfferOption(o: DirectOfferInput, lang: UiLang = "en"): SellOption {
  const t = makeT(lang);
  const grossValue = o.pricePerQt * o.quantityQt;
  const reasons = [
    t(
      "Farm-gate offer: buyer arranges and pays for pickup, no market charges.",
      "खेत पर सौदा: खरीदार खुद गाड़ी भेजेगा और भाड़ा देगा, कोई मंडी शुल्क नहीं।"
    ),
    o.buyerVerified
      ? t("Buyer identity is verified.", "खरीदार सत्यापित है।")
      : t("Buyer is NOT verified yet — higher counterparty risk.", "खरीदार अभी सत्यापित नहीं है — जोखिम ज़्यादा।"),
  ];
  if (o.status === "COUNTERED" && o.counterPricePerQt) {
    reasons.push(
      t(
        `You countered at ${inr(o.counterPricePerQt)}/qt — awaiting buyer response.`,
        `आपने ${inr(o.counterPricePerQt)}/क्विंटल का जवाबी भाव दिया — खरीदार के जवाब का इंतज़ार।`
      )
    );
  }
  return {
    kind: "DIRECT_OFFER",
    id: o.offerId,
    label: o.buyerName,
    district: o.buyerDistrict,
    quantityQt: o.quantityQt,
    pricePerQt: o.pricePerQt,
    distanceKm: null,
    transport: null,
    charges: 0,
    grossValue,
    netTotal: grossValue,
    netPerQt: o.pricePerQt,
    confidence: o.buyerVerified ? "HIGH" : "MEDIUM",
    freshnessDays: null,
    reasons,
    offerStatus: o.status,
  };
}

export function rankOptions(options: SellOption[]): SellOption[] {
  return [...options].sort((a, b) => b.netPerQt - a.netPerQt);
}

export type FacilityInput = {
  name: string;
  district: string;
  point: Point;
  costPerQtPerDay: number;
};

export type StoreScenario = {
  days: number;
  marketName: string;
  forecastPrice: number;
  forecastLow: number;
  forecastHigh: number;
  effectiveQt: number;
  storageCost: number;
  transportTotal: number;
  charges: number;
  netTotal: number;
  trendConfidence: Confidence;
};

export type SellVsStore = {
  facility: (FacilityInput & { distanceKm: number }) | null;
  sellNowNet: number;
  scenarios: StoreScenario[];
  verdict: "SELL_NOW" | "STORE";
  best: StoreScenario | null;
  reason: string;
};

export function sellVsStore(
  lot: LotInput,
  mandis: MandiInput[],
  bestSellNow: SellOption,
  facility: FacilityInput | null,
  lang: UiLang = "en"
): SellVsStore {
  const t = makeT(lang);
  if (!facility) {
    return {
      facility: null,
      sellNowNet: bestSellNow.netTotal,
      scenarios: [],
      verdict: "SELL_NOW",
      best: null,
      reason: t(
        `No storage facility with free capacity accepts ${lot.commodity} near you.`,
        `आपके पास ${commodityName(lot.commodity, lang)} रखने लायक खाली गोदाम नहीं है।`
      ),
    };
  }

  const facilityDistance = roadDistanceKm(lot.point, facility.point);
  const shrinkRate = SHRINKAGE_PER_DAY[lot.commodity] ?? 0;
  const scenarios: StoreScenario[] = [];

  for (const days of STORAGE_HORIZONS_DAYS) {
    let bestForHorizon: StoreScenario | null = null;
    for (const m of mandis) {
      if (!m.trend) continue;
      const f = predict(m.trend, days);
      const effectiveQt = lot.quantityQt * (1 - shrinkRate * days);
      const inbound = quoteTransport(lot.quantityQt, facilityDistance);
      const outbound = quoteTransport(effectiveQt, roadDistanceKm(facility.point, m.point));
      const gross = f.value * effectiveQt;
      const charges = gross * MARKET_CHARGES_PCT;
      const storageCost = lot.quantityQt * days * facility.costPerQtPerDay + STORAGE_HANDLING_PER_QT * lot.quantityQt;
      const transportTotal = inbound.total + outbound.total;
      const netTotal = gross - charges - storageCost - transportTotal;
      if (!bestForHorizon || netTotal > bestForHorizon.netTotal) {
        bestForHorizon = {
          days,
          marketName: m.marketName,
          forecastPrice: f.value,
          forecastLow: f.low,
          forecastHigh: f.high,
          effectiveQt,
          storageCost,
          transportTotal,
          charges,
          netTotal,
          trendConfidence: m.trend.confidence,
        };
      }
    }
    if (bestForHorizon) scenarios.push(bestForHorizon);
  }

  const best = scenarios.reduce<StoreScenario | null>((b, s) => (!b || s.netTotal > b.netTotal ? s : b), null);
  const threshold = bestSellNow.netTotal * (1 + STORAGE_MIN_GAIN_PCT);
  const storeWins = best !== null && best.netTotal > threshold && best.trendConfidence !== "LOW";

  let reason: string;
  if (!best) {
    reason = t("Not enough price history to project a storage outcome.", "भंडारण का अनुमान लगाने के लिए भाव का पर्याप्त इतिहास नहीं है।");
  } else if (storeWins) {
    const gain = inr(best.netTotal - bestSellNow.netTotal);
    reason = t(
      `Storing ${best.days} days at ${facility.name} and selling at ${best.marketName} is projected to net ${gain} more, after storage, shrinkage and double handling. Projection band: ${inr(best.forecastLow)}–${inr(best.forecastHigh)}/qt.`,
      `${facility.name} में ${best.days} दिन रखकर ${best.marketName} में बेचने से भंडारण, सूखत और दोहरी ढुलाई के बाद अनुमानित ${gain} ज़्यादा मिलेंगे। अनुमान दायरा: ${inr(best.forecastLow)}–${inr(best.forecastHigh)}/क्विंटल।`
    );
  } else if (best.netTotal > threshold) {
    const gain = inr(best.netTotal - bestSellNow.netTotal);
    reason = t(
      `Storage looks better on paper (+${gain}), but the price trend is too noisy (LOW confidence) to act on.`,
      `कागज़ पर भंडारण बेहतर लगता है (+${gain}), लेकिन भाव का रुझान बहुत अस्थिर है (कम भरोसा)।`
    );
  } else {
    const pct = (STORAGE_MIN_GAIN_PCT * 100).toFixed(0);
    reason = t(
      `Best storage scenario (${best.days} days → ${best.marketName}) nets ${inr(best.netTotal)}, which does not beat selling now by the required ${pct}% margin.`,
      `सबसे अच्छा भंडारण विकल्प (${best.days} दिन → ${best.marketName}) ${inr(best.netTotal)} देता है, जो अभी बेचने से ज़रूरी ${pct}% ज़्यादा नहीं है।`
    );
  }

  return {
    facility: { ...facility, distanceKm: facilityDistance },
    sellNowNet: bestSellNow.netTotal,
    scenarios,
    verdict: storeWins ? "STORE" : "SELL_NOW",
    best,
    reason,
  };
}
