"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, type Role, type User } from "@prisma/client";
import { prisma } from "./prisma";
import { clearCurrentUser, getCurrentUser, homePathFor, setCurrentUser } from "./session";
import { ActionError, type ActionResult } from "./action-result";
import { getLang } from "./lang";
import { localizeMessage } from "./actionMessages";
import { randomBytes } from "node:crypto";
import {
  COMMODITIES,
  DISTRICTS,
  GRIEVANCE_CATEGORIES,
  MEDIA_MAX_PER_LOT,
  OFFER_PRICE_MAX,
  OFFER_TTL_HOURS,
  QUALITY_GRADES,
} from "./engine/config";
import { gradeFromParams, lowestGrade, parseQualityParams } from "./engine/quality";
import { AGREEMENT_VERSION, type AgreementTerms, canonicalJson, hashTerms } from "./engine/agreement";
import { parsePriceCsv } from "./engine/priceCsv";
import { expireStaleOffers, hashDeviceKey } from "./marketplace";
import { saveImage } from "./media";
import { aiEnabled, checkAiQuota } from "./ai/gemini";
import { assessPhoto } from "./ai/assess";
import { districtPoint, quoteTransport, roadDistanceKm } from "./engine/logistics";
import {
  ACTIVE_OFFER_STATUSES,
  ORDER_ACTIONS,
  type OrderAction,
  lotAcceptsOffers,
  lotPoolable,
  lotStatusAfterSale,
  offerExpiry,
  orderActionAllowed,
} from "./engine/states";
import { matchForBuyer } from "./match";
import { inr, qt } from "./format";

type Tx = Prisma.TransactionClient;

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  const lang = await getLang();
  const say = (m: string) => localizeMessage(m, lang);
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message: message ? say(message) : undefined };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: say(e.message) };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: say("That was already done — refresh the page to see the latest state.") };
    }
    console.error("[action] unexpected error", e);
    return { ok: false, error: say("Something went wrong on our side. Please try again.") };
  }
}

async function requireActor(...roles: Role[]): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Your session has ended. Please log in again.");
  if (roles.length > 0 && !roles.includes(user.role)) throw new ActionError("Your account type can't do that.");
  return user;
}

function parse<T extends z.ZodType>(schema: T, formData: FormData): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(formData));
  if (!result.success) throw new ActionError(result.error.issues[0]?.message ?? "Please check the form.");
  return result.data;
}

function audit(
  tx: Tx,
  data: { action: string; detail: string; actorId: string; lotId?: string; offerId?: string; orderId?: string }
) {
  return tx.auditEvent.create({ data });
}

// Moves a row from one status to another only if nobody else changed it first.
async function transition(
  count: Promise<Prisma.BatchPayload>,
  staleMessage = "This was already updated by someone else — refresh the page."
) {
  const { count: n } = await count;
  if (n !== 1) throw new ActionError(staleMessage);
}

const id = z.string().min(1, "Missing identifier.");
const price = z.coerce
  .number({ error: "Enter a valid price." })
  .positive("Price must be more than zero.")
  .max(OFFER_PRICE_MAX, `Price can't exceed ${inr(OFFER_PRICE_MAX)}/qt.`);
const quantity = z.coerce
  .number({ error: "Enter a valid quantity." })
  .positive("Quantity must be more than zero.")
  .max(100000, "Quantity is unrealistically large.");

// ---------- Session ----------

export async function loginAs(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");
  await setCurrentUser(user.id);
  redirect(homePathFor(user.role));
}

export async function logout() {
  await clearCurrentUser();
  redirect("/login");
}

// ---------- Lots ----------

const createLotSchema = z.object({
  commodity: z.enum(COMMODITIES, { error: "Pick a commodity." }),
  quantityQt: quantity,
  qualityGrade: z.enum(QUALITY_GRADES, { error: "Pick a quality grade." }).optional(),
  harvestDate: z.coerce
    .date({ error: "Enter the harvest date." })
    .refine((d) => d.getTime() <= Date.now() + 24 * 60 * 60 * 1000, "Harvest date can't be in the future.")
    .refine((d) => d.getTime() >= Date.now() - 365 * 24 * 60 * 60 * 1000, "Harvest date is more than a year ago."),
});

