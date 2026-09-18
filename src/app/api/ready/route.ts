import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latest = await prisma.priceRecord.aggregate({ _max: { date: true } });
    return Response.json({
      status: "ready",
      database: { ok: true, latencyMs: Date.now() - started },
      marketData: { latestRecord: latest._max.date },
    });
  } catch (e) {
    console.error("[ready] database check failed", e);
    return Response.json({ status: "not_ready", database: { ok: false } }, { status: 503 });
  }
}
