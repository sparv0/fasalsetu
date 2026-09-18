import { QUALITY_RANK, type Commodity, type QualityGrade } from "./config";

export type QualityParamDef = { key: string; label: string; unit: string; min: number; max: number; step: number };

export const QUALITY_PARAMS: Record<Commodity, QualityParamDef[]> = {
  Onion: [
    { key: "bulbSizeMm", label: "Bulb size", unit: "mm", min: 20, max: 100, step: 1 },
    { key: "damagedPct", label: "Damaged / diseased", unit: "%", min: 0, max: 100, step: 0.1 },
    { key: "sproutedPct", label: "Sprouted", unit: "%", min: 0, max: 100, step: 0.1 },
  ],
  Soybean: [
    { key: "moisturePct", label: "Moisture", unit: "%", min: 5, max: 30, step: 0.1 },
    { key: "foreignMatterPct", label: "Foreign matter", unit: "%", min: 0, max: 20, step: 0.1 },
    { key: "damagedPct", label: "Damaged seeds", unit: "%", min: 0, max: 50, step: 0.1 },
  ],
  Wheat: [
    { key: "moisturePct", label: "Moisture", unit: "%", min: 5, max: 30, step: 0.1 },
    { key: "foreignMatterPct", label: "Foreign matter", unit: "%", min: 0, max: 20, step: 0.1 },
    { key: "brokenPct", label: "Broken / shrivelled", unit: "%", min: 0, max: 50, step: 0.1 },
  ],
};

// Platform grading rules v1 (DEMO). Each grade lists limits every parameter must satisfy;
// "min" means the value must be at least the limit, "max" at most.
type Limit = ["min" | "max", number];
const RULES: Record<Commodity, { grade: QualityGrade; limits: Record<string, Limit> }[]> = {
  Onion: [
    { grade: "PREMIUM", limits: { bulbSizeMm: ["min", 55], damagedPct: ["max", 2], sproutedPct: ["max", 1] } },
    { grade: "A", limits: { bulbSizeMm: ["min", 45], damagedPct: ["max", 5], sproutedPct: ["max", 3] } },
    { grade: "B", limits: { bulbSizeMm: ["min", 35], damagedPct: ["max", 10], sproutedPct: ["max", 6] } },
  ],
  Soybean: [
    { grade: "PREMIUM", limits: { moisturePct: ["max", 10], foreignMatterPct: ["max", 0.5], damagedPct: ["max", 1] } },
    { grade: "A", limits: { moisturePct: ["max", 12], foreignMatterPct: ["max", 1], damagedPct: ["max", 3] } },
    { grade: "B", limits: { moisturePct: ["max", 14], foreignMatterPct: ["max", 2], damagedPct: ["max", 6] } },
  ],
  Wheat: [
    { grade: "PREMIUM", limits: { moisturePct: ["max", 10], foreignMatterPct: ["max", 0.25], brokenPct: ["max", 1] } },
    { grade: "A", limits: { moisturePct: ["max", 12], foreignMatterPct: ["max", 0.75], brokenPct: ["max", 3] } },
    { grade: "B", limits: { moisturePct: ["max", 14], foreignMatterPct: ["max", 1.5], brokenPct: ["max", 6] } },
  ],
};

export type ParsedParams = Record<string, number>;

// Returns parsed values, or an error message naming the offending parameter.
export function parseQualityParams(commodity: Commodity, raw: Record<string, unknown>): { params: ParsedParams | null; error?: string } {
  const defs = QUALITY_PARAMS[commodity];
  const provided = defs.filter((d) => raw[d.key] !== undefined && String(raw[d.key]).trim() !== "");
  if (provided.length === 0) return { params: null };
  if (provided.length !== defs.length) {
    return { params: null, error: `Enter all ${defs.length} quality measurements for ${commodity}, or leave them all blank.` };
  }
  const params: ParsedParams = {};
  for (const d of defs) {
    const v = Number(raw[d.key]);
    if (!Number.isFinite(v)) return { params: null, error: `${d.label} must be a number.` };
    if (v < d.min || v > d.max) {
      return { params: null, error: `${d.label} must be between ${d.min} and ${d.max} ${d.unit}.` };
    }
    params[d.key] = v;
  }
  return { params };
}

export function gradeFromParams(commodity: Commodity, params: ParsedParams): { grade: QualityGrade; limitedBy: string[] } {
  const defs = QUALITY_PARAMS[commodity];
  let limitedBy: string[] = [];
  for (const rule of RULES[commodity]) {
    const failing = Object.entries(rule.limits)
      .filter(([key, [kind, limit]]) => (kind === "min" ? params[key] < limit : params[key] > limit))
      .map(([key]) => defs.find((d) => d.key === key)?.label ?? key);
    if (failing.length === 0) return { grade: rule.grade, limitedBy };
    if (limitedBy.length === 0) limitedBy = failing;
  }
  return { grade: "C", limitedBy };
}

export function lowestGrade(grades: string[]): QualityGrade {
  return grades.reduce<QualityGrade>(
    (low, g) => ((QUALITY_RANK[g] ?? 0) < (QUALITY_RANK[low] ?? 0) ? (g as QualityGrade) : low),
    "PREMIUM"
  );
}
