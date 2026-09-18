import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { updateProfile } from "@/lib/actions";
import { DISTRICTS } from "@/lib/engine/config";
import { SCHEME_RULES_VERSION, suggestSchemes } from "@/lib/engine/schemes";
import ActionForm from "@/components/ActionForm";
import { Card, Empty, SectionTitle, inputClass, labelClass } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/gemini";
import { explainSchemes } from "@/lib/ai/actions";
import { AiTextPanel } from "@/components/ai/AiPanels";
import { getT } from "@/lib/lang";

export default async function SchemesPage() {
  const user = await requirePageUser("FARMER", "FPO");
  const { t, lang } = await getT();
  const lots = await prisma.lot.findMany({ where: { farmerId: user.id }, select: { commodity: true, quantityQt: true } });

  const suggestions = suggestSchemes({
    role: user.role === "FPO" ? "FPO" : "FARMER",
    state: user.state,
    landAcres: user.landAcres,
    socialCategory: user.socialCategory,
    commodities: [...new Set(lots.map((l) => l.commodity))],
    inFpo: Boolean(user.fpoId),
    largestLotQt: Math.max(0, ...lots.map((l) => l.quantityQt)),
  }, lang);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{t("Maha-Subsidy recommender", "महा-सब्सिडी सलाहकार")}</h1>
        <p className="text-stone-600 text-sm">
          {t("Schemes that may be relevant to your profile, with where to check them.", "आपकी प्रोफ़ाइल से जुड़ी संभावित योजनाएँ, और उन्हें कहाँ जाँचें।")}
        </p>
      </div>

      <Card className="bg-amber-50 border-amber-200 text-sm text-amber-900">
        {t(
          `These are suggestions from a rule catalogue (${SCHEME_RULES_VERSION}), not an eligibility decision. The rules have not been verified against official notifications. Always confirm on the official portal or with your agriculture office before applying.`,
          `ये नियम-सूची (${SCHEME_RULES_VERSION}) से सुझाव हैं, पात्रता का फ़ैसला नहीं। नियमों की आधिकारिक अधिसूचना से जाँच नहीं हुई है। आवेदन से पहले हमेशा आधिकारिक पोर्टल या कृषि कार्यालय से पुष्टि करें।`
        )}
      </Card>

      <section>
        <SectionTitle title={t("Your profile", "आपकी प्रोफ़ाइल")} hint={t("Used only to pick suggestions.", "केवल सुझाव चुनने के लिए उपयोग होती है।")} />
        <Card>
          <ActionForm action={updateProfile} submitLabel={t("Save profile", "प्रोफ़ाइल सहेजें")} pendingLabel={t("Saving…", "सहेज रहे हैं…")} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <label className={labelClass}>
              {t("Land (acres)", "ज़मीन (एकड़)")}
              <input name="landAcres" type="number" min={0} step="0.1" required defaultValue={user.landAcres ?? ""} className={inputClass} />
            </label>
            <label className={labelClass}>
              {t("Category", "श्रेणी")}
              <select name="socialCategory" defaultValue={user.socialCategory ?? "GENERAL"} className={inputClass}>
                {["GENERAL", "OBC", "SC", "ST"].map((c) => (
                  <option key={c} value={c}>
                    {c === "GENERAL" ? t("General", "सामान्य") : c}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t("District", "ज़िला")}
              <select name="district" defaultValue={user.district} className={inputClass}>
                {DISTRICTS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          </ActionForm>
        </Card>
      </section>

      <section>
        <SectionTitle title={t(`${suggestions.length} suggestion(s)`, `${suggestions.length} सुझाव`)} />
        {suggestions.length > 0 && (
          <Card className="mb-3 border-violet-200">
            <AiTextPanel run={explainSchemes} label={t("Explain which to apply for first (in my language)", "पहले किसके लिए आवेदन करें — मेरी भाषा में समझाएँ")} enabled={aiEnabled()} />
          </Card>
        )}
        {suggestions.length === 0 ? (
          <Empty>{t("Add your land and crops to get suggestions.", "सुझाव पाने के लिए अपनी ज़मीन और फ़सल जोड़ें।")}</Empty>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {suggestions.map((s) => (
              <Card key={s.id}>
                <h3 className="font-semibold">{s.name}</h3>
                <p className="text-sm text-stone-700 mt-1">{s.summary}</p>
                <ul className="text-xs text-stone-500 mt-2 list-disc list-inside">
                  {s.why.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <p className="text-xs text-stone-700 mt-2">{s.howToCheck}</p>
                {s.link && (
                  <a href={s.link} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-emerald-700 underline mt-1">
                    {t("Official source ↗", "आधिकारिक स्रोत ↗")}
                  </a>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
