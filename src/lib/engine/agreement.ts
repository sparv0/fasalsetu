import { createHash } from "node:crypto";

export const AGREEMENT_VERSION = "FS-AGR-1";

export type AgreementTerms = {
  version: string;
  offerId: string;
  seller: { id: string; name: string; district: string; kind: "FARMER" | "FPO" };
  buyer: { id: string; name: string; district: string; verified: boolean };
  commodity: string;
  qualityGrade: string;
  qualityBasis: "MEASURED" | "SELF_DECLARED";
  quantityQt: number;
  pricePerQt: number;
  totalValue: number;
  deliveryTerms: string;
  deliveryWindowDays: number;
  paymentTerms: string;
  disputeResolution: string;
  agreedAt: string;
};

// Stable key order so the same terms always hash the same way.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashTerms(terms: AgreementTerms): string {
  return createHash("sha256").update(canonicalJson(terms)).digest("hex");
}

export function verifyAgreement(termsJson: string, storedHash: string): boolean {
  try {
    return hashTerms(JSON.parse(termsJson) as AgreementTerms) === storedHash;
  } catch {
    return false;
  }
}
