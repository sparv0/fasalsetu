"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "../prisma";
import { getCurrentUser } from "../session";
import { getLang } from "../lang";
import { localizeMessage } from "../actionMessages";
import { COMMODITIES, QUALITY_GRADES } from "../engine/config";
import { QUALITY_PARAMS } from "../engine/quality";
import { inr, qt } from "../format";
import { AiError, checkAiQuota, generate, generateJson, languageInstruction } from "./gemini";
import { buyerMatchesBrief, lotBrief, marketSnapshot, userContext } from "./context";
import { assessPhoto, type PhotoAssessment } from "./assess";
import { computeFayda, faydaSchema } from "../fayda";
import { bestMandiNetPerQt, loadMarketSeries, lotInputFor } from "../decision";
import { districtPoint, quoteTransport, roadDistanceKm } from "../engine/logistics";
import { MARKET_CHARGES_PCT } from "../engine/config";
import { deviceSummaries } from "../marketplace";
import { suggestSchemes, SCHEME_RULES_VERSION } from "../engine/schemes";

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) => Promise<T>): Promise<AiResult<T>> {
  const lang = await getLang();
  const say = (m: string) => localizeMessage(m, lang);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: say("Your session has ended. Please log in again.") };
  try {
    checkAiQuota(user.id);
    return { ok: true, data: await fn(user) };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, error: say(e.message) };
    console.error("[ai action] unexpected", e);
    return { ok: false, error: say("Something went wrong with the AI request. Please try again.") };
  }
}

const GROUNDING =
  "Use ONLY the platform data provided for prices, distances, offers and numbers — never invent figures. " +
  "All market prices are DEMO/SAMPLE data; do not claim they are live government prices. " +
  "If the data doesn't cover the question, say so plainly.";

// ---------- Kisan Sahayak chat ----------

const chatSchema = z.object({
  conversationId: z.string().optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().trim().min(1).max(1500) }))
    .min(1)
    .max(20),
});

export async function askAssistant(input: { conversationId?: string; messages: { role: "user" | "model"; text: string }[] }): Promise<AiResult<{ text: string; conversationId: string }>> {
  const parsed = chatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: localizeMessage("Message is empty or too long (max 1500 characters).", await getLang()) };
  return guarded(async (user) => {
    const lang = await getLang();
    const [ctx, market] = await Promise.all([userContext(user), marketSnapshot()]);
    const msgs = parsed.data.messages;
    const last = msgs[msgs.length - 1];
    if (last.role !== "user") throw new AiError("Ask a question first.");
    
    const replyText = await generate({
      system:
        "You are Kisan Sahayak, the AI assistant inside FASALSETU AI, a market-linkage app for Indian farmers, FPOs and buyers. " +
        "Help the user decide where and when to sell (or buy), understand net realisation (price minus transport, market charges, storage), negotiate offers, and use the app. " +
        `${GROUNDING} You may also give general, practical post-harvest advice (storage, grading, packing) and say that it is general guidance. ` +
        "Point to the app screen to use (e.g. 'open your Onion lot', 'PricePulse', 'Fayda forecast', 'Schemes'). " +
        "Be concise: at most ~120 words unless asked for detail; use short bullet points for numbers. Do NOT use any markdown formatting like bold (**), italics, or asterisks. Keep the text clean and plain. " +
        languageInstruction(lang) +
        `\n\nToday: ${new Date().toDateString()}.\n\n=== USER & PLATFORM DATA ===\n${ctx}\n\n=== MARKET SNAPSHOT ===\n${market}`,
      history: msgs.slice(0, -1).slice(-10),
      parts: [{ text: last.text }],
      temperature: 0.5,
    });

    let cid = parsed.data.conversationId;
    if (!cid) {
      const conv = await prisma.aiConversation.create({
        data: { userId: user.id, title: `Chat from ${new Date().toLocaleDateString()}` }
      });
      cid = conv.id;
    }

    await prisma.aiMessage.createMany({
      data: [
        { conversationId: cid, role: "user", text: last.text },
        { conversationId: cid, role: "model", text: replyText }
      ]
    });

    return { text: replyText, conversationId: cid };
  });
}

export async function getConversations() {
  const user = await getCurrentUser();
  if (!user) return [];
  return prisma.aiConversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true }
  });
}

