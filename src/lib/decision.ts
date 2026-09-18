import { cache } from "react";
import { prisma } from "./prisma";
import { inr, possessive, qt } from "./format";
import { makeT, type UiLang } from "./i18n";
import { fitTrend, pctChange, predict, type PricePoint } from "./engine/forecast";
import { districtPoint, roadDistanceKm } from "./engine/logistics";
import {
  type LotInput,
  type MandiInput,
  type SellOption,
  type SellVsStore,
  directOfferOption,
  mandiOption,
  rankOptions,
  sellVsStore,
} from "./engine/netRealise";
import { ACTIVE_OFFER_STATUSES } from "./engine/states";

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 30;

type MarketSeries = MandiInput & { series: PricePoint[] };

// Cached per request so pages that analyse several lots query each commodity once.
export const loadMarketSeries = cache(async (commodity: string): Promise<MarketSeries[]> => {
  const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
  const [markets, records] = await Promise.all([
    prisma.market.findMany({ orderBy: { name: "asc" } }),
    prisma.priceRecord.findMany({
      where: { commodity, date: { gte: since } },
      orderBy: { date: "asc" },
    }),
  ]);

  const byMarket = new Map<string, typeof records>();
  for (const r of records) {
    const list = byMarket.get(r.marketId) ?? [];
    list.push(r);
    byMarket.set(r.marketId, list);
  }

  const result: MarketSeries[] = [];
  for (const m of markets) {
    const rows = byMarket.get(m.id);
    if (!rows || rows.length === 0) continue;
    const latest = rows[rows.length - 1];
    const series = rows.map((r) => ({ date: r.date, price: r.modalPrice }));
    result.push({
      marketId: m.id,
      marketName: m.name,
      district: m.district,
      point: { lat: m.lat, lng: m.lng },
      latest: {
        date: latest.date,
        modal: latest.modalPrice,
        min: latest.minPrice,
        max: latest.maxPrice,
        arrivalsQt: latest.arrivalsQt,
      },
      recentModals: rows.slice(-7).map((r) => r.modalPrice),
      trend: fitTrend(series),
      series,
    });
  }
  return result;
});

export async function loadModalHistory(marketId: string, commodity: string, days: number): Promise<number[]> {
  const rows = await prisma.priceRecord.findMany({
    where: { marketId, commodity, date: { gte: new Date(Date.now() - days * DAY_MS) } },
    select: { modalPrice: true },
  });
  return rows.map((r) => r.modalPrice);
}

export async function bestMandiNetPerQt(lot: LotInput): Promise<number | null> {
  const mandis = await loadMarketSeries(lot.commodity);
  if (mandis.length === 0 || lot.quantityQt <= 0) return null;
  const now = new Date();
  return Math.max(...mandis.map((m) => mandiOption(lot, m, now).netPerQt));
}

export function lotInputFor(lot: { commodity: string; availableQt: number; district: string }): LotInput {
  return {
    commodity: lot.commodity,
    quantityQt: lot.availableQt,
    district: lot.district,
    point: districtPoint(lot.district),
  };
}

export type LotAnalysis = {
  options: SellOption[];
  mandiOptions: SellOption[];
  best: SellOption | null;
  bestMandi: SellOption | null;
  nearestMandi: SellOption | null;
  recommendation: string;
  storage: SellVsStore | null;
};

export async function analyseLot(lotId: string, lang: UiLang = "en"): Promise<LotAnalysis | null> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: {
      offers: { where: { status: { in: ACTIVE_OFFER_STATUSES } }, include: { buyer: true } },
    },
  });
  if (!lot || lot.availableQt <= 0) return null;

  const lotInput = lotInputFor(lot);
  const mandis = await loadMarketSeries(lot.commodity);
  const now = new Date();

  const mandiOptions = rankOptions(mandis.map((m) => mandiOption(lotInput, m, now, lang)));
  const offerOptions = lot.offers.map((o) =>
    directOfferOption(
      {
      offerId: o.id,
      buyerName: o.buyer.name,
      buyerDistrict: o.buyer.district,
      buyerVerified: o.buyer.verified,
      pricePerQt: o.pricePerQt,
      counterPricePerQt: o.counterPricePerQt,
      quantityQt: o.quantityQt,
      status: o.status,
      },
      lang
    )
  );
  const options = rankOptions([...mandiOptions, ...offerOptions]);
  const best = options[0] ?? null;
  const bestMandi = mandiOptions[0] ?? null;
  const nearestMandi =
    mandiOptions.length > 0
      ? mandiOptions.reduce((a, b) => ((a.distanceKm ?? Infinity) <= (b.distanceKm ?? Infinity) ? a : b))
      : null;

  const facilities = await prisma.storageFacility.findMany({
    where: { availableQt: { gte: lot.availableQt } },
  });
  const eligible = facilities
    .filter((f) => f.commodities.split(",").map((c) => c.trim()).includes(lot.commodity))
    .map((f) => ({ ...f, point: { lat: f.lat, lng: f.lng } }))
    .sort((a, b) => roadDistanceKm(lotInput.point, a.point) - roadDistanceKm(lotInput.point, b.point));
  const facility = eligible[0] ?? null;

  const storage = bestMandi ? sellVsStore(lotInput, mandis, bestMandi, facility, lang) : null;

  return {
    options,
    mandiOptions,
    best,
    bestMandi,
    nearestMandi,
    recommendation: recommendationText(best, bestMandi, nearestMandi, mandiOptions, lot.availableQt, lang),
    storage,
  };
}

