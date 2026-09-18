import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { ACTIVE_OFFER_STATUSES } from "./engine/states";
import { COMFORT_BANDS, IOT_METRICS, type IotMetric } from "./engine/config";
import { makeT, type UiLang } from "./i18n";

// Offers expire server-side; run before reading or acting on offers.
export async function expireStaleOffers(now: Date = new Date()) {
  const stale = await prisma.offer.findMany({
    where: { status: { in: ACTIVE_OFFER_STATUSES }, expiresAt: { lte: now } },
    select: { id: true, lotId: true },
  });
  if (stale.length === 0) return 0;
  await prisma.$transaction([
    prisma.offer.updateMany({
      where: { id: { in: stale.map((s) => s.id) }, status: { in: ACTIVE_OFFER_STATUSES } },
      data: { status: "EXPIRED" },
    }),
    ...stale.map((s) =>
      prisma.auditEvent.create({ data: { action: "OFFER_EXPIRED", detail: "Offer expired without a response", lotId: s.lotId, offerId: s.id } })
    ),
  ]);
  return stale.length;
}

export type PoolShare = {
  farmerId: string;
  farmerName: string;
  memberLotId: string;
  quantityQt: number;
  sharePct: number;
  settled: number;
  pending: number;
};

// Pro-rata split of pooled-lot sales by contributed quantity.
export async function poolPayouts(poolLotId: string): Promise<{ shares: PoolShare[]; settledTotal: number; pendingTotal: number }> {
  const [parts, orders] = await Promise.all([
    prisma.poolContribution.findMany({ where: { poolLotId }, include: { farmer: true } }),
    prisma.order.findMany({ where: { lotId: poolLotId } }),
  ]);
  const totalQt = parts.reduce((s, p) => s + p.quantityQt, 0);
  const value = (o: { agreedPrice: number; quantityQt: number }) => o.agreedPrice * o.quantityQt;
  const settledTotal = orders.filter((o) => o.status === "PAID" || o.status === "CLOSED").reduce((s, o) => s + value(o), 0);
  const pendingTotal = orders.filter((o) => o.status !== "PAID" && o.status !== "CLOSED").reduce((s, o) => s + value(o), 0);
  const shares = parts.map((p) => {
    const share = totalQt > 0 ? p.quantityQt / totalQt : 0;
    return {
      farmerId: p.farmerId,
      farmerName: p.farmer.name,
      memberLotId: p.memberLotId,
      quantityQt: p.quantityQt,
      sharePct: share * 100,
      settled: share * settledTotal,
      pending: share * pendingTotal,
    };
  });
  return { shares, settledTotal, pendingTotal };
}

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export type MetricSummary = {
  metric: IotMetric;
  label: string;
  unit: string;
  latest: number;
  latestAt: Date;
  series: number[];
  band: [number, number] | null;
  status: "OK" | "LOW" | "HIGH" | "NO_BAND";
};

export async function deviceSummaries(farmerId: string) {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const devices = await prisma.device.findMany({
    where: { farmerId },
    include: { readings: { where: { recordedAt: { gte: since } }, orderBy: { recordedAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return devices.map((d) => {
    const purpose = d.purpose === "STORAGE" ? "STORAGE" : "FIELD";
    const metrics: MetricSummary[] = [];
    for (const metric of Object.keys(IOT_METRICS) as IotMetric[]) {
      const rows = d.readings.filter((r) => r.metric === metric);
      if (rows.length === 0) continue;
      const last = rows[rows.length - 1];
      const band = COMFORT_BANDS[purpose][metric] ?? null;
      const status = !band ? "NO_BAND" : last.value < band[0] ? "LOW" : last.value > band[1] ? "HIGH" : "OK";
      metrics.push({
        metric,
        label: IOT_METRICS[metric].label,
        unit: IOT_METRICS[metric].unit,
        latest: last.value,
        latestAt: last.recordedAt,
        series: rows.map((r) => r.value),
        band,
        status,
      });
    }
    return { id: d.id, name: d.name, purpose, keyHint: d.keyHint, createdAt: d.createdAt, metrics };
  });
}

// Out-of-band storage readings are surfaced as context on the selling decision.
export async function storageAlerts(farmerId: string, lang: UiLang = "en"): Promise<string[]> {
  const t = makeT(lang);
  const devices = await deviceSummaries(farmerId);
  return devices
    .filter((d) => d.purpose === "STORAGE")
    .flatMap((d) =>
      d.metrics
        .filter((m) => m.status === "HIGH" || m.status === "LOW")
        .map((m) => {
          const label = { temperature_c: "तापमान", humidity_pct: "नमी", soil_moisture_pct: "मिट्टी की नमी" }[m.metric];
          return t(
            `${d.name}: ${m.label.toLowerCase()} ${m.latest.toFixed(1)}${m.unit} is ${m.status === "HIGH" ? "above" : "below"} the ${m.band![0]}–${m.band![1]}${m.unit} comfort band — stored produce may deteriorate faster than modelled.`,
            `${d.name}: ${label} ${m.latest.toFixed(1)}${m.unit} सुरक्षित सीमा ${m.band![0]}–${m.band![1]}${m.unit} से ${m.status === "HIGH" ? "ज़्यादा" : "कम"} है — रखा हुआ माल अनुमान से जल्दी खराब हो सकता है।`
          );
        })
    );
}

export async function sourceRegistry() {
  const groups = await prisma.priceRecord.groupBy({
    by: ["source"],
    _count: { _all: true },
    _max: { date: true },
  });
  const now = Date.now();
  return groups.map((g) => {
    const latest = g._max.date;
    const ageDays = latest ? Math.floor((now - latest.getTime()) / (24 * 60 * 60 * 1000)) : null;
    return {
      source: g.source,
      records: g._count._all,
      latest,
      status: ageDays === null ? "UNAVAILABLE" : ageDays <= 2 ? "FRESH" : "STALE",
      mode: g.source.startsWith("CSV_IMPORT") ? "IMPORT" : "MOCK",
    };
  });
}
