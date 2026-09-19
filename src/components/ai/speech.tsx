"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../I18nProvider";

const noSubscribe = () => () => {};
function useBrowserSupport(check: () => boolean) {
  return useSyncExternalStore(noSubscribe, check, () => false);
}
const hasSynthesis = () => "speechSynthesis" in window;
const hasRecognition = () => {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
};

export const SPEECH_LANG = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" } as const;
export type UiLang = keyof typeof SPEECH_LANG;

export function currentLang(): UiLang {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)fs_lang=(en|hi|mr)/);
  return (m?.[1] as UiLang) ?? "en";
}

function stripForSpeech(text: string) {
  return text.replace(/[*_#`•]/g, " ").replace(/₹\s?/g, "₹ ").replace(/\s+/g, " ").trim();
}

export function SpeakButton({ text, className = "" }: { text: string; className?: string }) {
  const t = useT();
  const [speaking, setSpeaking] = useState(false);
  const supported = useBrowserSupport(hasSynthesis);
  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);
  if (!supported) return null;
  return (
    <button
      type="button"
      className={`text-xs px-2 py-1 rounded-md border border-current/30 hover:bg-black/5 ${className}`}
      onClick={() => {
        const synth = window.speechSynthesis;
        if (speaking) {
          synth.cancel();
          setSpeaking(false);
          return;
        }
        const u = new SpeechSynthesisUtterance(stripForSpeech(text));
        u.lang = SPEECH_LANG[currentLang()];
        const voice = synth.getVoices().find((v) => v.lang === u.lang) ?? synth.getVoices().find((v) => v.lang.startsWith(u.lang.slice(0, 2)));
        if (voice) u.voice = voice;
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        synth.cancel();
        synth.speak(u);
        setSpeaking(true);
      }}
      aria-label={speaking ? t("Stop reading aloud", "पढ़ना बंद करें") : t("Read aloud", "सुनें")}
    >
      {speaking ? t("■ Stop", "■ रोकें") : t("🔊 Listen", "🔊 सुनें")}
    </button>
  );
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

export function MicButton({ onText, className = "" }: { onText: (text: string) => void; className?: string }) {
  const t = useT();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = useBrowserSupport(hasRecognition);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  if (!supported) return null;

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => {
          if (listening) {
            rec.current?.stop();
            return;
          }
          const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
          const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition)!;
          const r = new Ctor();
          r.lang = SPEECH_LANG[currentLang()];
          r.interimResults = false;
          r.continuous = false;
          r.onresult = (e) => {
            const text = Array.from(e.results)
              .map((res) => res[0]?.transcript ?? "")
              .join(" ")
              .trim();
            if (text) onText(text);
          };
          r.onerror = (e) => {
            console.error("Speech recognition error:", e.error);
            setError(
              e.error === "not-allowed"
                ? t("Microphone permission denied.", "माइक्रोफ़ोन की अनुमति नहीं मिली।")
                : `${t("Couldn't hear that — try again.", "सुनाई नहीं दिया — फिर से बोलें।")} [${e.error}]`
            );
          };
          r.onend = () => setListening(false);
          rec.current = r;
          setError(null);
          setListening(true);
          r.start();
        }}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium ${listening ? "bg-rose-600 text-white animate-pulse" : "bg-stone-200 text-stone-800 hover:bg-stone-300"} ${className}`}
        aria-label={listening ? t("Stop listening", "सुनना बंद करें") : t("Speak", "बोलें")}
      >
        {listening ? t("● Listening…", "● सुन रहे हैं…") : t("🎤 Speak", "🎤 बोलें")}
      </button>
      {error && <span className="text-[11px] text-rose-700 mt-0.5">{error}</span>}
    </span>
  );
}
