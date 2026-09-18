const inrFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function inr(value: number): string {
  return `₹${inrFormatter.format(Math.round(value))}`;
}

export function qt(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} qt`;
}

export function pct(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function dateTime(d: Date, lang: string = "en"): string {
  return d.toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

export function humanize(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
