import { requirePageUser } from "@/lib/session";
import { getT } from "@/lib/lang";
import { commodityName, perQt, qtyL, statusName } from "@/lib/i18n";
import { COMMODITIES } from "@/lib/engine/config";
import { computeFayda, faydaSchema, type FaydaInput } from "@/lib/fayda";
import { inr } from "@/lib/format";
import { Badge, Card, SectionTitle, inputClass, labelClass } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/gemini";
import { explainFayda } from "@/lib/ai/actions";
import { AiTextPanel } from "@/components/ai/AiPanels";

type Search = Partial<Record<keyof FaydaInput, string>>;

export default async function FaydaPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePageUser("FARMER");
  const { t, lang } = await getT();
  const pq = perQt(lang);
  const sp = await searchParams;
  const submitted = Object.keys(sp).length > 0;
  const parsed = submitted ? faydaSchema.safeParse(sp) : null;
  const input = parsed?.success ? parsed.data : null;

  const report = input ? await computeFayda(input, user.district, lang) : null;
  const result = report?.result ?? null;
  const reference = report?.reference ?? null;
  const noData = Boolean(input) && !report;

  const v = (k: keyof Search, fallback: string) => sp[k] ?? fallback;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{t("Fayda forecast", "फ़ायदा अनुमान")}</h1>
        <p className="text-stone-600 text-sm">
          {t(
            "Profit scenarios for your next harvest, from your own yield and cost inputs plus market prices. These are scenario estimates — there is no validated farm-yield model behind them, so yield and cost are yours to enter.",
            "अगली फ़सल के मुनाफ़े के अनुमान — आपकी अपनी उपज और लागत तथा मंडी भाव से। ये केवल अनुमान हैं — इनके पीछे कोई प्रमाणित उपज मॉडल नहीं है, इसलिए उपज और लागत आप खुद डालें।"
          )}
        </p>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
          <label className={labelClass}>
            {t("Crop", "फ़सल")}
            <select name="commodity" defaultValue={v("commodity", "Onion")} className={inputClass}>
              {COMMODITIES.map((c) => (
                <option key={c} value={c}>
                  {commodityName(c, lang)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("Area (acres)", "क्षेत्र (एकड़)")}
            <input name="areaAcres" type="number" step="0.1" min={0.1} required defaultValue={v("areaAcres", String(user.landAcres ?? ""))} className={inputClass} />
          </label>
          <label className={labelClass}>
            {t("Your yield (qt/acre)", "आपकी उपज (क्विंटल/एकड़)")}
            <input name="yieldQtPerAcre" type="number" step="0.1" min={0.1} required defaultValue={v("yieldQtPerAcre", "")} className={inputClass} />
          </label>
          <label className={labelClass}>
            {t("Cost / acre (₹)", "लागत / एकड़ (₹)")}
            <input name="costPerAcre" type="number" step="100" min={0} required defaultValue={v("costPerAcre", "")} className={inputClass} />
          </label>
          <label className={labelClass}>
            {t("Harvest in (days)", "कटाई कितने दिन में")}
            <input name="harvestInDays" type="number" min={0} max={240} required defaultValue={v("harvestInDays", "20")} className={inputClass} />
          </label>
          <button className="bg-emerald-700 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-emerald-800 h-9">{t("Calculate", "हिसाब लगाएँ")}</button>
        </form>
        {parsed && !parsed.success && (
          <p role="alert" className="text-xs text-rose-700 mt-2">
            {parsed.error.issues[0]?.message}
          </p>
        )}
      </Card>

      {noData && <Card>{t("No market data for this crop — no estimate shown.", "इस फ़सल का बाज़ार डेटा नहीं — कोई अनुमान नहीं दिखाया गया।")}</Card>}

      {result && reference && input && (
        <section>
          <SectionTitle
            title={t(`${qtyL(result.quantityQt, lang)} expected from ${input.areaAcres} acres`, `${input.areaAcres} एकड़ से ${qtyL(result.quantityQt, lang)} अपेक्षित`)}
            hint={t(
              `Price source: ${reference.source}. Selling costs assume ${reference.market} (best net market for you today): ${inr(reference.deductionPerQt)}/qt for transport and market charges.`,
              `भाव का स्रोत: ${reference.source}। बिक्री लागत ${reference.market} (आज आपके लिए सबसे अच्छी मंडी) के अनुसार: ढुलाई और मंडी शुल्क ${inr(reference.deductionPerQt)}/क्विंटल।`
            )}
          />
          <div className="overflow-x-auto border border-stone-200 rounded-xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-stone-600 text-left text-xs">
                <tr>
                  <th className="p-2">{t("Scenario", "स्थिति")}</th>
                  <th className="p-2">{t("Price", "भाव")}</th>
                  <th className="p-2">{t("Revenue", "कुल बिक्री")}</th>
                  <th className="p-2">{t("Selling costs", "बिक्री खर्च")}</th>
                  <th className="p-2">{t("Cultivation cost", "खेती की लागत")}</th>
                  <th className="p-2">{t("Profit", "मुनाफ़ा")}</th>
                  <th className="p-2">{t("Per acre", "प्रति एकड़")}</th>
                </tr>
              </thead>
              <tbody>
                {result.scenarios.map((s) => (
                  <tr key={s.label} className="border-t border-stone-100">
                    <td className="p-2 font-medium">{s.label}</td>
                    <td className="p-2">
                      {inr(s.price)}
                      {pq}
                    </td>
                    <td className="p-2">{inr(s.revenue)}</td>
                    <td className="p-2">{inr(s.deductions)}</td>
                    <td className="p-2">{inr(s.cultivationCost)}</td>
                    <td className={`p-2 font-semibold ${s.profit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{inr(s.profit)}</td>
                    <td className="p-2">{inr(s.profitPerAcre)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
            <span>
              {t("Break-even price:", "बराबरी (नो-लॉस) भाव:")}{" "}
              <strong>
                {inr(result.breakevenPricePerQt)}
                {pq}
              </strong>
            </span>
            {reference.confidence && (
              <Badge tone={reference.confidence === "HIGH" ? "emerald" : "amber"}>
                {t(`trend confidence ${reference.confidence.toLowerCase()}`, `रुझान पर भरोसा: ${statusName(reference.confidence, lang)}`)}
              </Badge>
            )}
          </div>
          <Card className="mt-4 border-violet-200">
            <AiTextPanel run={explainFayda.bind(null, input)} label={t("Explain these numbers & what to do", "इन आँकड़ों का मतलब और आगे क्या करें")} enabled={aiEnabled()} />
          </Card>
        </section>
      )}
    </div>
  );
}
