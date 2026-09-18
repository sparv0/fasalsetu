const TONES: Record<string, string> = {
  sky: "bg-sky-100 text-sky-800",
  amber: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-100 text-emerald-800",
  rose: "bg-rose-100 text-rose-800",
  stone: "bg-stone-200 text-stone-700",
};

export { StatusBadge } from "./I18nProvider";

export function Badge({ children, tone = "stone" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-stone-200 rounded-xl p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-semibold text-stone-900">{title}</h2>
      {hint && <p className="text-xs text-stone-500 mt-0.5">{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-stone-500 border border-dashed border-stone-300 rounded-xl p-4 text-center">{children}</p>;
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="text-center">
      <div className="text-2xl font-bold text-emerald-800">{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </Card>
  );
}

export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`30-day price trend, ${rising ? "rising" : "falling"}`}>
      <polyline points={points} fill="none" stroke={rising ? "#047857" : "#be123c"} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export const inputClass = "mt-1 block w-full border border-stone-300 rounded-lg px-2 py-1.5 text-sm bg-white";
export const inlineInputClass = "block border border-stone-300 rounded-lg px-2 py-1.5 text-sm bg-white w-28";
export const labelClass = "text-xs font-medium text-stone-600";