export async function createLot(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const farmer = await requireActor("FARMER", "FPO");
    const input = parse(createLotSchema, formData);
    const raw = Object.fromEntries(formData);
    const { params, error } = parseQualityParams(input.commodity, raw);
    if (error) throw new ActionError(error);
    let grade: string;
    let basis: string;
    if (params) {
      const graded = gradeFromParams(input.commodity, params);
      grade = graded.grade;
      basis = `measured${graded.limitedBy.length ? `, limited by ${graded.limitedBy.join(", ").toLowerCase()}` : ""}`;
    } else {
      if (!input.qualityGrade) throw new ActionError("Pick a grade, or enter the quality measurements so we can grade it.");
      grade = input.qualityGrade;
      basis = "self-declared";
    }
    await prisma.$transaction(async (tx) => {
      const lot = await tx.lot.create({
        data: {
          farmerId: farmer.id,
          commodity: input.commodity,
          quantityQt: input.quantityQt,
          availableQt: input.quantityQt,
          qualityGrade: grade,
          qualityParams: params ? JSON.stringify(params) : null,
          harvestDate: input.harvestDate,
          district: farmer.district,
        },
      });
      await audit(tx, {
        action: "LOT_CREATED",
        detail: `${input.commodity} ${qt(input.quantityQt)}, grade ${grade} (${basis})`,
        actorId: farmer.id,
        lotId: lot.id,
      });
    });
    return `${input.commodity} lot of ${qt(input.quantityQt)} created — grade ${grade}, ${basis}.`;
  });
}

export async function withdrawLot(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const farmer = await requireActor("FARMER", "FPO");
    const { lotId } = parse(z.object({ lotId: id }), formData);
    await prisma.$transaction(async (tx) => {
      const lot = await tx.lot.findUnique({ where: { id: lotId }, include: { poolParts: true, orders: { select: { id: true } } } });
      if (lot?.isPool && lot.orders.length > 0) {
        throw new ActionError("This pool already has sales, so it can't be dissolved. Members keep their pro-rata share.");
      }
      await transition(
        tx.lot.updateMany({
          where: { id: lotId, farmerId: farmer.id, status: { in: ["OPEN", "PARTIALLY_SOLD"] } },
          data: { status: "WITHDRAWN" },
        }),
        "This lot can't be withdrawn (already sold, withdrawn, or not yours)."
      );
      const rejected = await tx.offer.updateMany({
        where: { lotId, status: { in: ACTIVE_OFFER_STATUSES } },
        data: { status: "REJECTED" },
      });
      if (lot?.isPool) {
        for (const part of lot.poolParts) {
          await tx.lot.update({ where: { id: part.memberLotId }, data: { status: "OPEN", availableQt: part.quantityQt } });
        }
        await tx.poolContribution.deleteMany({ where: { poolLotId: lotId } });
      }
      await audit(tx, {
        action: lot?.isPool ? "POOL_DISSOLVED" : "LOT_WITHDRAWN",
        detail: lot?.isPool
          ? `Pool dissolved; ${lot.poolParts.length} member lot(s) returned to their farmers; ${rejected.count} open offer(s) closed.`
          : `Lot withdrawn; ${rejected.count} open offer(s) closed.`,
        actorId: farmer.id,
        lotId,
      });
    });
    return "Lot withdrawn from the market.";
  });
}

// ---------- Buyer demand ----------

const demandSchema = z.object({
  commodity: z.enum(COMMODITIES, { error: "Pick a commodity." }),
  quantityQt: quantity,
  qualityMin: z.enum(QUALITY_GRADES, { error: "Pick a minimum grade." }),
  pricePerQt: price,
  deliveryDays: z.coerce
    .number({ error: "Enter delivery window in days." })
    .int("Delivery window must be whole days.")
    .min(1, "Delivery window must be at least 1 day.")
    .max(60, "Delivery window can be at most 60 days."),
});

export async function createDemand(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const buyer = await requireActor("BUYER");
    const input = parse(demandSchema, formData);
    await prisma.buyerDemand.create({ data: { ...input, buyerId: buyer.id, district: buyer.district } });
    return `Demand posted: ${input.commodity}, ${qt(input.quantityQt)} at ${inr(input.pricePerQt)}/qt.`;
  });
}

export async function deleteDemand(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const buyer = await requireActor("BUYER");
    const { demandId } = parse(z.object({ demandId: id }), formData);
    await transition(
      prisma.buyerDemand.deleteMany({ where: { id: demandId, buyerId: buyer.id } }),
      "Demand not found — it may already be removed."
    );
    return "Demand removed.";
  });
}

// ---------- Offers ----------