export async function getConversationMessages(id: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const conv = await prisma.aiConversation.findUnique({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } }
  });
  if (!conv) return null;
  return conv.messages.map(m => ({ role: m.role as "user" | "model", text: m.text }));
}

// ---------- Explain a lot's recommendation ----------

export async function explainLot(lotId: string): Promise<AiResult<string>> {
  return guarded(async (user) => {
    const lot = await prisma.lot.findUnique({ where: { id: lotId } });
    if (!lot || lot.farmerId !== user.id) throw new AiError("Lot not found.");
    const lang = await getLang();
    const brief = await lotBrief(lot.id);
    return generate({
      system:
        "You explain selling decisions to a farmer with little formal education, as a trusted friend would. " +
        `${GROUNDING} ${languageInstruction(lang)}`,
      parts: [
        {
          text:
            "Explain in 4–5 short sentences: where to sell and why, how much money they will actually keep per quintal and in total, " +
            "why the highest mandi price is not always the best, and one clear next step in the app. No headings, no markdown.\n\n" +
            brief,
        },
      ],
      temperature: 0.3,
    });
  });
}

// ---------- Voice / free-text lot entry ----------

export type ParsedLot = {
  commodity: string | null;
  quantityQt: number | null;
  harvestDate: string | null;
  qualityGrade: string | null;
  measurements: Record<string, number>;
  understood: string;
};

export async function parseLotText(text: string): Promise<AiResult<ParsedLot>> {
  const t = String(text ?? "").trim();
  if (t.length < 3 || t.length > 600) return { ok: false, error: localizeMessage("Describe the lot in 3–600 characters.", await getLang()) };
  return guarded(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const paramKeys = [...new Set(Object.values(QUALITY_PARAMS).flat().map((d) => d.key))];
    const raw = await generateJson<{
      commodity: string;
      quantityQt: number;
      harvestDate: string;
      qualityGrade: string;
      measurements: Record<string, number>;
      understood: string;
    }>({
      system:
        "Extract a produce lot from a farmer's spoken or typed description (English, Hindi, Marathi or Hinglish). " +
        "Commodity synonyms: kanda/pyaaz/कांदा/प्याज = Onion; soyabean/सोयाबीन = Soybean; gehu/gahu/गहू/गेहूं = Wheat. " +
        "Convert quantity to quintals: 1 tonne = 10 qt, 100 kg = 1 qt, 1 bori/bag = 0.5 qt unless a bag weight is given. " +
        `Today is ${today}; resolve relative dates like 'kal' (yesterday), 'parso', 'last week' to YYYY-MM-DD. ` +
        "Use 'UNKNOWN' / 0 / empty string when a field is not mentioned — never guess.",
      parts: [{ text: t }],
      temperature: 0,
      schema: {
        type: "OBJECT",
        properties: {
          commodity: { type: "STRING", enum: [...COMMODITIES, "UNKNOWN"] },
          quantityQt: { type: "NUMBER" },
          harvestDate: { type: "STRING" },
          qualityGrade: { type: "STRING", enum: [...QUALITY_GRADES, "UNKNOWN"] },
          measurements: { type: "OBJECT", properties: Object.fromEntries(paramKeys.map((k) => [k, { type: "NUMBER" }])) },
          understood: { type: "STRING" },
        },
        required: ["commodity", "quantityQt", "harvestDate", "qualityGrade", "understood"],
      },
    });
    const commodity = COMMODITIES.find((c) => c === raw.commodity) ?? null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.harvestDate ?? "") && raw.harvestDate <= today ? raw.harvestDate : null;
    const measurements: Record<string, number> = {};
    if (commodity) {
      for (const d of QUALITY_PARAMS[commodity]) {
        const v = Number(raw.measurements?.[d.key]);
        if (Number.isFinite(v) && v > 0 && v >= d.min && v <= d.max) measurements[d.key] = v;
      }
    }
    return {
      commodity,
      quantityQt: Number.isFinite(raw.quantityQt) && raw.quantityQt > 0 && raw.quantityQt <= 100000 ? Math.round(raw.quantityQt * 10) / 10 : null,
      harvestDate: date,
      qualityGrade: QUALITY_GRADES.find((g) => g === raw.qualityGrade) ?? null,
      measurements,
      understood: String(raw.understood ?? "").slice(0, 300),
    };
  });
}

