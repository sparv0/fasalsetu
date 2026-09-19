import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRateLimiter } from "../rateLimit";

// Overridable for proxies and local testing.
const API = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 45_000;

export class AiError extends Error {}

// The key may be added to .env while the server is running; re-read it so no restart is needed.
let envCache: { at: number; key?: string; model?: string } = { at: 0 };
function envFromFile() {
  if (Date.now() - envCache.at < 10_000) return envCache;
  let key: string | undefined;
  let model: string | undefined;
  try {
    const text = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    key = text.match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)?.[1]?.trim();
    model = text.match(/^\s*GEMINI_MODEL\s*=\s*"?([^"\r\n]+)"?/m)?.[1]?.trim();
  } catch {}
  envCache = { at: Date.now(), key, model };
  return envCache;
}

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || envFromFile().key || undefined;
}

export function aiEnabled(): boolean {
  return Boolean(apiKey());
}

// Public demo link + a personal key: cap usage so nobody can drain the quota.
const perUser = createRateLimiter(15, 60_000);
const global = createRateLimiter(300, 60 * 60_000);

export function checkAiQuota(userId: string) {
  const u = perUser(userId);
  if (!u.allowed) throw new AiError(`AI limit reached — try again in ${u.retryAfterSeconds}s.`);
  const g = global("all");
  if (!g.allowed) throw new AiError("The AI assistant is busy right now. Please try again in a few minutes.");
}

let discoveredModel: string | null = null;

async function pickAvailableModel(key: string): Promise<string | null> {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  if (!res.ok) return null;
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const names = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /flash/.test(n) && !/(lite|image|tts|audio|live|embedding|thinking)/.test(n));
  const stable = names.filter((n) => !/(preview|exp)/.test(n));
  return (stable.length ? stable : names).sort().reverse()[0] ?? null;
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export type GenerateOptions = {
  system: string;
  parts: Part[];
  history?: { role: "user" | "model"; text: string }[];
  schema?: object;
  temperature?: number;
};

async function callModel(model: string, key: string, opts: GenerateOptions, useSchema = true) {
  const schemaHint =
    opts.schema && !useSchema ? `\n\nRespond with ONLY a JSON object matching this schema:\n${JSON.stringify(opts.schema)}` : "";
  const body = {
    systemInstruction: { parts: [{ text: opts.system + schemaHint }] },
    contents: [
      ...(opts.history ?? []).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      { role: "user", parts: opts.parts },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      ...(opts.schema ? { responseMimeType: "application/json", ...(useSchema ? { responseSchema: opts.schema } : {}) } : {}),
    },
  };
  return fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function generate(opts: GenerateOptions): Promise<string> {
  const key = apiKey();
  if (!key) throw new AiError("AI is not configured yet — add GEMINI_API_KEY to .env.");
  let model = discoveredModel || process.env.GEMINI_MODEL || envFromFile().model || DEFAULT_MODEL;

  let res: Response;
  try {
    res = await callModel(model, key, opts);
    if (res.status === 404) {
      console.log(`[ai] 404 encountered for ${model}. Fetching available models for this key...`);
      const fallback = await pickAvailableModel(key);
      if (fallback) {
        console.log(`[ai] Falling back to model: ${fallback}`);
        discoveredModel = fallback;
        model = fallback;
        res = await callModel(model, key, opts);
      }
    }
  } catch (e) {
    console.error("[ai] request failed", e);
    throw new AiError("Couldn't reach the AI service. Check the internet connection and try again.");
  }

  if (res.status === 400 && opts.schema) {
    const detail = await res.clone().text().catch(() => "");
    // Some models reject parts of the structured-output schema; retry with the schema in the prompt.
    if (/schema/i.test(detail) && !/API_KEY/i.test(detail)) {
      console.error(`[ai] ${model} rejected responseSchema, retrying without it: ${detail.slice(0, 300)}`);
      try {
        res = await callModel(model, key, opts, false);
      } catch (e) {
        console.error("[ai] retry failed", e);
        throw new AiError("Couldn't reach the AI service. Check the internet connection and try again.");
      }
    }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[ai] ${model} HTTP ${res.status}: ${detail.slice(0, 500)}`);
    if (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(detail)) throw new AiError("The Gemini API key is invalid.");
    if (res.status === 403) throw new AiError("The Gemini API key isn't allowed to use this model.");
    if (res.status === 429) throw new AiError("Gemini quota exceeded — try again shortly.");
    throw new AiError("The AI service returned an error. Please try again.");
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new AiError("The AI declined to answer that request.");
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiError("The AI returned an empty answer. Please try again.");
  return text;
}

export async function generateJson<T>(opts: GenerateOptions & { schema: object }): Promise<T> {
  const text = await generate(opts);
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    console.error("[ai] non-JSON response", text.slice(0, 300));
    throw new AiError("The AI response couldn't be read. Please try again.");
  }
}

export const LANGUAGES = {
  en: { label: "English", speech: "en-IN" },
  hi: { label: "हिंदी", speech: "hi-IN" },
  mr: { label: "मराठी", speech: "mr-IN" },
} as const;
export type Lang = keyof typeof LANGUAGES;

export function languageInstruction(lang: Lang): string {
  return {
    en: "Reply in simple English.",
    hi: "Reply in simple Hindi (Devanagari script). Keep rupee amounts as ₹ digits and market names as they are.",
    mr: "Reply in simple Marathi (Devanagari script). Keep rupee amounts as ₹ digits and market names as they are.",
  }[lang];
}
