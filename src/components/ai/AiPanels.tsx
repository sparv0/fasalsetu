"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AiResult, OfferAdvice, Triage } from "@/lib/ai/actions";
import type { PhotoAssessment } from "@/lib/ai/assess";
import { SpeakButton } from "./speech";
import { useT } from "../I18nProvider";

function useAi<T>(run: () => Promise<AiResult<T>>) {
  const tr = useT();
  const [result, setResult] = useState<AiResult<T> | null>(null);
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      try {
        setResult(await run());
      } catch {
        setResult({ ok: false, error: tr("Couldn't reach the server. Please try again.", "सर्वर से संपर्क नहीं हो पाया। फिर से कोशिश करें।") });
      }
    });
  return { result, pending, go };
}

function AiButton({ onClick, pending, label, tone = "light" }: { onClick: () => void; pending: boolean; label: string; tone?: "light" | "dark" }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-60 disabled:cursor-wait ${tone === "dark" ? "bg-white/15 text-white hover:bg-white/25 border border-white/30" : "bg-violet-600 text-white hover:bg-violet-700"}`}
    >
      {pending ? t("✨ Thinking…", "✨ सोच रहे हैं…") : `✨ ${label}`}
    </button>
  );
}

export function AiTextPanel({
  run,
  label,
  tone = "light",
  enabled,
}: {
  run: () => Promise<AiResult<string>>;
  label: string;
  tone?: "light" | "dark";
  enabled: boolean;
}) {
  const t = useT();
  const { result, pending, go } = useAi(run);
  if (!enabled) return <AiOff tone={tone} />;
  return (
    <div>
      <AiButton onClick={go} pending={pending} label={result?.ok ? t("Ask again", "फिर से पूछें") : label} tone={tone} />
      {result && !result.ok && <p className={`text-xs mt-2 ${tone === "dark" ? "text-rose-200" : "text-rose-700"}`}>{result.error}</p>}
      {result?.ok && (
        <div className={`mt-2 rounded-lg p-3 text-sm whitespace-pre-line ${tone === "dark" ? "bg-white/10 text-white" : "bg-violet-50 border border-violet-200 text-stone-800"}`}>
          {result.data}
          <div className="mt-2 flex items-center gap-2">
            <SpeakButton text={result.data} />
            <span className="text-[11px] opacity-70">
              {t("AI-generated from platform data — check the numbers above before acting.", "प्लेटफ़ॉर्म डेटा से एआई द्वारा लिखा गया — कदम उठाने से पहले ऊपर के आँकड़े जाँच लें।")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function AiOff({ tone = "light" }: { tone?: "light" | "dark" }) {
  const t = useT();
  return (
    <p className={`text-xs ${tone === "dark" ? "text-emerald-200" : "text-stone-500"}`}>
      {t("✨ AI features switch on once a Gemini API key is configured.", "✨ Gemini API कुंजी जोड़ते ही एआई सुविधाएँ चालू हो जाएँगी।")}
    </p>
  );
}

const ACTION_NAME: Record<OfferAdvice["action"], [string, string]> = {
  ACCEPT: ["ACCEPT", "स्वीकार करें"],
  COUNTER: ["COUNTER", "जवाबी भाव दें"],
  REJECT: ["REJECT", "अस्वीकार करें"],
  WAIT: ["WAIT", "इंतज़ार करें"],
};

const ACTION_STYLE: Record<OfferAdvice["action"], string> = {
  ACCEPT: "bg-emerald-100 text-emerald-800",
  COUNTER: "bg-amber-100 text-amber-800",
  REJECT: "bg-rose-100 text-rose-800",
  WAIT: "bg-stone-200 text-stone-700",
};

export function OfferAdvicePanel({ run, enabled }: { run: () => Promise<AiResult<OfferAdvice>>; enabled: boolean }) {
  const t = useT();
  const { result, pending, go } = useAi(run);
  if (!enabled) return null;
  return (
    <div className="mt-3">
      <AiButton onClick={go} pending={pending} label={t("AI negotiation advice", "एआई मोलभाव सलाह")} />
      {result && !result.ok && <p className="text-xs text-rose-700 mt-1">{result.error}</p>}
      {result?.ok && (
        <div className="mt-2 rounded-lg p-3 bg-violet-50 border border-violet-200 text-sm">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ACTION_STYLE[result.data.action]}`}>
              {t(...ACTION_NAME[result.data.action])}
            </span>
            {result.data.counterPricePerQt > 0 && (
              <span className="text-sm">
                {t("Suggested counter:", "सुझाया जवाबी भाव:")} <strong>₹{result.data.counterPricePerQt.toLocaleString("en-IN")}/{t("qt", "क्विंटल")}</strong>{" "}
                {t("(enter it in the Counter box)", "(इसे जवाबी भाव वाले बॉक्स में डालें)")}
              </span>
            )}
          </div>
          <p>{result.data.reasoning}</p>
          {result.data.risks.length > 0 && (
            <ul className="list-disc list-inside text-xs text-stone-600 mt-1">
              {result.data.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <div className="mt-2">
            <SpeakButton text={result.data.reasoning} />
          </div>
        </div>
      )}
    </div>
  );
}

