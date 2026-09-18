"use client";

import { createContext, useContext } from "react";
import { makeT, statusName, type UiLang } from "@/lib/i18n";

const LangContext = createContext<UiLang>("en");

export function I18nProvider({ lang, children }: { lang: UiLang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): UiLang {
  return useContext(LangContext);
}

export function useT() {
  return makeT(useContext(LangContext));
}

const TONES: Record<string, string> = {
  sky: "bg-sky-100 text-sky-800",
  amber: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-100 text-emerald-800",
  rose: "bg-rose-100 text-rose-800",
  stone: "bg-stone-200 text-stone-700",
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  OPEN: "sky",
  PENDING: "sky",
  CREATED: "sky",
  BOOKED: "sky",
  INITIATED: "amber",
  PARTIALLY_SOLD: "amber",
  COUNTERED: "amber",
  LOGISTICS_BOOKED: "amber",
  IN_TRANSIT: "amber",
  PAYMENT_INITIATED: "amber",
  MEDIUM: "amber",
  POOLED: "sky",
  SOLD: "emerald",
  ACCEPTED: "emerald",
  DELIVERED: "emerald",
  PAID: "emerald",
  COMPLETED: "emerald",
  RESOLVED: "emerald",
  CLOSED: "emerald",
  HIGH: "emerald",
  VERIFIED: "emerald",
  REJECTED: "rose",
  EXPIRED: "rose",
  LOW: "rose",
  UNVERIFIED: "rose",
  WITHDRAWN: "stone",
};

// Client so it can read the language from context wherever a server page renders it.
export function StatusBadge({ status }: { status: string }) {
  const lang = useLang();
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${TONES[STATUS_TONE[status] ?? "stone"]}`}>
      {statusName(status, lang)}
    </span>
  );
}