// ---------- Photo quality grading ----------

export async function analysePhoto(mediaId: string): Promise<AiResult<PhotoAssessment>> {
  return guarded(async (user) => {
    const media = await prisma.lotMedia.findUnique({ where: { id: mediaId }, include: { lot: true } });
    if (!media || media.lot.farmerId !== user.id) throw new AiError("Photo not found.");
    const result = await assessPhoto(mediaId);
    await prisma.auditEvent.create({
      data: {
        action: "AI_PHOTO_GRADED",
        detail: `AI photo check: ${result.matchesLot ? `looks like grade ${result.grade ?? "?"}` : `commodity mismatch (saw ${result.detectedCommodity})`}, ${result.confidence.toLowerCase()} confidence`,
        actorId: user.id,
        lotId: media.lotId,
      },
    });
    revalidatePath(`/farmer/lots/${media.lotId}`);
    return result;
  });
}

// ---------- Negotiation copilot ----------

export type OfferAdvice = { action: "ACCEPT" | "COUNTER" | "REJECT" | "WAIT"; counterPricePerQt: number; reasoning: string; risks: string[] };

export async function adviseOffer(offerId: string): Promise<AiResult<OfferAdvice>> {
  return guarded(async (user) => {
    const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { lot: true, buyer: true } });
    if (!offer || offer.lot.farmerId !== user.id) throw new AiError("Offer not found.");
    const lang = await getLang();
    const [brief, matches] = await Promise.all([lotBrief(offer.lotId), buyerMatchesBrief(offer.lot)]);
    const [buyerOrders, buyerGrievances] = await Promise.all([
      prisma.order.count({ where: { buyerId: offer.buyerId } }),
      prisma.grievance.count({ where: { order: { buyerId: offer.buyerId }, raisedById: { not: offer.buyerId } } }),
    ]);
    const advice = await generateJson<OfferAdvice>({
      system:
        "You are a negotiation advisor for an Indian farmer. Compare the offer with the farmer's best mandi net realisation and other open offers and demand. " +
        "A farm-gate offer is worth price × quantity with no transport or market charges. Recommend ACCEPT, COUNTER (with a realistic counter price the buyer is likely to accept), REJECT, or WAIT. " +
        `${GROUNDING} Write 'reasoning' in 2–3 short sentences and 'risks' as up to 3 short items. ${languageInstruction(lang)}`,
      parts: [
        {
          text:
            `Offer to evaluate: ${offer.id} from ${offer.buyer.name} (${offer.buyer.verified ? "verified" : "NOT verified"}): ${inr(offer.pricePerQt)}/qt for ${qt(offer.quantityQt)} of ${qt(offer.lot.availableQt)} available. ` +
            `Buyer history on platform: ${buyerOrders} orders, ${buyerGrievances} grievances raised against them.\n\n${brief}\n\nOther buyer demand:\n${matches || "none"}`,
        },
      ],
      temperature: 0.2,
      schema: {
        type: "OBJECT",
        properties: {
          action: { type: "STRING", enum: ["ACCEPT", "COUNTER", "REJECT", "WAIT"] },
          counterPricePerQt: { type: "NUMBER" },
          reasoning: { type: "STRING" },
          risks: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["action", "counterPricePerQt", "reasoning", "risks"],
      },
    });
    const counter = advice.action === "COUNTER" && advice.counterPricePerQt > offer.pricePerQt ? Math.round(advice.counterPricePerQt) : 0;
    return {
      action: counter === 0 && advice.action === "COUNTER" ? "WAIT" : advice.action,
      counterPricePerQt: counter,
      reasoning: advice.reasoning,
      risks: (advice.risks ?? []).slice(0, 3),
    };
  });
}

// ---------- Grievance triage (admin) ----------

export type Triage = { severity: "LOW" | "MEDIUM" | "HIGH"; summary: string; likelyCause: string; suggestedResolution: string; evidenceToRequest: string[] };