export async function sendOffer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const buyer = await requireActor("BUYER");
    const input = parse(z.object({ lotId: id, pricePerQt: price, quantityQt: quantity }), formData);
    await expireStaleOffers();

    const lot = await prisma.lot.findUnique({ where: { id: input.lotId } });
    if (!lot) throw new ActionError("Lot not found.");
    if (!lotAcceptsOffers(lot.status)) throw new ActionError("This lot is no longer accepting offers.");
    if (input.quantityQt > lot.availableQt) {
      throw new ActionError(`Only ${qt(lot.availableQt)} is available on this lot.`);
    }
    const view = await matchForBuyer(lot, buyer);
    const score = view.hasDemand ? view.score : 0;

    await prisma.$transaction(async (tx) => {
      const existing = await tx.offer.count({
        where: { lotId: lot.id, buyerId: buyer.id, status: { in: ACTIVE_OFFER_STATUSES } },
      });
      if (existing > 0) throw new ActionError("You already have an open offer on this lot. Withdraw it first.");
      const offer = await tx.offer.create({
        data: {
          lotId: lot.id,
          buyerId: buyer.id,
          pricePerQt: input.pricePerQt,
          quantityQt: input.quantityQt,
          matchScore: score,
          matchReasons: JSON.stringify(view.reasons),
          expiresAt: offerExpiry(new Date(), OFFER_TTL_HOURS),
        },
      });
      await audit(tx, {
        action: "OFFER_SENT",
        detail: `${buyer.name} offered ${inr(input.pricePerQt)}/qt for ${qt(input.quantityQt)}`,
        actorId: buyer.id,
        lotId: lot.id,
        offerId: offer.id,
      });
    });
    return `Offer sent: ${inr(input.pricePerQt)}/qt for ${qt(input.quantityQt)}. It expires in ${OFFER_TTL_HOURS} hours if not answered.`;
  });
}

export async function withdrawOffer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const buyer = await requireActor("BUYER");
    const { offerId } = parse(z.object({ offerId: id }), formData);
    await prisma.$transaction(async (tx) => {
      await transition(
        tx.offer.updateMany({
          where: { id: offerId, buyerId: buyer.id, status: { in: ACTIVE_OFFER_STATUSES } },
          data: { status: "WITHDRAWN" },
        }),
        "This offer can no longer be withdrawn."
      );
      const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
      await audit(tx, { action: "OFFER_WITHDRAWN", detail: "Buyer withdrew the offer", actorId: buyer.id, lotId: offer.lotId, offerId });
    });
    return "Offer withdrawn.";
  });
}

async function loadOwnLotOffer(offerId: string, farmerId: string) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { lot: true } });
  if (!offer || offer.lot.farmerId !== farmerId) throw new ActionError("Offer not found.");
  return offer;
}

export async function counterOffer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const farmer = await requireActor("FARMER", "FPO");
    const input = parse(z.object({ offerId: id, counterPricePerQt: price }), formData);
    await expireStaleOffers();
    const offer = await loadOwnLotOffer(input.offerId, farmer.id);
    if (input.counterPricePerQt <= offer.pricePerQt) {
      throw new ActionError(`A counter must be above the buyer's ${inr(offer.pricePerQt)}/qt — otherwise just accept.`);
    }
    await prisma.$transaction(async (tx) => {
      await transition(
        tx.offer.updateMany({
          where: { id: offer.id, status: "PENDING", expiresAt: { gt: new Date() } },
          data: { status: "COUNTERED", counterPricePerQt: input.counterPricePerQt, expiresAt: offerExpiry(new Date(), OFFER_TTL_HOURS) },
        }),
        "Only a pending, unexpired offer can be countered."
      );
      await audit(tx, {
        action: "OFFER_COUNTERED",
        detail: `Farmer countered ${inr(offer.pricePerQt)} → ${inr(input.counterPricePerQt)}/qt`,
        actorId: farmer.id,
        lotId: offer.lotId,
        offerId: offer.id,
      });
    });
    return `Counter-offer of ${inr(input.counterPricePerQt)}/qt sent to the buyer.`;
  });
}

