import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "../prisma";
import { analyseLot, marketBoard } from "../decision";
import { buyerMatchesForLot, matchForBuyer } from "../match";
import { storageAlerts } from "../marketplace";
import { COMMODITIES } from "../engine/config";
import { inr, pct, qt } from "../format";

// Compact, factual snapshots of platform data used to ground every AI answer.

export async function marketSnapshot(commodities: readonly string[] = COMMODITIES): Promise<string> {
  const lines: string[] = [];
  for (const c of commodities) {
    const rows = await marketBoard(c);
    if (rows.length === 0) continue;
    lines.push(`${c} (DEMO/SAMPLE prices, ₹/qt modal):`);
    for (const r of rows) {
      lines.push(
        `  - ${r.marketName} (${r.district}): ${inr(r.modal)}, 7d ${pct(r.change7d)}, 30d ${pct(r.change30d)}, arrivals ${Math.round(r.arrivalsQt)} qt, data ${r.freshnessDays}d old${r.forecast7d ? `, 7-day trend projection ${inr(r.forecast7d.value)} (${r.trendConfidence?.toLowerCase()} confidence)` : ""}`
      );
    }
  }
  return lines.join("\n");
}

export async function lotBrief(lotId: string): Promise<string> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: { offers: { where: { status: { in: ["PENDING", "COUNTERED"] } }, include: { buyer: true } }, media: true },
  });
  if (!lot) return "";
  const lines = [
    `Lot ${lot.id}: ${lot.commodity}, ${qt(lot.availableQt)} available of ${qt(lot.quantityQt)}, grade ${lot.qualityGrade} (${lot.qualityParams ? "measured" : "self-declared"}), district ${lot.district}, status ${lot.status}${lot.isPool ? ", FPO pooled lot" : ""}.`,
  ];
  if (lot.qualityParams && !lot.isPool) lines.push(`  Quality measurements: ${lot.qualityParams}`);
  for (const m of lot.media) if (m.aiAssessment) lines.push(`  AI photo assessment: ${m.aiAssessment}`);
  const a = await analyseLot(lot.id);
  if (a) {
    lines.push(`  SmartSell recommendation: ${a.recommendation}`);
    lines.push("  Selling options ranked by net realisation:");
    for (const o of a.options.slice(0, 6)) {
      lines.push(
        `    - ${o.kind === "MANDI" ? "Mandi" : "Buyer offer"} ${o.label}: price ${inr(o.pricePerQt)}/qt, ${o.distanceKm !== null ? `${o.distanceKm} km, transport ${inr(o.transport?.total ?? 0)}, charges ${inr(o.charges)}` : "farm-gate"}, NET ${inr(o.netPerQt)}/qt (${inr(o.netTotal)} total), ${o.confidence} confidence`
      );
    }
    if (a.storage) lines.push(`  Sell-vs-store: ${a.storage.verdict}. ${a.storage.reason}`);
  }
  for (const o of lot.offers) {
    lines.push(
      `  Open offer ${o.id} from ${o.buyer.name} (${o.buyer.verified ? "verified" : "NOT verified"}, ${o.buyer.district}): ${inr(o.pricePerQt)}/qt × ${qt(o.quantityQt)}, status ${o.status}${o.counterPricePerQt ? `, farmer countered at ${inr(o.counterPricePerQt)}` : ""}, expires ${o.expiresAt.toISOString()}`
    );
  }
  return lines.join("\n");
}