export async function triageGrievance(grievanceId: string): Promise<AiResult<Triage>> {
  return guarded(async (user) => {
    if (user.role !== "ADMIN") throw new AiError("Only the platform admin can use grievance triage.");
    const g = await prisma.grievance.findUnique({
      where: { id: grievanceId },
      include: { raisedBy: true, order: { include: { lot: { include: { media: true } }, buyer: true, farmer: true, logistics: true, payment: true } } },
    });
    if (!g) throw new AiError("Grievance not found.");
    const events = await prisma.auditEvent.findMany({ where: { orderId: g.orderId }, orderBy: { createdAt: "asc" } });
    const o = g.order;
    return generateJson<Triage>({
      system:
        "You help an agri-marketplace admin triage trade disputes fairly between farmer and buyer. Be neutral and evidence-based. " +
        "Suggest a concrete, proportionate resolution (e.g. price credit % or amount, partial refund, re-inspection) based on the agreement and evidence. " +
        languageInstruction(await getLang()),
      parts: [
        {
          text:
            `Grievance by ${g.raisedBy.name} (${g.raisedBy.id === o.buyerId ? "buyer" : "seller"}): ${g.category} — "${g.description}"\n` +
            `Agreement terms: ${o.agreementTerms}\n` +
            `Logistics: ${o.logistics ? `${o.logistics.vehicle}, ${o.logistics.distanceKm} km, status ${o.logistics.status}` : "not booked"}; Payment: ${o.payment ? `${inr(o.payment.amount)} ${o.payment.status}` : "none"}\n` +
            `Lot quality basis: ${o.lot.qualityParams ? `measured ${o.lot.qualityParams}` : "self-declared"}; photos: ${o.lot.media.length}; AI photo assessments: ${o.lot.media.map((m) => m.aiAssessment).filter(Boolean).join(" | ") || "none"}\n` +
            `Timeline:\n${events.map((e) => `- ${e.createdAt.toISOString()} ${e.action}: ${e.detail}`).join("\n")}`,
        },
      ],
      temperature: 0.2,
      schema: {
        type: "OBJECT",
        properties: {
          severity: { type: "STRING", enum: ["LOW", "MEDIUM", "HIGH"] },
          summary: { type: "STRING" },
          likelyCause: { type: "STRING" },
          suggestedResolution: { type: "STRING" },
          evidenceToRequest: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["severity", "summary", "likelyCause", "suggestedResolution", "evidenceToRequest"],
      },
    });
  });
}

// ---------- Market brief ----------

export async function marketBrief(commodity: string): Promise<AiResult<string>> {
  const c = COMMODITIES.find((x) => x === commodity);
  if (!c) return { ok: false, error: localizeMessage("Unknown commodity.", await getLang()) };
  return guarded(async (user) => {
    const lang = await getLang();
    const snapshot = await marketSnapshot([c]);
    return generate({
      system: `You are a mandi market analyst writing for farmers and traders in ${user.district}, Maharashtra. ${GROUNDING} ${languageInstruction(lang)}`,
      parts: [
        {
          text:
            `Write a ${c} market brief as 4 short bullet points (start each with "• "): overall direction, the strongest and weakest markets, what the arrivals suggest, and a practical tip for someone selling this week. ` +
            `Mention that projections are trend estimates. No headings.\n\n${snapshot}`,
        },
      ],
      temperature: 0.3,
    });
  });
}


// ---------- Fayda explanation ----------

export async function explainFayda(input: unknown): Promise<AiResult<string>> {
  const parsed = faydaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: localizeMessage("Calculate the scenarios first.", await getLang()) };
  return guarded(async (user) => {
    const lang = await getLang();
    const report = await computeFayda(parsed.data, user.district);
    if (!report) throw new AiError("No market data for this crop.");
    const { result, reference } = report;
    return generate({
      system: `You are a farm-business advisor for a small Indian farmer. ${GROUNDING} ${languageInstruction(lang)}`,
      parts: [
        {
          text:
            `Explain these profit scenarios in 4–5 short sentences: expected profit range, the break-even price and how safe the margin is, the biggest risk, and 2 practical ways to improve profit (e.g. grading, timing, FPO pooling, storage) — no headings, no markdown.\n` +
            `Crop ${parsed.data.commodity}, ${parsed.data.areaAcres} acres, yield ${parsed.data.yieldQtPerAcre} qt/acre (farmer's own estimate), cost ${inr(parsed.data.costPerAcre)}/acre, harvest in ${parsed.data.harvestInDays} days.\n` +
            `Expected quantity ${qt(result.quantityQt)}. Break-even ${inr(result.breakevenPricePerQt)}/qt. Price source: ${reference.source}. Selling costs ${inr(reference.deductionPerQt)}/qt via ${reference.market}.\n` +
            result.scenarios.map((sc) => `${sc.label}: price ${inr(sc.price)}/qt, profit ${inr(sc.profit)} (${inr(sc.profitPerAcre)}/acre)`).join("\n"),
        },
      ],
      temperature: 0.3,
    });
  });
}