async function finalizeOffer(offerId: string, expectedStatus: "PENDING" | "COUNTERED", actor: User) {
  await expireStaleOffers();
  return prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findUniqueOrThrow({
      where: { id: offerId },
      include: { lot: { include: { farmer: true } }, buyer: true },
    });
    const agreedPrice = expectedStatus === "COUNTERED" ? offer.counterPricePerQt! : offer.pricePerQt;

    await transition(
      tx.offer.updateMany({
        where: { id: offerId, status: expectedStatus, expiresAt: { gt: new Date() } },
        data: { status: "ACCEPTED" },
      }),
      "This offer was already handled or has expired — refresh the page."
    );

    const lot = offer.lot;
    if (!lotAcceptsOffers(lot.status)) throw new ActionError("This lot is no longer open for sale.");
    if (offer.quantityQt > lot.availableQt) {
      throw new ActionError(`Only ${qt(lot.availableQt)} left on this lot; the offer is for ${qt(offer.quantityQt)}.`);
    }
    const remaining = lot.availableQt - offer.quantityQt;
    await transition(
      tx.lot.updateMany({
        where: { id: lot.id, availableQt: lot.availableQt },
        data: { availableQt: remaining, status: lotStatusAfterSale(lot.quantityQt, remaining) },
      }),
      "The lot changed while you were deciding — refresh and try again."
    );

    const demand = await tx.buyerDemand.findFirst({
      where: { buyerId: offer.buyerId, commodity: lot.commodity },
      orderBy: { deliveryDays: "asc" },
    });
    const terms: AgreementTerms = {
      version: AGREEMENT_VERSION,
      offerId: offer.id,
      seller: { id: lot.farmerId, name: lot.farmer.name, district: lot.district, kind: lot.farmer.role === "FPO" ? "FPO" : "FARMER" },
      buyer: { id: offer.buyer.id, name: offer.buyer.name, district: offer.buyer.district, verified: offer.buyer.verified },
      commodity: lot.commodity,
      qualityGrade: lot.qualityGrade,
      qualityBasis: lot.qualityParams ? "MEASURED" : "SELF_DECLARED",
      quantityQt: offer.quantityQt,
      pricePerQt: agreedPrice,
      totalValue: agreedPrice * offer.quantityQt,
      deliveryTerms: "Farm-gate. Buyer books and pays for pickup from the seller's location.",
      deliveryWindowDays: demand?.deliveryDays ?? 7,
      paymentTerms: "Buyer pays the full value through the platform payment tracker after confirming delivery.",
      disputeResolution: "Either party may raise a grievance; the platform admin reviews evidence and records a resolution.",
      agreedAt: new Date().toISOString(),
    };
    const agreementHash = hashTerms(terms);
    const order = await tx.order.create({
      data: {
        offerId: offer.id,
        lotId: lot.id,
        buyerId: offer.buyerId,
        farmerId: lot.farmerId,
        agreedPrice,
        quantityQt: offer.quantityQt,
        agreementTerms: canonicalJson(terms),
        agreementHash,
      },
    });

    const closed = await tx.offer.updateMany({
      where: { lotId: lot.id, id: { not: offer.id }, status: { in: ACTIVE_OFFER_STATUSES }, quantityQt: { gt: remaining } },
      data: { status: "REJECTED" },
    });

    await audit(tx, {
      action: "OFFER_ACCEPTED",
      detail: `Deal at ${inr(agreedPrice)}/qt for ${qt(offer.quantityQt)} (${inr(agreedPrice * offer.quantityQt)}). Agreement ${agreementHash.slice(0, 12)}… recorded. ${qt(remaining)} left on lot.${closed.count > 0 ? ` ${closed.count} other offer(s) auto-closed (exceed remaining quantity).` : ""}`,
      actorId: actor.id,
      lotId: lot.id,
      offerId: offer.id,
      orderId: order.id,
    });
    return order;
  });
}

export async function acceptOffer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const farmer = await requireActor("FARMER", "FPO");
    const { offerId } = parse(z.object({ offerId: id }), formData);
    await loadOwnLotOffer(offerId, farmer.id);
    await finalizeOffer(offerId, "PENDING", farmer);
    return "Offer accepted — an order has been created.";
  });
}

export async function acceptCounter(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const buyer = await requireActor("BUYER");
    const { offerId } = parse(z.object({ offerId: id }), formData);
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || offer.buyerId !== buyer.id) throw new ActionError("Offer not found.");
    await finalizeOffer(offerId, "COUNTERED", buyer);
    return "Counter-offer accepted — an order has been created.";
  });
}

export async function rejectOffer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const farmer = await requireActor("FARMER", "FPO");
    const { offerId } = parse(z.object({ offerId: id }), formData);
    const offer = await loadOwnLotOffer(offerId, farmer.id);
    await prisma.$transaction(async (tx) => {
      await transition(
        tx.offer.updateMany({ where: { id: offerId, status: "PENDING" }, data: { status: "REJECTED" } }),
        "Only a pending offer can be rejected."
      );
      await audit(tx, { action: "OFFER_REJECTED", detail: "Farmer rejected the offer", actorId: farmer.id, lotId: offer.lotId, offerId });
    });
    return "Offer rejected.";
  });
}

export async function rejectCounter(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const buyer = await requireActor("BUYER");
    const { offerId } = parse(z.object({ offerId: id }), formData);
    await prisma.$transaction(async (tx) => {
      await transition(
        tx.offer.updateMany({ where: { id: offerId, buyerId: buyer.id, status: "COUNTERED" }, data: { status: "REJECTED" } }),
        "Only a countered offer can be declined."
      );
      const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
      await audit(tx, { action: "COUNTER_DECLINED", detail: "Buyer declined the counter-offer", actorId: buyer.id, lotId: offer.lotId, offerId });
    });
    return "Counter-offer declined.";
  });
}

// ---------- Order execution ----------

const orderActionSchema = z.object({
  orderId: id,
  action: z.enum(Object.keys(ORDER_ACTIONS) as [OrderAction, ...OrderAction[]], { error: "Unknown action." }),
});