export async function userContext(user: User): Promise<string> {
  const header = `User: ${user.name}, role ${user.role}, district ${user.district}, ${user.state}${user.landAcres ? `, ${user.landAcres} acres` : ""}${user.verified ? ", verified" : ", not verified"}.`;
  const parts = [header];

  if (user.role === "FARMER" || user.role === "FPO") {
    const lots = await prisma.lot.findMany({
      where: { farmerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
    const open = lots.filter((l) => l.status === "OPEN" || l.status === "PARTIALLY_SOLD");
    for (const l of open.slice(0, 4)) parts.push(await lotBrief(l.id));
    const closed = lots.filter((l) => !open.includes(l));
    if (closed.length) parts.push(`Other lots: ${closed.map((l) => `${l.commodity} ${qt(l.quantityQt)} ${l.status}`).join("; ")}`);
    const orders = await prisma.order.findMany({ where: { farmerId: user.id }, include: { lot: true, buyer: true }, take: 6, orderBy: { updatedAt: "desc" } });
    if (orders.length) parts.push(`Orders: ${orders.map((o) => `${o.lot.commodity} ${qt(o.quantityQt)} to ${o.buyer.name} at ${inr(o.agreedPrice)}/qt, status ${o.status}`).join("; ")}`);
    if (user.role === "FARMER") {
      const alerts = await storageAlerts(user.id);
      if (alerts.length) parts.push(`Field Nigrani sensor alerts: ${alerts.join(" ")}`);
    }
    if (user.role === "FPO") {
      const members = await prisma.user.findMany({ where: { fpoId: user.id }, include: { lots: { where: { status: "OPEN" } } } });
      parts.push(`FPO members: ${members.map((m) => `${m.name} (${m.lots.map((l) => `${l.commodity} ${qt(l.availableQt)}`).join(", ") || "no open lots"})`).join("; ")}`);
    }
  } else if (user.role === "BUYER") {
    const [demands, lots, orders] = await Promise.all([
      prisma.buyerDemand.findMany({ where: { buyerId: user.id } }),
      prisma.lot.findMany({ where: { status: { in: ["OPEN", "PARTIALLY_SOLD"] } }, include: { farmer: true }, take: 20 }),
      prisma.order.findMany({ where: { buyerId: user.id }, include: { lot: true, farmer: true }, take: 6, orderBy: { updatedAt: "desc" } }),
    ]);
    parts.push(`Buyer demand: ${demands.map((d) => `${d.commodity} ${qt(d.quantityQt)} grade ${d.qualityMin}+ at ~${inr(d.pricePerQt)}/qt`).join("; ") || "none posted"}`);
    const scored = await Promise.all(lots.map(async (l) => ({ l, v: await matchForBuyer(l, user) })));
    parts.push("Lots on the market:");
    for (const { l, v } of scored) {
      parts.push(`  - ${l.commodity} ${qt(l.availableQt)} grade ${l.qualityGrade} (${l.qualityParams ? "measured" : "self-declared"}) from ${l.farmer.name}, ${l.district}, ~${v.distanceKm} km${v.hasDemand ? `, match ${v.score}/100` : ""}`);
    }
    if (orders.length) parts.push(`Orders: ${orders.map((o) => `${o.lot.commodity} ${qt(o.quantityQt)} from ${o.farmer.name}, status ${o.status}`).join("; ")}`);
  } else {
    const [grievances, orders, lots] = await Promise.all([
      prisma.grievance.findMany({ where: { status: "OPEN" }, include: { order: { include: { lot: true } } } }),
      prisma.order.count(),
      prisma.lot.count({ where: { status: { in: ["OPEN", "PARTIALLY_SOLD"] } } }),
    ]);
    parts.push(`Platform: ${lots} lots on market, ${orders} orders. Open grievances: ${grievances.map((g) => `${g.category} on ${g.order.lot.commodity} order — ${g.description}`).join("; ") || "none"}`);
  }
  return parts.join("\n");
}

export async function buyerMatchesBrief(lot: { commodity: string; availableQt: number; qualityGrade: string; district: string }) {
  const matches = await buyerMatchesForLot(lot);
  return matches
    .slice(0, 5)
    .map((m) => `${m.buyerName} (${m.district}, ${m.buyerVerified ? "verified" : "unverified"}): wants ${qt(m.quantityWantedQt)} grade ${m.qualityMin}+ at ~${inr(m.pricePerQt)}/qt, match ${m.score}/100`)
    .join("\n");
}
