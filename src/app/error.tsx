"use client";

import { useEffect } from "react";
import { useT } from "@/components/I18nProvider";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-md mx-auto text-center py-16">
      <h1 className="text-xl font-bold text-emerald-900">{t("Something went wrong", "कुछ गड़बड़ हो गई")}</h1>
      <p className="text-stone-600 mt-2 text-sm">
        {t(
          "The page couldn't load. Your data is safe — try again, or switch user from the top bar.",
          "पेज नहीं खुल पाया। आपका डेटा सुरक्षित है — फिर से कोशिश करें, या ऊपर से यूज़र बदलें।"
        )}
      </p>
      {error.digest && (
        <p className="text-xs text-stone-400 mt-2">
          {t("Reference", "संदर्भ")}: {error.digest}
        </p>
      )}
      <button onClick={() => retry()} className="mt-4 bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm">
        {t("Try again", "फिर से कोशिश करें")}
      </button>
    </div>
  );
}