export async function runOrderAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireActor("FARMER", "FPO", "BUYER");
    const { orderId, action } = parse(orderActionSchema, formData);
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { farmer: true, buyer: true } });
    if (!order) throw new ActionError("Order not found.");
    const party = user.id === order.farmerId ? "FARMER" : user.id === order.buyerId ? "BUYER" : null;
    const denied = orderActionAllowed(action, order.status, party);
    if (denied) throw new ActionError(denied);

    const rule = ORDER_ACTIONS[action];
    let detail = rule.label;

    await prisma.$transaction(async (tx) => {
      await transition(tx.order.updateMany({ where: { id: order.id, status: rule.from }, data: { status: rule.to } }));

      switch (action) {
        case "BOOK_LOGISTICS": {
          const distanceKm = roadDistanceKm(districtPoint(order.farmer.district), districtPoint(order.buyer.district));
          const quote = quoteTransport(order.quantityQt, distanceKm);
          await tx.logisticsBooking.create({
            data: { orderId: order.id, vehicle: quote.vehicle, trips: quote.trips, distanceKm, quoteCost: quote.total },
          });
          detail = `Pickup booked: ${quote.trips} × ${quote.vehicle}, ${distanceKm} km, ${inr(quote.total)} (mock provider)`;
          break;
        }
        case "MARK_IN_TRANSIT":
          await tx.logisticsBooking.update({ where: { orderId: order.id }, data: { status: "IN_TRANSIT" } });
          detail = "Produce picked up — in transit";
          break;
        case "MARK_DELIVERED":
          await tx.logisticsBooking.update({ where: { orderId: order.id }, data: { status: "DELIVERED" } });
          detail = "Buyer confirmed delivery received";
          break;
        case "INITIATE_PAYMENT": {
          const amount = order.agreedPrice * order.quantityQt;
          const reference = `MOCK-${order.id.slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
          await tx.payment.create({ data: { orderId: order.id, amount, reference } });
          detail = `Payment of ${inr(amount)} initiated (ref ${reference}, mock provider)`;
          break;
        }
        case "CONFIRM_PAYMENT":
          await tx.payment.update({ where: { orderId: order.id }, data: { status: "COMPLETED" } });
          detail = "Farmer confirmed payment received";
          break;
        case "CLOSE": {
          const open = await tx.grievance.count({ where: { orderId: order.id, status: "OPEN" } });
          if (open > 0) throw new ActionError("Resolve open grievances before closing this transaction.");
          detail = "Transaction closed";
          break;
        }
      }

      await audit(tx, { action: `ORDER_${action}`, detail, actorId: user.id, orderId: order.id, lotId: order.lotId, offerId: order.offerId });
    });
    return detail + ".";
  });
}

// ---------- Grievances ----------

const grievanceSchema = z.object({
  orderId: id,
  category: z.enum(GRIEVANCE_CATEGORIES, { error: "Pick a category." }),
  description: z
    .string()
    .trim()
    .min(10, "Describe the issue in at least 10 characters.")
    .max(500, "Keep the description under 500 characters."),
});

export async function createGrievance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireActor("FARMER", "FPO", "BUYER");
    const input = parse(grievanceSchema, formData);
    const order = await prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order || (order.farmerId !== user.id && order.buyerId !== user.id)) throw new ActionError("Order not found.");
    if (order.status === "CLOSED") throw new ActionError("This transaction is closed. Contact the platform admin directly.");
    await prisma.$transaction(async (tx) => {
      const g = await tx.grievance.create({
        data: { orderId: order.id, raisedById: user.id, category: input.category, description: input.description },
      });
      await audit(tx, {
        action: "GRIEVANCE_RAISED",
        detail: `${input.category}: ${input.description}`,
        actorId: user.id,
        orderId: order.id,
        lotId: order.lotId,
      });
      return g;
    });
    return "Grievance raised. The platform admin has been notified.";
  });
}

export async function resolveGrievance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const admin = await requireActor("ADMIN");
    const input = parse(
      z.object({
        grievanceId: id,
        resolutionNote: z.string().trim().min(5, "Add a resolution note (at least 5 characters).").max(500),
      }),
      formData
    );
    await prisma.$transaction(async (tx) => {
      await transition(
        tx.grievance.updateMany({
          where: { id: input.grievanceId, status: "OPEN" },
          data: { status: "RESOLVED", resolutionNote: input.resolutionNote },
        }),
        "This grievance is already resolved."
      );
      const g = await tx.grievance.findUniqueOrThrow({ where: { id: input.grievanceId } });
      await audit(tx, { action: "GRIEVANCE_RESOLVED", detail: input.resolutionNote, actorId: admin.id, orderId: g.orderId });
    });
    return "Grievance resolved.";
  });
}

// ---------- Admin ----------

export async function setVerified(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const admin = await requireActor("ADMIN");
    const input = parse(z.object({ userId: id, verified: z.enum(["true", "false"]) }), formData);
    const verified = input.verified === "true";
    const target = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!target || target.role === "ADMIN") throw new ActionError("User not found.");
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { verified } });
      await audit(tx, {
        action: verified ? "USER_VERIFIED" : "USER_UNVERIFIED",
        detail: `${target.name} (${target.role.toLowerCase()}) ${verified ? "verified" : "verification revoked"}`,
        actorId: admin.id,
      });
    });
    return `${target.name} is now ${verified ? "verified" : "unverified"}.`;
  });
}

// ---------- Judge demo ----------

// One click from the login screen to the farmer's best selling decision (blueprint §24.1).
export async function quickStart() {
  const farmer = await prisma.user.findUnique({ where: { phone: "9800000001" } });
  if (!farmer) redirect("/login");
  const lot = await prisma.lot.findFirst({
    where: { farmerId: farmer.id, status: { in: ["OPEN", "PARTIALLY_SOLD"] } },
    orderBy: { availableQt: "desc" },
  });
  await setCurrentUser(farmer.id);
  redirect(lot ? `/farmer/lots/${lot.id}` : "/farmer");
}

// ---------- Lot photos ----------

export async function uploadLotMedia(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const seller = await requireActor("FARMER", "FPO");
    const lotId = String(formData.get("lotId") ?? "");
    const file = formData.get("photo");
    if (!(file instanceof File)) throw new ActionError("Choose a photo to upload.");
    const lot = await prisma.lot.findUnique({ where: { id: lotId }, include: { _count: { select: { media: true } } } });
    if (!lot || lot.farmerId !== seller.id) throw new ActionError("Lot not found.");
    if (lot._count.media >= MEDIA_MAX_PER_LOT) throw new ActionError(`A lot can have at most ${MEDIA_MAX_PER_LOT} photos.`);
    const saved = await saveImage(file);
    if ("error" in saved) throw new ActionError(saved.error);
    const media = await prisma.$transaction(async (tx) => {
      const created = await tx.lotMedia.create({ data: { lotId, ...saved } });
      await audit(tx, {
        action: "LOT_PHOTO_ADDED",
        detail: `Quality photo added (${Math.round(saved.sizeBytes / 1024)} KB, sha256 ${saved.sha256.slice(0, 12)}…)`,
        actorId: seller.id,
        lotId,
      });
      return created;
    });
    if (aiEnabled()) {
      try {
        checkAiQuota(seller.id);
        const a = await assessPhoto(media.id);
        return a.matchesLot && a.grade
          ? `Photo added. AI estimate: grade ${a.grade} (${a.confidence.toLowerCase()} confidence).`
          : `Photo added. AI check: ${a.matchesLot ? "photo too unclear to grade" : `this looks like ${a.detectedCommodity}, not ${lot.commodity}`}.`;
      } catch (e) {
        console.error("[ai] auto photo assessment failed", e);
        return "Photo added. AI grading is unavailable right now — use ✨ AI grade to retry.";
      }
    }
    return "Photo added as quality evidence.";
  });
}

// ---------- FPO pooling ----------

export async function createPool(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const fpo = await requireActor("FPO");
    const lotIds = [...new Set(formData.getAll("lotIds").map(String))].filter(Boolean);
    if (lotIds.length < 2) throw new ActionError("Select at least two member lots to pool.");

    const pool = await prisma.$transaction(async (tx) => {
      const lots = await tx.lot.findMany({ where: { id: { in: lotIds } }, include: { farmer: true } });
      if (lots.length !== lotIds.length) throw new ActionError("Some selected lots no longer exist.");
      if (lots.some((l) => l.farmer.fpoId !== fpo.id)) throw new ActionError("You can only pool lots from your own members.");
      if (lots.some((l) => !lotPoolable(l.status))) throw new ActionError("Only untouched open lots can be pooled — refresh and try again.");
      const commodities = new Set(lots.map((l) => l.commodity));
      if (commodities.size !== 1) throw new ActionError("All pooled lots must be the same commodity.");
      const stored = await tx.storageBooking.findMany({
        where: { lotId: { in: lotIds }, status: "ACTIVE" },
        include: { lot: { include: { farmer: true } } },
      });
      if (stored.length > 0) {
        throw new ActionError(`${stored[0].lot.farmer.name}'s lot has an active storage booking — it must be cancelled before pooling.`);
      }

      const total = lots.reduce((s, l) => s + l.availableQt, 0);
      const grade = lowestGrade(lots.map((l) => l.qualityGrade));
      const allMeasured = lots.every((l) => l.qualityParams);
      const created = await tx.lot.create({
        data: {
          farmerId: fpo.id,
          commodity: lots[0].commodity,
          quantityQt: total,
          availableQt: total,
          qualityGrade: grade,
          qualityParams: allMeasured ? JSON.stringify({ pooledFrom: lots.length }) : null,
          harvestDate: new Date(Math.min(...lots.map((l) => l.harvestDate.getTime()))),
          district: fpo.district,
          isPool: true,
        },
      });
      for (const l of lots) {
        await transition(
          tx.lot.updateMany({ where: { id: l.id, status: "OPEN", availableQt: l.availableQt }, data: { status: "POOLED", availableQt: 0 } }),
          "A member lot changed while pooling — refresh and try again."
        );
        await tx.offer.updateMany({ where: { lotId: l.id, status: { in: ACTIVE_OFFER_STATUSES } }, data: { status: "REJECTED" } });
        await tx.poolContribution.create({
          data: { poolLotId: created.id, memberLotId: l.id, farmerId: l.farmerId, quantityQt: l.availableQt },
        });
        await audit(tx, {
          action: "LOT_POOLED",
          detail: `${qt(l.availableQt)} pooled into ${fpo.name}'s ${l.commodity} lot`,
          actorId: fpo.id,
          lotId: l.id,
        });
      }
      await audit(tx, {
        action: "POOL_CREATED",
        detail: `Pooled ${lots.length} member lots: ${qt(total)} ${lots[0].commodity}, grade ${grade} (lowest contributed grade)`,
        actorId: fpo.id,
        lotId: created.id,
      });
      return created;
    });
    return `Pooled lot created: ${qt(pool.quantityQt)} ${pool.commodity}, grade ${pool.qualityGrade}.`;
  });
}

