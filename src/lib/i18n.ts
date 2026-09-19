import { MARATHI_DICT } from "./marathi";

// UI localisation. Strings are written inline as t("English", "हिंदी") so each screen stays readable
// in one place. Hindi is fully translated; Marathi currently localises AI answers only and falls back
// to English for the interface, EXCEPT for key UI strings now backed by MARATHI_DICT.
export type UiLang = "en" | "hi" | "mr";
export type T = (en: string, hi: string) => string;

export function makeT(lang: UiLang): T {
  return (en, hi) => {
    if (lang === "hi") return hi;
    if (lang === "mr") return MARATHI_DICT[en] || en;
    return en;
  };
}

export function locale(lang: UiLang): string {
  return lang === "hi" ? "hi-IN" : "en-IN";
}

const COMMODITY_HI: Record<string, string> = { Onion: "प्याज", Soybean: "सोयाबीन", Wheat: "गेहूं" };
export function commodityName(c: string, lang: UiLang): string {
  return lang === "hi" ? (COMMODITY_HI[c] ?? c) : c;
}

export function gradeName(g: string, lang: UiLang): string {
  if (g === "PREMIUM") return lang === "hi" ? "प्रीमियम" : "Premium";
  return g;
}

const STATUS: Record<string, [string, string]> = {
  OPEN: ["Open", "खुला"],
  PARTIALLY_SOLD: ["Partially sold", "आंशिक बिका"],
  SOLD: ["Sold", "बिक गया"],
  WITHDRAWN: ["Withdrawn", "वापस लिया"],
  POOLED: ["Pooled", "पूल में"],
  PENDING: ["Pending", "लंबित"],
  COUNTERED: ["Countered", "जवाबी प्रस्ताव"],
  ACCEPTED: ["Accepted", "स्वीकृत"],
  REJECTED: ["Rejected", "अस्वीकृत"],
  EXPIRED: ["Expired", "समाप्त"],
  CREATED: ["Created", "बनाया गया"],
  LOGISTICS_BOOKED: ["Logistics booked", "वाहन बुक"],
  IN_TRANSIT: ["In transit", "रास्ते में"],
  DELIVERED: ["Delivered", "पहुँच गया"],
  PAYMENT_INITIATED: ["Payment initiated", "भुगतान शुरू"],
  PAID: ["Paid", "भुगतान हुआ"],
  CLOSED: ["Closed", "पूर्ण"],
  BOOKED: ["Booked", "बुक"],
  INITIATED: ["Initiated", "शुरू"],
  COMPLETED: ["Completed", "पूरा"],
  RESOLVED: ["Resolved", "सुलझाया"],
  HIGH: ["High", "उच्च"],
  MEDIUM: ["Medium", "मध्यम"],
  LOW: ["Low", "कम"],
  VERIFIED: ["Verified", "सत्यापित"],
  UNVERIFIED: ["Unverified", "असत्यापित"],
  ACTIVE: ["Active", "सक्रिय"],
  CANCELLED: ["Cancelled", "रद्द"],
};
export function statusName(status: string, lang: UiLang): string {
  const s = STATUS[status];
  if (s) return lang === "hi" ? s[1] : s[0];
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

const GRIEVANCE_HI: Record<string, string> = {
  "Quality mismatch": "गुणवत्ता में अंतर",
  "Quantity shortfall": "मात्रा में कमी",
  "Delivery delay": "डिलीवरी में देरी",
  "Payment issue": "भुगतान की समस्या",
  Other: "अन्य",
};
export function grievanceName(c: string, lang: UiLang): string {
  return lang === "hi" ? (GRIEVANCE_HI[c] ?? c) : c;
}

// Keyed by the English label used in the grading rules.
const PARAM_HI: Record<string, string> = {
  "Bulb size": "कंद का आकार",
  "Damaged / diseased": "खराब / रोगग्रस्त",
  Sprouted: "अंकुरित",
  Moisture: "नमी",
  "Foreign matter": "बाहरी पदार्थ",
  "Damaged seeds": "खराब दाने",
  "Broken / shrivelled": "टूटे / सिकुड़े दाने",
};
export function paramName(label: string, lang: UiLang): string {
  return lang === "hi" ? (PARAM_HI[label] ?? label) : label;
}

const ROLE: Record<string, [string, string]> = {
  FARMER: ["farmer", "किसान"],
  FPO: ["FPO", "एफपीओ"],
  BUYER: ["buyer", "खरीदार"],
  ADMIN: ["admin", "एडमिन"],
};
export function roleName(role: string, lang: UiLang): string {
  const r = ROLE[role];
  return r ? (lang === "hi" ? r[1] : r[0]) : role;
}

const AUDIT: Record<string, [string, string]> = {
  LOT_CREATED: ["Lot created", "लॉट बनाया"],
  LOT_WITHDRAWN: ["Lot withdrawn", "लॉट वापस लिया"],
  LOT_POOLED: ["Lot pooled", "लॉट पूल किया"],
  POOL_CREATED: ["Pool created", "पूल बना"],
  POOL_DISSOLVED: ["Pool dissolved", "पूल भंग"],
  LOT_PHOTO_ADDED: ["Photo added", "फ़ोटो जोड़ी"],
  AI_PHOTO_GRADED: ["AI photo check", "एआई फ़ोटो जाँच"],
  OFFER_SENT: ["Offer sent", "ऑफ़र भेजा"],
  OFFER_WITHDRAWN: ["Offer withdrawn", "ऑफ़र वापस"],
  OFFER_COUNTERED: ["Counter-offer", "जवाबी प्रस्ताव"],
  OFFER_ACCEPTED: ["Offer accepted", "ऑफ़र स्वीकार"],
  OFFER_REJECTED: ["Offer rejected", "ऑफ़र अस्वीकार"],
  OFFER_EXPIRED: ["Offer expired", "ऑफ़र समाप्त"],
  COUNTER_DECLINED: ["Counter declined", "जवाबी प्रस्ताव अस्वीकार"],
  STORAGE_BOOKED: ["Storage booked", "भंडारण बुक"],
  STORAGE_CANCELLED: ["Storage cancelled", "भंडारण रद्द"],
  ORDER_BOOK_LOGISTICS: ["Pickup booked", "पिकअप बुक"],
  ORDER_MARK_IN_TRANSIT: ["Picked up", "माल उठाया"],
  ORDER_MARK_DELIVERED: ["Delivered", "पहुँच गया"],
  ORDER_INITIATE_PAYMENT: ["Payment initiated", "भुगतान शुरू"],
  ORDER_CONFIRM_PAYMENT: ["Payment confirmed", "भुगतान की पुष्टि"],
  ORDER_CLOSE: ["Closed", "सौदा पूर्ण"],
  GRIEVANCE_RAISED: ["Grievance raised", "शिकायत दर्ज"],
  GRIEVANCE_RESOLVED: ["Grievance resolved", "शिकायत सुलझी"],
  USER_VERIFIED: ["User verified", "उपयोगकर्ता सत्यापित"],
  USER_UNVERIFIED: ["Verification revoked", "सत्यापन हटाया"],
  PRICES_IMPORTED: ["Prices imported", "भाव आयात"],
  DEMO_SEEDED: ["Demo reset", "डेमो रीसेट"],
};
export function auditName(action: string, lang: UiLang): string {
  const a = AUDIT[action];
  return a ? (lang === "hi" ? a[1] : a[0]) : statusName(action.replace(/^ORDER_/, ""), lang);
}

export function qtyL(value: number, lang: UiLang): string {
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return lang === "hi" ? `${n} क्विंटल` : `${n} qt`;
}

export function perQt(lang: UiLang): string {
  return lang === "hi" ? "/क्विंटल" : "/qt";
}

const ORDER_ACTION: Record<string, [string, string]> = {
  BOOK_LOGISTICS: ["Book pickup", "पिकअप बुक करें"],
  MARK_IN_TRANSIT: ["Mark picked up", "माल उठाया गया"],
  MARK_DELIVERED: ["Confirm delivery received", "माल मिलने की पुष्टि करें"],
  INITIATE_PAYMENT: ["Pay farmer", "किसान को भुगतान करें"],
  CONFIRM_PAYMENT: ["Confirm payment received", "भुगतान मिलने की पुष्टि करें"],
  CLOSE: ["Close transaction", "सौदा पूरा करें"],
};
export function orderActionName(action: string, lang: UiLang): string {
  const a = ORDER_ACTION[action];
  return a ? (lang === "hi" ? a[1] : a[0]) : action;
}
