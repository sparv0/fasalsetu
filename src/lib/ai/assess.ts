import "server-only";
import { prisma } from "../prisma";
import { readImage } from "../media";
import { QUALITY_PARAMS, gradeFromParams } from "../engine/quality";
import { COMMODITIES, type Commodity } from "../engine/config";
import { generateJson } from "./gemini";

export type PhotoAssessment = {
  detectedCommodity: string;
  matchesLot: boolean;
  imageQuality: "GOOD" | "FAIR" | "POOR";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  estimates: Record<string, number>;
  grade: string | null;
  limitedBy: string[];
  observations: string[];
  analysedAt: string;
};

type RawAssessment = Omit<PhotoAssessment, "grade" | "limitedBy" | "analysedAt" | "matchesLot">;

// Vision grading of one lot photo. Estimates are clamped to each parameter's valid range and
// graded with the same platform rules as measured lots, but always labelled as AI estimates.
export async function assessPhoto(mediaId: string): Promise<PhotoAssessment> {
  const media = await prisma.lotMedia.findUniqueOrThrow({ where: { id: mediaId }, include: { lot: true } });
  const bytes = await readImage(media.storedAs);
  if (!bytes) throw new Error("Photo file missing");
  const commodity = media.lot.commodity as Commodity;
  const defs = QUALITY_PARAMS[commodity];

  const raw = await generateJson<RawAssessment>({
    system:
      "You are an agricultural produce quality inspector for Indian mandis. Assess only what is visible in the photo. " +
      "When a measurement needs a size reference that is not visible, give your best visual estimate and lower the confidence. Never refuse; if the image is not produce, say so in observations and set confidence LOW.",
    parts: [
      {
        text:
          `The farmer declared this lot as ${commodity}. Estimate these quality parameters from the photo: ` +
          defs.map((d) => `${d.key} = ${d.label} in ${d.unit} (valid ${d.min}–${d.max})`).join("; ") +
          `. Also identify the commodity you actually see (one of ${COMMODITIES.join(", ")} or "Other"). Give 2–4 short, concrete observations a buyer would care about.`,
      },
      { inline_data: { mime_type: media.mimeType, data: bytes.toString("base64") } },
    ],
    temperature: 0.2,
    schema: {
      type: "OBJECT",
      properties: {
        detectedCommodity: { type: "STRING", enum: [...COMMODITIES, "Other"] },
        imageQuality: { type: "STRING", enum: ["GOOD", "FAIR", "POOR"] },
        confidence: { type: "STRING", enum: ["HIGH", "MEDIUM", "LOW"] },
        estimates: {
          type: "OBJECT",
          properties: Object.fromEntries(defs.map((d) => [d.key, { type: "NUMBER" }])),
          required: defs.map((d) => d.key),
        },
        observations: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["detectedCommodity", "imageQuality", "confidence", "estimates", "observations"],
    },
  });

  const estimates: Record<string, number> = {};
  for (const d of defs) {
    const v = Number(raw.estimates?.[d.key]);
    estimates[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, Math.round(v * 10) / 10)) : d.min;
  }
  const matchesLot = raw.detectedCommodity?.toLowerCase() === commodity.toLowerCase();
  const usable = matchesLot && raw.imageQuality !== "POOR";
  const graded = usable ? gradeFromParams(commodity, estimates) : null;

  const assessment: PhotoAssessment = {
    detectedCommodity: raw.detectedCommodity ?? "Unknown",
    matchesLot,
    imageQuality: raw.imageQuality ?? "POOR",
    confidence: usable ? raw.confidence ?? "LOW" : "LOW",
    estimates,
    grade: graded?.grade ?? null,
    limitedBy: graded?.limitedBy ?? [],
    observations: (raw.observations ?? []).slice(0, 4).map((o) => String(o).slice(0, 200)),
    analysedAt: new Date().toISOString(),
  };
  await prisma.lotMedia.update({ where: { id: mediaId }, data: { aiAssessment: JSON.stringify(assessment) } });
  return assessment;
}
