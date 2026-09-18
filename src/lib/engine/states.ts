export const ORDER_FLOW = [
  "CREATED",
  "LOGISTICS_BOOKED",
  "IN_TRANSIT",
  "DELIVERED",
  "PAYMENT_INITIATED",
  "PAID",
  "CLOSED",
] as const;
export type OrderStatus = (typeof ORDER_FLOW)[number];

export type OrderAction =
  | "BOOK_LOGISTICS"
  | "MARK_IN_TRANSIT"
  | "MARK_DELIVERED"
  | "INITIATE_PAYMENT"
  | "CONFIRM_PAYMENT"
  | "CLOSE";

type Party = "FARMER" | "BUYER";

export const ORDER_ACTIONS: Record<OrderAction, { from: OrderStatus; to: OrderStatus; by: Party[]; label: string }> = {
  BOOK_LOGISTICS: { from: "CREATED", to: "LOGISTICS_BOOKED", by: ["BUYER"], label: "Book pickup" },
  MARK_IN_TRANSIT: { from: "LOGISTICS_BOOKED", to: "IN_TRANSIT", by: ["FARMER", "BUYER"], label: "Mark picked up" },
  MARK_DELIVERED: { from: "IN_TRANSIT", to: "DELIVERED", by: ["BUYER"], label: "Confirm delivery received" },
  INITIATE_PAYMENT: { from: "DELIVERED", to: "PAYMENT_INITIATED", by: ["BUYER"], label: "Pay farmer" },
  CONFIRM_PAYMENT: { from: "PAYMENT_INITIATED", to: "PAID", by: ["FARMER"], label: "Confirm payment received" },
  CLOSE: { from: "PAID", to: "CLOSED", by: ["FARMER", "BUYER"], label: "Close transaction" },
};

export function orderActionAllowed(action: OrderAction, status: string, party: Party | null): string | null {
  const rule = ORDER_ACTIONS[action];
  if (!party || !rule.by.includes(party)) return `Only the ${rule.by.join(" or ").toLowerCase()} can do this.`;
  if (status !== rule.from) return `Order is ${status.replaceAll("_", " ").toLowerCase()}; this step needs it to be ${rule.from.replaceAll("_", " ").toLowerCase()}.`;
  return null;
}

export function availableOrderActions(status: string, party: Party | null): OrderAction[] {
  return (Object.keys(ORDER_ACTIONS) as OrderAction[]).filter((a) => orderActionAllowed(a, status, party) === null);
}

export type OfferStatus = "PENDING" | "COUNTERED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "EXPIRED";
export const ACTIVE_OFFER_STATUSES: OfferStatus[] = ["PENDING", "COUNTERED"];

export function isActiveOffer(status: string): boolean {
  return status === "PENDING" || status === "COUNTERED";
}

export type LotStatus = "OPEN" | "PARTIALLY_SOLD" | "SOLD" | "WITHDRAWN" | "POOLED";

export function lotStatusAfterSale(originalQt: number, availableQt: number): LotStatus {
  if (availableQt <= 0) return "SOLD";
  if (availableQt < originalQt) return "PARTIALLY_SOLD";
  return "OPEN";
}

export function lotAcceptsOffers(status: string): boolean {
  return status === "OPEN" || status === "PARTIALLY_SOLD";
}

export function offerExpiry(from: Date, ttlHours: number): Date {
  return new Date(from.getTime() + ttlHours * 60 * 60 * 1000);
}

export function hoursLeft(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000)));
}

// A member lot can go into a pool only while nothing has been sold from it.
export function lotPoolable(status: string): boolean {
  return status === "OPEN";
}
