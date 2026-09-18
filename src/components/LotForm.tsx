"use client";

import { useState, useTransition } from "react";
import ActionForm from "./ActionForm";
import { createLot } from "@/lib/actions";
import { COMMODITIES, QUALITY_GRADES, type Commodity } from "@/lib/engine/config";
import { QUALITY_PARAMS, gradeFromParams, parseQualityParams } from "@/lib/engine/quality";
import { parseLotText } from "@/lib/ai/actions";
import { MicButton } from "./ai/speech";
import { useLang } from "./I18nProvider";
import { commodityName, gradeName, makeT, paramName } from "@/lib/i18n";

const input = "mt-1 block w-full border border-stone-300 rounded-lg px-2 py-1.5 text-sm bg-white";
const label = "text-xs font-medium text-stone-600";

export default function LotForm({ today, ai }: { today: string; ai: boolean }) {
  const lang = useLang();
  const t = makeT(lang);
  const [commodity, setCommodity] = useState<Commodity>("Onion");
  const [measured, setMeasured] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState("");
  const [harvest, setHarvest] = useState(today);
  const [grade, setGrade] = useState("B");
  const [description, setDescription] = useState("");
  const [aiNote, setAiNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiPending, startAi] = useTransition();

  const tr = t;
  const fillFromText = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setDescription(t);
    startAi(async () => {
      const r = await parseLotText(t).catch(() => ({ ok: false as const, error: tr("Couldn't reach the server.", "सर्वर से संपर्क नहीं हो पाया।") }));
      if (!r.ok) {
        setAiNote({ ok: false, text: r.error });
        return;
      }
      const d = r.data;
      const filled: string[] = [];
      if (d.commodity) {
        setCommodity(d.commodity as Commodity);
        filled.push(commodityName(d.commodity, lang));
      }
      if (d.quantityQt) {
        setQuantity(String(d.quantityQt));
        filled.push(tr(`${d.quantityQt} qt`, `${d.quantityQt} क्विंटल`));
      }
      if (d.harvestDate) {
        setHarvest(d.harvestDate);
        filled.push(tr(`harvested ${d.harvestDate}`, `कटाई ${d.harvestDate}`));
      }
      const hasMeasurements = d.commodity && Object.keys(d.measurements).length === QUALITY_PARAMS[d.commodity as Commodity].length;
      if (hasMeasurements) {
        setMeasured(true);
        setValues(Object.fromEntries(Object.entries(d.measurements).map(([k, v]) => [k, String(v)])));
        filled.push(tr("quality measurements", "गुणवत्ता माप"));
      } else {
        setValues({});
        if (d.qualityGrade) {
          setMeasured(false);
          setGrade(d.qualityGrade);
          filled.push(tr(`grade ${d.qualityGrade}`, `ग्रेड ${gradeName(d.qualityGrade, lang)}`));
        }
      }
      setAiNote(
        filled.length
          ? {
              ok: true,
              text: tr(
                `Filled: ${filled.join(", ")}. Check the fields, then press Create lot.`,
                `भरा गया: ${filled.join(", ")}। जाँच लें, फिर "लॉट बनाएँ" दबाएँ।`
              ),
            }
          : {
              ok: false,
              text: tr(
                "Couldn't find lot details in that — mention crop, quantity and when it was harvested.",
                "इसमें लॉट की जानकारी नहीं मिली — फ़सल, मात्रा और कटाई कब हुई, यह बताएँ।"
              ),
            }
      );
    });
  };

  const defs = QUALITY_PARAMS[commodity];
  const filled = defs.filter((d) => (values[d.key] ?? "").trim() !== "").length;
  const parsed = measured && filled === defs.length ? parseQualityParams(commodity, values) : { params: null };
  const preview = parsed.params ? gradeFromParams(commodity, parsed.params) : null;

  return (
    <ActionForm
      action={createLot}
      submitLabel={t("Create lot", "लॉट बनाएँ")}
      pendingLabel={t("Creating…", "बना रहे हैं…")}
      resetOnSuccess
      onSuccess={() => {
        setValues({});
        setQuantity("");
        setHarvest(today);
        setDescription("");
        setAiNote(null);
      }}
      className="space-y-3"
    >
      {ai && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
          <p className="text-xs font-medium text-violet-900 mb-1.5">
            {t(
              "✨ Describe your lot by voice or text — AI fills the form (English, हिंदी, मराठी)",
              "✨ अपना लॉट बोलकर या लिखकर बताएँ — एआई फ़ॉर्म भर देगा (हिंदी, मराठी, English)"
            )}
          </p>
          <div className="flex flex-wrap gap-2 items-start">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  fillFromText(description);
                }
              }}
              maxLength={600}
              placeholder={t("e.g. 120 quintal kanda, kal kaata, size 50mm, 2% kharab", "जैसे: 120 क्विंटल प्याज, कल काटा, आकार 50mm, 2% खराब")}
              className="flex-1 min-w-48 border border-violet-300 rounded-lg px-2 py-1.5 text-sm bg-white"
              aria-label={t("Describe your lot", "अपना लॉट बताएँ")}
            />
            <MicButton onText={fillFromText} />
            <button
              type="button"
              disabled={aiPending || !description.trim()}
              onClick={() => fillFromText(description)}
              className="bg-violet-600 text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {aiPending ? t("Reading…", "पढ़ रहे हैं…") : t("Fill form", "फ़ॉर्म भरें")}
            </button>
          </div>
          {aiNote && <p className={`text-xs mt-1.5 ${aiNote.ok ? "text-violet-800" : "text-rose-700"}`}>{aiNote.text}</p>}
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className={label}>
          {t("Commodity", "फ़सल")}
          <select
            name="commodity"
            value={commodity}
            onChange={(e) => {
              setCommodity(e.target.value as Commodity);
              setValues({});
            }}
            className={input}
          >
            {COMMODITIES.map((c) => (
              <option key={c} value={c}>
                {commodityName(c, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t("Quantity (quintal)", "मात्रा (क्विंटल)")}
          <input
            type="number"
            name="quantityQt"
            min={0.1}
            step="0.1"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={input}
          />
        </label>
        <label className={label}>
          {t("Harvest date", "कटाई की तारीख")}
          <input type="date" name="harvestDate" required max={today} value={harvest} onChange={(e) => setHarvest(e.target.value)} className={input} />
        </label>
      </div>

      <fieldset className="border border-stone-200 rounded-lg p-3">
        <legend className="text-xs font-medium text-stone-600 px-1">{t("Quality", "गुणवत्ता")}</legend>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={measured} onChange={(e) => setMeasured(e.target.checked)} />
          {t("I have measurements — grade it for me (buyers see “measured”)", "मेरे पास माप हैं — ग्रेड आप तय करें (खरीदार को “मापा गया” दिखेगा)")}
        </label>
        {measured ? (
          <div className="grid sm:grid-cols-3 gap-3">
            {defs.map((d) => (
              <label key={d.key} className={label}>
                {paramName(d.label, lang)} ({d.unit})
                <input
                  type="number"
                  name={d.key}
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  required
                  value={values[d.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))}
                  className={input}
                />
              </label>
            ))}
          </div>
        ) : (
          <label className={label}>
            {t("Self-declared grade", "स्वयं बताया ग्रेड")}
            <select name="qualityGrade" value={grade} onChange={(e) => setGrade(e.target.value)} className={`${input} sm:w-48`}>
              {QUALITY_GRADES.map((g) => (
                <option key={g} value={g}>
                  {gradeName(g, lang)}
                </option>
              ))}
            </select>
          </label>
        )}
        {measured && (
          <p className="text-xs mt-2 text-stone-600" aria-live="polite">
            {"error" in parsed && parsed.error
              ? parsed.error
              : preview
                ? t(
                    `These measurements earn grade ${preview.grade}${preview.limitedBy.length ? ` (held back by ${preview.limitedBy.join(", ").toLowerCase()})` : ""}.`,
                    `इन मापों से ग्रेड ${gradeName(preview.grade, lang)} मिलता है${preview.limitedBy.length ? ` (${preview.limitedBy.map((l) => paramName(l, lang)).join(", ")} के कारण)` : ""}।`
                  )
                : t(`Enter all ${defs.length} measurements to see the grade.`, `ग्रेड देखने के लिए सभी ${defs.length} माप डालें।`)}
          </p>
        )}
      </fieldset>
    </ActionForm>
  );
}
