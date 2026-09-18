"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, accessCode, accessToken, safeNext } from "./access";
import { createRateLimiter } from "./rateLimit";
import type { ActionResult } from "./action-result";
import { getLang } from "./lang";
import { localizeMessage } from "./actionMessages";

const attempts = createRateLimiter(8, 10 * 60_000);

export async function unlock(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const code = accessCode();
  const next = safeNext(String(formData.get("next") ?? ""));
  if (!code) redirect(next);

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const limit = attempts(ip);
  const lang = await getLang();
  if (!limit.allowed) {
    return { ok: false, error: localizeMessage(`Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} min.`, lang) };
  }

  const given = Buffer.from(String(formData.get("code") ?? "").trim());
  const expected = Buffer.from(code);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, error: localizeMessage("That access code isn't right.", lang) };
  }
  (await cookies()).set(ACCESS_COOKIE, await accessToken(code), {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
  });
  redirect(next);
}