// ---------- Storage ----------

export async function bookStorage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const seller = await requireActor("FARMER", "FPO");
    const input = parse(
      z.object({
        lotId: id,
        facilityId: id,
        quantityQt: quantity,
        days: z.coerce.number().int("Days must be whole.").min(1, "Book at least 1 day.").max(180, "Book at most 180 days."),
      }),
      formData
    );
    const booking = await prisma.$transaction(async (tx) => {
      const lot = await tx.lot.findUnique({ where: { id: input.lotId } });
      if (!lot || lot.farmerId !== seller.id) throw new ActionError("Lot not found.");
      if (!lotAcceptsOffers(lot.status)) throw new ActionError("Only lots still on the market can be stored.");
      const alreadyStored = await tx.storageBooking.aggregate({
        where: { lotId: lot.id, status: "ACTIVE" },
        _sum: { quantityQt: true },
      });
      const storable = lot.availableQt - (alreadyStored._sum.quantityQt ?? 0);
      if (input.quantityQt > storable) throw new ActionError(`Only ${qt(Math.max(0, storable))} of this lot is not already in storage.`);
      const facility = await tx.storageFacility.findUnique({ where: { id: input.facilityId } });
      if (!facility) throw new ActionError("Facility not found.");
      if (!facility.commodities.split(",").includes(lot.commodity)) throw new ActionError(`${facility.name} doesn't store ${lot.commodity}.`);
      await transition(
        tx.storageFacility.updateMany({
          where: { id: facility.id, availableQt: { gte: input.quantityQt } },
          data: { availableQt: { decrement: input.quantityQt } },
        }),
        `${facility.name} no longer has ${qt(input.quantityQt)} free.`
      );
      const costEstimate = input.quantityQt * input.days * facility.costPerQtPerDay;
      const created = await tx.storageBooking.create({
        data: {
          lotId: lot.id,
          facilityId: facility.id,
          farmerId: seller.id,
          quantityQt: input.quantityQt,
          days: input.days,
          startDate: new Date(),
          costEstimate,
        },
      });
      await audit(tx, {
        action: "STORAGE_BOOKED",
        detail: `${qt(input.quantityQt)} at ${facility.name} for ${input.days} days, est. ${inr(costEstimate)} (mock booking)`,
        actorId: seller.id,
        lotId: lot.id,
      });
      return { created, facility };
    });
    return `Storage booked at ${booking.facility.name}: ${qt(input.quantityQt)} for ${input.days} days.`;
  });
}

