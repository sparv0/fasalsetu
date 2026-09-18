import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashDeviceKey } from "@/lib/marketplace";
import { createRateLimiter } from "@/lib/rateLimit";
import { IOT_METRICS, type IotMetric } from "@/lib/engine/config";

const limiter = createRateLimiter(30, 60_000);
const METRICS = Object.keys(IOT_METRICS) as [IotMetric, ...IotMetric[]];

const bodySchema = z.object({
  readings: z
    .array(
      z.object({
        metric: z.enum(METRICS),
        value: z.number().finite(),
        recordedAt: z.iso.datetime({ offset: true }).optional(),
      })
    )
    .min(1)
    .max(100),
});

// Device gateway endpoint (ESP32 over HTTPS). Authenticated per device with `x-device-key`.
export async function POST(request: Request) {
  const key = request.headers.get("x-device-key");
  if (!key) return Response.json({ error: "Missing x-device-key header." }, { status: 401 });
  const keyHash = hashDeviceKey(key);

  const rate = limiter(keyHash);
  if (!rate.allowed) {
    return Response.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const device = await prisma.device.findUnique({ where: { keyHash } });
  if (!device) return Response.json({ error: "Unknown device key." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload.", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }

  const now = Date.now();
  const rows = [];
  for (const [i, r] of parsed.data.readings.entries()) {
    const range = IOT_METRICS[r.metric];
    if (r.value < range.min || r.value > range.max) {
      return Response.json({ error: `readings[${i}]: ${r.metric} must be between ${range.min} and ${range.max}.` }, { status: 422 });
    }
    const at = r.recordedAt ? new Date(r.recordedAt) : new Date(now);
    if (at.getTime() > now + 5 * 60_000 || at.getTime() < now - 7 * 24 * 60 * 60_000) {
      return Response.json({ error: `readings[${i}]: recordedAt must be within the last 7 days.` }, { status: 422 });
    }
    rows.push({ deviceId: device.id, metric: r.metric, value: r.value, recordedAt: at });
  }

  await prisma.iotReading.createMany({ data: rows });
  return Response.json({ accepted: rows.length, device: device.name }, { status: 201 });
}
