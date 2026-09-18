import { cookies } from "next/headers";
import { makeT, type T, type UiLang } from "./i18n";

export const LANG_COOKIE = "fs_lang";

export async function getLang(): Promise<UiLang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return v === "hi" || v === "mr" ? v : "en";
}

export async function getT(): Promise<{ t: T; lang: UiLang }> {
  const lang = await getLang();
  return { t: makeT(lang), lang };
}