function recommendationText(
  best: SellOption | null,
  bestMandi: SellOption | null,
  nearest: SellOption | null,
  mandiOptions: SellOption[],
  availableQt: number,
  lang: UiLang
): string {
  const t = makeT(lang);
  if (!best) {
    return t(
      "Not enough market data for this commodity to recommend anything. No estimate is shown rather than a made-up one.",
      "इस फ़सल के लिए पर्याप्त बाज़ार डेटा नहीं है। अंदाज़े से गढ़ा हुआ आँकड़ा दिखाने के बजाय कोई अनुमान नहीं दिखाया गया।"
    );
  }
  if (best.kind === "DIRECT_OFFER") {
    const vsMandi = bestMandi
      ? t(
          ` That is ${inr(best.netPerQt - bestMandi.netPerQt)}/qt more than the best mandi option (${bestMandi.label}, ${inr(bestMandi.netPerQt)}/qt after transport and charges).`,
          ` यह सबसे अच्छी मंडी (${bestMandi.label}, ढुलाई और शुल्क के बाद ${inr(bestMandi.netPerQt)}/क्विंटल) से ${inr(best.netPerQt - bestMandi.netPerQt)}/क्विंटल ज़्यादा है।`
        )
      : "";
    const partial =
      best.quantityQt < availableQt
        ? t(` It covers ${qt(best.quantityQt)} of your ${qt(availableQt)}.`, ` यह आपके ${availableQt} में से ${best.quantityQt} क्विंटल के लिए है।`)
        : "";
    return (
      t(
        `Accept ${possessive(best.label)} offer: ${inr(best.netPerQt)}/qt net at the farm gate.`,
        `${best.label} का ऑफ़र स्वीकार करें: खेत पर ही ${inr(best.netPerQt)}/क्विंटल शुद्ध।`
      ) +
      vsMandi +
      partial
    );
  }
  const second = mandiOptions[1];
  const conf = { HIGH: "उच्च", MEDIUM: "मध्यम", LOW: "कम" }[best.confidence];
  let text = t(
    `Sell at ${best.label}: about ${inr(best.netPerQt)}/qt net (${inr(best.netTotal)} total) after transport and charges — ${best.confidence} confidence.`,
    `${best.label} में बेचें: ढुलाई और शुल्क के बाद लगभग ${inr(best.netPerQt)}/क्विंटल शुद्ध (कुल ${inr(best.netTotal)}) — ${conf} भरोसा।`
  );
  if (second) {
    text += t(
      ` That beats ${second.label} by ${inr(best.netPerQt - second.netPerQt)}/qt.`,
      ` यह ${second.label} से ${inr(best.netPerQt - second.netPerQt)}/क्विंटल बेहतर है।`
    );
  }
  if (nearest && nearest.id !== best.id) {
    text += t(
      ` Your nearest market, ${nearest.label} (${nearest.distanceKm} km), would net ${inr(nearest.netPerQt)}/qt.`,
      ` आपकी सबसे नज़दीकी मंडी ${nearest.label} (${nearest.distanceKm} किमी) में ${inr(nearest.netPerQt)}/क्विंटल शुद्ध मिलेगा।`
    );
  }
  return text;
}

export type MarketBoardRow = {
  marketId: string;
  marketName: string;
  district: string;
  latestDate: Date;
  modal: number;
  min: number;
  max: number;
  arrivalsQt: number;
  change7d: number | null;
  change30d: number | null;
  series: number[];
  forecast7d: { value: number; low: number; high: number } | null;
  trendConfidence: string | null;
  freshnessDays: number;
};

export async function marketBoard(commodity: string): Promise<MarketBoardRow[]> {
  const mandis = await loadMarketSeries(commodity);
  const now = Date.now();
  return mandis
    .map((m) => ({
      marketId: m.marketId,
      marketName: m.marketName,
      district: m.district,
      latestDate: m.latest.date,
      modal: m.latest.modal,
      min: m.latest.min,
      max: m.latest.max,
      arrivalsQt: m.latest.arrivalsQt,
      change7d: pctChange(m.series, 7),
      change30d: pctChange(m.series, 29),
      series: m.series.map((p) => p.price),
      forecast7d: m.trend ? predict(m.trend, 7) : null,
      trendConfidence: m.trend?.confidence ?? null,
      freshnessDays: Math.floor((now - m.latest.date.getTime()) / DAY_MS),
    }))
    .sort((a, b) => b.modal - a.modal);
}
