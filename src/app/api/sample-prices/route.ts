import { PRICE_CSV_HEADER } from "@/lib/engine/priceCsv";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// A ready-made CSV that backfills the stale Solapur wheat feed and includes one bad row,
// so an admin can see both a successful import and row-level rejection.
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });

  const lines: string[] = [PRICE_CSV_HEADER.join(",")];
  for (let d = 3; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    if (date.getDay() === 0) continue;
    const day = date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const modal = 2500 + (3 - d) * 12;
    lines.push(`Solapur APMC,Wheat,${day},${modal - 90},${modal},${modal + 85},${110 + d * 7}`);
  }
  lines.push(`Solapur APMC,Wheat,2026-01-15,2600,2500,2700,90`);
  lines.push(`Unknown Mandi,Onion,2026-09-01,1500,1600,1700,200`);

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sample-prices.csv"',
    },
  });
}