// ---------- Buyer: fair offer advice ----------

export async function adviseBuy(lotId: string): Promise<AiResult<string>> {
  return guarded(async (user) => {
    if (user.role !== "BUYER") throw new AiError("Only buyers can use offer advice.");
    const lot = await prisma.lot.findUnique({ where: { id: lotId }, include: { farmer: true, media: true } });
    if (!lot || (lot.status !== "OPEN" && lot.status !== "PARTIALLY_SOLD")) throw new AiError("This lot is no longer on the market.");
    const lang = await getLang();
    const demand = await prisma.buyerDemand.findFirst({ where: { buyerId: user.id, commodity: lot.commodity } });
    const qty = Math.min(demand?.quantityQt ?? lot.availableQt, lot.availableQt);
    const sellerFloor = await bestMandiNetPerQt(lotInputFor(lot));
    const buyerPoint = districtPoint(user.district);
    const mandis = await loadMarketSeries(lot.commodity);
    const landed = mandis
      .map((m) => {
        const t = quoteTransport(qty, roadDistanceKm(m.point, buyerPoint));
        return { market: m.marketName, perQt: m.latest.modal * (1 + MARKET_CHARGES_PCT) + t.total / qty };
      })
      .sort((a, b) => a.perQt - b.perQt);
    const pickup = quoteTransport(qty, roadDistanceKm(districtPoint(lot.district), buyerPoint));
    const aiPhotos = lot.media.map((m) => m.aiAssessment).filter(Boolean);
    return generate({
      system:
        "You advise a produce buyer on a fair, winning farm-gate offer. The farmer will compare the offer with what they net at the best mandi (the seller's floor). " +
        "The buyer's alternative is buying at a mandi and paying charges + transport to their location. A good offer sits between the seller's floor and the buyer's cost of the alternative (after adding the buyer's own pickup cost). " +
        `${GROUNDING} Give: a recommended offer ₹/qt, an acceptable range, and 2–3 short reasons. Max 90 words, no markdown headings. ${languageInstruction(lang)}`,
      parts: [
        {
          text:
            `Lot: ${lot.commodity} ${qt(lot.availableQt)} grade ${lot.qualityGrade} (${lot.qualityParams ? `measured ${lot.qualityParams}` : "self-declared"}) from ${lot.farmer.name} (${lot.farmer.verified ? "verified" : "unverified"}), ${lot.district}.\n` +
            `AI photo checks: ${aiPhotos.join(" | ") || "none"}\n` +
            `Buyer: ${user.name}, ${user.district}; wants ${qt(qty)}${demand ? `, grade ${demand.qualityMin}+, budget ~${inr(demand.pricePerQt)}/qt` : ""}.\n` +
            `Seller's floor (best mandi net for this lot): ${sellerFloor ? inr(sellerFloor) : "unknown"}/qt.\n` +
            `Buyer pickup cost from farm: ${inr(pickup.total / qty)}/qt (${pickup.trips} × ${pickup.vehicle}).\n` +
            `Buyer's landed cost buying at mandis instead (price + ${(MARKET_CHARGES_PCT * 100).toFixed(0)}% charges + transport to buyer): ` +
            landed.slice(0, 4).map((l) => `${l.market} ${inr(l.perQt)}/qt`).join(", "),
        },
      ],
      temperature: 0.3,
    });
  });
}

// ---------- Field Nigrani storage advisory ----------

