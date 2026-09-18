"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

const OPTIONS = [
  { code: "en", label: "EN" },
  { code: "hi", label: "हिं" },
  { code: "mr", label: "मरा" },
] as const;

export default function LanguageToggle({ current }: { current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex rounded-md overflow-hidden border border-emerald-700 text-xs" role="group" aria-label="AI language">
      {OPTIONS.map((o) => (
        <button
          key={o.code}
          type="button"
          disabled={pending}
          onClick={() => {
            document.cookie = `fs_lang=${o.code}; path=/; max-age=31536000; samesite=lax`;
            start(() => router.refresh());
          }}
          className={`px-2 py-0.5 ${current === o.code ? "bg-emerald-600 text-white" : "text-emerald-100 hover:bg-emerald-800"}`}
          aria-pressed={current === o.code}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
