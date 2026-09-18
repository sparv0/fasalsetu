"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { askAssistant } from "@/lib/ai/actions";
import { MicButton, SpeakButton } from "./speech";
import { useT } from "../I18nProvider";

type Msg = { role: "user" | "model"; text: string };

export default function AssistantChat({ suggestions, enabled, greeting }: { suggestions: string[]; enabled: boolean; greeting: string }) {
  const t = useT();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const next: Msg[] = [...messages, { role: "user", text: q.slice(0, 1500) }];
    setMessages(next);
    setInput("");
    setError(null);
    start(async () => {
      const r = await askAssistant({ messages: next.slice(-20) }).catch(() => ({
        ok: false as const,
        error: t("Couldn't reach the server.", "सर्वर से संपर्क नहीं हो पाया।"),
      }));
      if (r.ok) setMessages((m) => [...m, { role: "model", text: r.data }]);
      else {
        setError(r.error);
        setMessages((m) => m.slice(0, -1));
        setInput(q);
      }
    });
  };

  return (
    <div className="bg-white border border-stone-200 rounded-xl flex flex-col h-[70vh] min-h-[420px]">
      <div className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm max-w-[85%]">{greeting}</div>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`rounded-lg p-3 text-sm max-w-[85%] whitespace-pre-line ${m.role === "user" ? "bg-emerald-700 text-white" : "bg-stone-100 text-stone-900"}`}
            >
              {m.text}
              {m.role === "model" && (
                <div className="mt-2">
                  <SpeakButton text={m.text} />
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && <div className="text-sm text-stone-500">{t("✨ Kisan Sahayak is thinking…", "✨ किसान सहायक सोच रहा है…")}</div>}
        <div ref={endRef} />
      </div>

      {messages.length === 0 && enabled && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="text-xs border border-violet-300 text-violet-800 rounded-full px-3 py-1 hover:bg-violet-50">
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="px-4 text-xs text-rose-700">{error}</p>}

      <form
        className="border-t border-stone-200 p-3 flex gap-2 items-start"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          maxLength={1500}
          disabled={!enabled}
          placeholder={
            enabled
              ? t("Ask in English, हिंदी or मराठी — e.g. 'Where should I sell my onion?'", "हिंदी, मराठी या English में पूछें — जैसे 'मेरा प्याज कहाँ बेचूँ?'")
              : t("The assistant turns on once a Gemini API key is configured.", "Gemini API कुंजी जोड़ते ही सहायक चालू हो जाएगा।")
          }
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm resize-none disabled:bg-stone-100"
          aria-label={t("Message", "संदेश")}
        />
        <div className="flex flex-col gap-1">
          {enabled && <MicButton onText={(spoken) => send(spoken)} />}
          <button type="submit" disabled={!enabled || pending || !input.trim()} className="bg-violet-600 text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-50">
            {t("Send", "भेजें")}
          </button>
        </div>
      </form>
    </div>
  );
}
