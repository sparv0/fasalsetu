import { COMMODITIES } from "./config";

export const PRICE_CSV_HEADER = ["market", "commodity", "date", "min_price", "modal_price", "max_price", "arrivals_qt"] as const;
export const PRICE_CSV_MAX_ROWS = 5000;

export type ParsedPriceRow = {
  marketId: string;
  commodity: string;
  date: Date;
  minPrice: number;
  modalPrice: number;
  maxPrice: number;
  arrivalsQt: number;
};

export type PriceCsvResult = {
  rows: ParsedPriceRow[];
  errors: { line: number; reason: string }[];
};

// Validates every row independently: bad rows are reported and skipped, good rows kept.
export function parsePriceCsv(text: string, marketIdsByName: Map<string, string>, now: Date = new Date()): PriceCsvResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim());
  const nonEmpty = lines.map((l, i) => ({ l, line: i + 1 })).filter((x) => x.l !== "");
  if (nonEmpty.length === 0) return { rows: [], errors: [{ line: 1, reason: "File is empty." }] };

  const header = nonEmpty[0].l.split(",").map((h) => h.trim().toLowerCase());
  if (header.join(",") !== PRICE_CSV_HEADER.join(",")) {
    return { rows: [], errors: [{ line: nonEmpty[0].line, reason: `Header must be exactly: ${PRICE_CSV_HEADER.join(",")}` }] };
  }
  const body = nonEmpty.slice(1);
  if (body.length > PRICE_CSV_MAX_ROWS) {
    return { rows: [], errors: [{ line: 1, reason: `Too many rows (${body.length}); the limit is ${PRICE_CSV_MAX_ROWS}.` }] };
  }

  const rows: ParsedPriceRow[] = [];
  const errors: PriceCsvResult["errors"] = [];
  const seen = new Set<string>();

  for (const { l, line } of body) {
    const cells = l.split(",").map((c) => c.trim());
    if (cells.length !== PRICE_CSV_HEADER.length) {
      errors.push({ line, reason: `Expected ${PRICE_CSV_HEADER.length} columns, found ${cells.length}.` });
      continue;
    }
    const [marketName, commodity, dateStr, ...nums] = cells;
    const marketId = marketIdsByName.get(marketName.toLowerCase());
    if (!marketId) {
      errors.push({ line, reason: `Unknown market "${marketName}".` });
      continue;
    }
    const canonical = COMMODITIES.find((c) => c.toLowerCase() === commodity.toLowerCase());
    if (!canonical) {
      errors.push({ line, reason: `Unsupported commodity "${commodity}".` });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(`${dateStr}T00:00:00Z`))) {
      errors.push({ line, reason: `Date "${dateStr}" must be YYYY-MM-DD.` });
      continue;
    }
    const date = new Date(`${dateStr}T10:00:00+05:30`);
    if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      errors.push({ line, reason: "Date is in the future." });
      continue;
    }
    const [minPrice, modalPrice, maxPrice, arrivalsQt] = nums.map(Number);
    if ([minPrice, modalPrice, maxPrice, arrivalsQt].some((n) => !Number.isFinite(n) || n < 0)) {
      errors.push({ line, reason: "Prices and arrivals must be non-negative numbers." });
      continue;
    }
    if (!(minPrice <= modalPrice && modalPrice <= maxPrice) || modalPrice === 0) {
      errors.push({ line, reason: "Prices must satisfy 0 < min ≤ modal ≤ max." });
      continue;
    }
    const key = `${marketId}|${canonical}|${dateStr}`;
    if (seen.has(key)) {
      errors.push({ line, reason: "Duplicate of an earlier row in this file." });
      continue;
    }
    seen.add(key);
    rows.push({ marketId, commodity: canonical, date, minPrice, modalPrice, maxPrice, arrivalsQt });
  }
  return { rows, errors };
}