export async function storageAdvice(): Promise<AiResult<string>> {
  return guarded(async (user) => {
    if (user.role !== "FARMER") throw new AiError("Only farmers have sensors.");
    const lang = await getLang();
    const [devices, lots] = await Promise.all([
      deviceSummaries(user.id),
      prisma.lot.findMany({ where: { farmerId: user.id, status: { in: ["OPEN", "PARTIALLY_SOLD"] } }, include: { storageBookings: { where: { status: "ACTIVE" } } } }),
    ]);
    if (devices.every((d) => d.metrics.length === 0)) throw new AiError("No sensor readings in the last 48 hours.");
    const readings = devices
      .map(
        (d) =>
          `${d.name} (${d.purpose}): ` +
          d.metrics
            .map((m) => {
              const first = m.series[0];
              return `${m.label} now ${m.latest.toFixed(1)}${m.unit}, 48h ago ${first.toFixed(1)}${m.unit}, comfort band ${m.band ? `${m.band[0]}–${m.band[1]}${m.unit}` : "none"}, status ${m.status}`;
            })
            .join("; ")
      )
      .join("\n");
    return generate({
      system:
        "You are a post-harvest storage and field advisor for Indian farmers. Use the sensor readings and lots given. " +
        "Give 3–4 short, practical actions (bullets starting with '• ') ordered by urgency, e.g. ventilation, sorting sprouted/rotting bulbs, irrigation timing, or selling stored produce sooner. " +
        `Say which lot is at risk if any. Don't invent readings. ${languageInstruction(lang)}`,
      parts: [
        {
          text:
            `Sensor readings (last 48h):\n${readings}\n\nOpen lots: ${lots.map((l) => `${l.commodity} ${qt(l.availableQt)} grade ${l.qualityGrade}${l.storageBookings.length ? " (partly in storage)" : ""}`).join("; ") || "none"}`,
        },
      ],
      temperature: 0.3,
    });
  });
}

// ---------- Schemes explanation ----------

export async function explainSchemes(): Promise<AiResult<string>> {
  return guarded(async (user) => {
    if (user.role !== "FARMER" && user.role !== "FPO") throw new AiError("Scheme help is for farmers and FPOs.");
    const lang = await getLang();
    const lots = await prisma.lot.findMany({ where: { farmerId: user.id }, select: { commodity: true, quantityQt: true } });
    const suggestions = suggestSchemes({
      role: user.role === "FPO" ? "FPO" : "FARMER",
      state: user.state,
      landAcres: user.landAcres,
      socialCategory: user.socialCategory,
      commodities: [...new Set(lots.map((l) => l.commodity))],
      inFpo: Boolean(user.fpoId),
      largestLotQt: Math.max(0, ...lots.map((l) => l.quantityQt)),
    });
    if (suggestions.length === 0) throw new AiError("Add your land and crops on this page first.");
    return generate({
      system:
        "You help Indian farmers understand government schemes. You are NOT deciding eligibility. " +
        "Explain which 2–3 suggested schemes to look at first and why, what documents are commonly asked for (say they must confirm on the official portal), and where to apply. " +
        `Max 130 words, simple words, bullets starting with '• '. Never promise money or eligibility. ${languageInstruction(lang)}`,
      parts: [
        {
          text:
            `Farmer profile: ${user.role}, ${user.district}, ${user.state}, ${user.landAcres ?? "unknown"} acres, category ${user.socialCategory ?? "unknown"}, ${user.fpoId ? "FPO member" : "not in an FPO"}, crops ${[...new Set(lots.map((l) => l.commodity))].join(", ") || "unknown"}.\n` +
            `Rule-based suggestions (${SCHEME_RULES_VERSION}):\n` +
            suggestions.map((sg) => `- ${sg.name}: ${sg.summary} Why: ${sg.why.join(" ")} How to check: ${sg.howToCheck}${sg.link ? ` (${sg.link})` : ""}`).join("\n"),
        },
      ],
      temperature: 0.3,
    });
  });
}

// ---------- FPO pooling advice ----------

export async function fpoAdvice(): Promise<AiResult<string>> {
  return guarded(async (user) => {
    if (user.role !== "FPO") throw new AiError("Pooling advice is for FPOs.");
    const lang = await getLang();
    const [ctx, market] = await Promise.all([userContext(user), marketSnapshot()]);
    return generate({
      system:
        "You advise a Farmer Producer Organisation in Maharashtra. Pooled lots are graded at the lowest contributed grade and proceeds are split by quantity. " +
        "Recommend which member lots to pool (by commodity), when pooling hurts (e.g. mixing PREMIUM with C drags the grade down), and where the pooled lot should be sold. " +
        `${GROUNDING} 3–5 bullets starting with '• ', max 130 words. ${languageInstruction(lang)}`,
      parts: [{ text: `${ctx}\n\nMarket snapshot:\n${market}` }],
      temperature: 0.3,
    });
  });
}