export async function cancelStorage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const seller = await requireActor("FARMER", "FPO");
    const { bookingId } = parse(z.object({ bookingId: id }), formData);
    await prisma.$transaction(async (tx) => {
      const booking = await tx.storageBooking.findUnique({ where: { id: bookingId }, include: { facility: true } });
      if (!booking || booking.farmerId !== seller.id) throw new ActionError("Booking not found.");
      await transition(
        tx.storageBooking.updateMany({ where: { id: bookingId, status: "ACTIVE" }, data: { status: "CANCELLED" } }),
        "This booking is already cancelled."
      );
      await tx.storageFacility.update({ where: { id: booking.facilityId }, data: { availableQt: { increment: booking.quantityQt } } });
      await audit(tx, {
        action: "STORAGE_CANCELLED",
        detail: `Released ${qt(booking.quantityQt)} at ${booking.facility.name}`,
        actorId: seller.id,
        lotId: booking.lotId,
      });
    });
    return "Storage booking cancelled; capacity released.";
  });
}

// ---------- Farmer profile (scheme suggestions) ----------

export async function updateProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireActor("FARMER", "FPO");
    const input = parse(
      z.object({
        landAcres: z.coerce.number({ error: "Enter land in acres." }).min(0, "Land can't be negative.").max(10000, "That's too large for one profile."),
        socialCategory: z.enum(["GENERAL", "OBC", "SC", "ST"], { error: "Pick a category." }),
        district: z.enum(DISTRICTS as [string, ...string[]], { error: "Pick a district." }),
      }),
      formData
    );
    await prisma.user.update({ where: { id: user.id }, data: input });
    return "Profile saved. Suggestions updated.";
  });
}