const SEVERITY: Record<Triage["severity"], string> = {
  LOW: "bg-emerald-100 text-emerald-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  HIGH: "bg-rose-100 text-rose-800",
};

export function TriagePanel({ run, enabled }: { run: () => Promise<AiResult<Triage>>; enabled: boolean }) {
  const { result, pending, go } = useAi(run);
  const [copied, setCopied] = useState(false);
  const t = useT();
  if (!enabled) return <AiOff />;
  return (
    <div className="mt-3">
      <AiButton onClick={go} pending={pending} label={t("AI triage & suggested resolution", "एआई जाँच और सुझाया समाधान")} />
      {result && !result.ok && <p className="text-xs text-rose-700 mt-1">{result.error}</p>}
      {result?.ok && (
        <div className="mt-2 rounded-lg p-3 bg-violet-50 border border-violet-200 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SEVERITY[result.data.severity]}`}>{t(`${result.data.severity} severity`, `गंभीरता: ${{ LOW: "कम", MEDIUM: "मध्यम", HIGH: "उच्च" }[result.data.severity]}`)}
            </span>
          </div>
          <p>
            <strong>{t("Summary:", "सार:")}</strong> {result.data.summary}
          </p>
          <p>
            <strong>{t("Likely cause:", "संभावित कारण:")}</strong> {result.data.likelyCause}
          </p>
          <p>
            <strong>{t("Suggested resolution:", "सुझाया समाधान:")}</strong> {result.data.suggestedResolution}
          </p>
          {result.data.evidenceToRequest.length > 0 && (
            <p className="text-xs text-stone-600">
              {t("Evidence to request:", "माँगे जाने वाले सबूत:")} {result.data.evidenceToRequest.join("; ")}
            </p>
          )}
          <button
            type="button"
            className="text-xs underline text-violet-700"
            onClick={() => {
              navigator.clipboard?.writeText(result.data.suggestedResolution).then(() => setCopied(true));
            }}
          >
            {copied
              ? t("Copied — paste into the resolution note", "कॉपी हो गया — समाधान नोट में पेस्ट करें")
              : t("Copy suggested resolution", "सुझाया समाधान कॉपी करें")}
          </button>
        </div>
      )}
    </div>
  );
}

export function PhotoAnalyseButton({ run, enabled, again }: { run: () => Promise<AiResult<PhotoAssessment>>; enabled: boolean; again: boolean }) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!enabled) return null;
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await run().catch(() => ({ ok: false as const, error: t("Couldn't reach the server.", "सर्वर से संपर्क नहीं हो पाया।") }));
            if (!r.ok) setError(r.error);
            else {
              setError(null);
              router.refresh();
            }
          })
        }
        className="text-[11px] px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {pending ? t("Analysing…", "जाँच रहे हैं…") : again ? t("✨ Re-check", "✨ फिर से जाँचें") : t("✨ AI grade", "✨ एआई ग्रेड")}
      </button>
      {error && <span className="text-[11px] text-rose-700 max-w-28">{error}</span>}
    </span>
  );
}