// ---------- Field Nigrani (IoT) ----------

export async function registerDevice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const farmer = await requireActor("FARMER");
    const input = parse(
      z.object({
        name: z.string().trim().min(3, "Name the device (at least 3 characters).").max(60),
        purpose: z.enum(["STORAGE", "FIELD"], { error: "Pick where the device is installed." }),
      }),
      formData
    );
    const count = await prisma.device.count({ where: { farmerId: farmer.id } });
    if (count >= 10) throw new ActionError("You can register at most 10 devices.");
    const key = `fsd_${randomBytes(18).toString("base64url")}`;
    await prisma.device.create({
      data: { farmerId: farmer.id, name: input.name, purpose: input.purpose, keyHash: hashDeviceKey(key), keyHint: key.slice(-4) },
    });
    return `Device registered. Copy its key now — it won't be shown again: ${key}`;
  });
}

// ---------- Admin: market data import ----------

function istDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export async function importPrices(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const admin = await requireActor("ADMIN");
    const file = formData.get("csv");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("Choose a CSV file.");
    if (file.size > 1024 * 1024) throw new ActionError("CSV must be under 1 MB.");

    const markets = await prisma.market.findMany();
    const byName = new Map(markets.map((m) => [m.name.toLowerCase(), m.id]));
    const { rows, errors } = parsePriceCsv(await file.text(), byName);

    let duplicates = 0;
    let fresh = rows;
    if (rows.length > 0) {
      const dates = rows.map((r) => r.date.getTime());
      const existing = await prisma.priceRecord.findMany({
        where: {
          marketId: { in: [...new Set(rows.map((r) => r.marketId))] },
          date: { gte: new Date(Math.min(...dates) - 86400000), lte: new Date(Math.max(...dates) + 86400000) },
        },
        select: { marketId: true, commodity: true, date: true },
      });
      const seen = new Set(existing.map((e) => `${e.marketId}|${e.commodity}|${istDay(e.date)}`));
      fresh = rows.filter((r) => !seen.has(`${r.marketId}|${r.commodity}|${istDay(r.date)}`));
      duplicates = rows.length - fresh.length;
    }
    if (fresh.length === 0) {
      const first = errors[0] ? ` First problem — line ${errors[0].line}: ${errors[0].reason}` : "";
      throw new ActionError(`Nothing imported: ${errors.length} invalid row(s), ${duplicates} already on record.${first}`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.priceRecord.createMany({ data: fresh.map((r) => ({ ...r, source: "CSV_IMPORT" })) });
      await audit(tx, {
        action: "PRICES_IMPORTED",
        detail: `${fresh.length} price rows imported from ${file.name}; ${errors.length} rejected; ${duplicates} duplicates skipped`,
        actorId: admin.id,
      });
    });
    const problems = errors
      .slice(0, 5)
      .map((e) => `line ${e.line}: ${e.reason}`)
      .join("; ");
    return `Imported ${fresh.length} row(s). Rejected ${errors.length}, skipped ${duplicates} duplicate(s).${problems ? ` Problems — ${problems}` : ""}`;
  });
}

// ---------- Registration ----------

export async function registerUser(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "") as Role;
  const district = String(formData.get("district") ?? "");
  
  if (!name || !phone || !role || !district) {
    redirect("/login?error=Missing+fields");
  }

  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({ data: { name, phone, role, district } });
  }

  await setCurrentUser(user.id);
  redirect(homePathFor(user.role));
}

export async function loginWithPhone(formData: FormData) {
  const phone = String(formData.get("phone") ?? "").trim();
  const user = await prisma.user.findUnique({ where: { phone } });
  
  if (!user) {
    redirect("/login?error=User+not+found");
  }

  await setCurrentUser(user.id);
  redirect(homePathFor(user.role));
}
