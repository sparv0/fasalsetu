import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { marketBoard } from "@/lib/decision";
import { COMMODITIES } from "@/lib/engine/config";
import { districtPoint, roadDistanceKm } from "@/lib/engine/logistics";
import { inr, pct } from "@/lib/format";
import { getT } from "@/lib/lang";
import { commodityName, perQt } from "@/lib/i18n";
import { Card, Empty, SectionTitle, Sparkline, StatusBadge } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/gemini";
import { marketBrief } from "@/lib/ai/actions";
import { AiTextPanel } from "@/components/ai/AiPanels";

export default async function MarketsPage({ searchParams }: { searchParams: Promise<{ commodity?: string }> }) {
  const user = await requirePageUser();
  const { t, lang } = await getT();
  const pq = perQt(lang);
  const { commodity } = await searchParams;
  const selected = COMMODITIES.find((c) => c === commodity) ?? "Onion";

  const [rows, markets] = await Promise.all([marketBoard(selected), prisma.market.findMany()]);
  const here = districtPoint(user.district);
  const distanceTo = new Map(markets.map((m) => [m.id, roadDistanceKm(here, { lat: m.lat, lng: m.lng })]));

  const avg = rows.length ? rows.reduce((s, r) => s + r.modal, 0) / rows.length : 0;
  const top = rows[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{t("PricePulse", "मंडी भाव (PricePulse)")}</h1>
        <p className="text-stone-600 text-sm">
          {t(
            "Latest mandi prices, arrivals and 30-day trends. Source: seeded DEMO/SAMPLE data — not live AGMARKNET/e-NAM figures.",
            "ताज़ा मंडी भाव, आवक और 30 दिन का रुझान। स्रोत: नमूना (DEMO) डेटा — यह AGMARKNET/e-NAM के लाइव आँकड़े नहीं हैं।"
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {COMMODITIES.map((c) => (
          <Link
            key={c}
            href={`/markets?commodity=${c}`}
            className={`px-3 py-1 rounded-full border ${selected === c ? "bg-emerald-700 text-white border-emerald-700" : "bg-white border-stone-300"}`}
          >
            {commodityName(c, lang)}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>{t(`No price data for ${selected}.`, `${commodityName(selected, lang)} का कोई भाव डेटा नहीं।`)}</Empty>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            <Card>
              <div className="text-xs text-stone-500">{t("Highest modal price", "सबसे ऊँचा मॉडल भाव")}</div>
              <div className="text-xl font-bold text-emerald-800">
                {inr(top.modal)}
                {pq}
              </div>
              <div className="text-xs text-stone-500">{top.marketName}</div>
            </Card>
            <Card>
              <div className="text-xs text-stone-500">{t(`Average across ${rows.length} markets`, `${rows.length} मंडियों का औसत`)}</div>
              <div className="text-xl font-bold text-emerald-800">
                {inr(avg)}
                {pq}
              </div>
              <div className="text-xs text-stone-500">
                {t("Spread", "अंतर")} {inr(top.modal - rows[rows.length - 1].modal)}
                {pq}
              </div>
            </Card>
            <Card>
              <div className="text-xs text-stone-500">{t("Highest price ≠ best deal", "सबसे ऊँचा भाव ≠ सबसे अच्छा सौदा")}</div>
              <div className="text-sm text-stone-700 mt-1">
                {t(
                  "Transport and charges change the answer. Open one of your lots to see net realisation per market.",
                  "ढुलाई और शुल्क से जवाब बदल जाता है। हर मंडी में शुद्ध कमाई देखने के लिए अपना लॉट खोलें।"
                )}
              </div>
            </Card>
          </div>

          <Card className="border-violet-200">
            <h2 className="font-semibold text-sm mb-2">{t(`AI market brief — ${selected}`, `एआई बाज़ार सार — ${commodityName(selected, lang)}`)}</h2>
            <AiTextPanel
              key={selected}
              run={marketBrief.bind(null, selected)}
              label={t(`Summarise the ${selected} market`, `${commodityName(selected, lang)} बाज़ार का सार बताएँ`)}
              enabled={aiEnabled()}
            />
          </Card>

          <section>
            <SectionTitle
              title={t(`${selected} — all markets`, `${commodityName(selected, lang)} — सभी मंडियाँ`)}
              hint={t(
                "7-day projection is a linear trend with a ~90% band; treat LOW confidence as noise.",
                "7 दिन का अनुमान सीधे रुझान और ~90% दायरे पर आधारित है; कम भरोसे वाले अनुमान को अनदेखा करें।"
              )}
            />
            <div className="overflow-x-auto border border-stone-200 rounded-xl bg-white">
              <table className="w-full text-sm">
                <thead className="bg-stone-100 text-stone-600 text-left text-xs">
                  <tr>
                    <th className="p-2">{t("Market", "मंडी")}</th>
                    <th className="p-2">{t("Modal", "मॉडल भाव")}</th>
                    <th className="p-2">{t("Min–max", "न्यूनतम–अधिकतम")}</th>
                    <th className="p-2">{t("Arrivals", "आवक")}</th>
                    <th className="p-2">{t("7d", "7 दिन")}</th>
                    <th className="p-2">{t("30d", "30 दिन")}</th>
                    <th className="p-2">{t("Trend", "रुझान")}</th>
                    <th className="p-2">{t("7-day projection", "7 दिन का अनुमान")}</th>
                    <th className="p-2">{t("From you", "आपसे दूरी")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.marketId} className="border-t border-stone-100">
                      <td className="p-2">
                        <div className="font-medium">{r.marketName}</div>
                        <div className="text-xs text-stone-500">
                          {r.district} · {r.freshnessDays === 0 ? t("today", "आज") : t(`${r.freshnessDays}d old`, `${r.freshnessDays} दिन पुराना`)}
                        </div>
                      </td>
                      <td className="p-2 font-semibold">{inr(r.modal)}</td>
                      <td className="p-2 text-stone-600">
                        {inr(r.min)}–{inr(r.max)}
                      </td>
                      <td className="p-2">
                        {Math.round(r.arrivalsQt)} {t("qt", "क्विंटल")}
                      </td>
                      <td className={`p-2 ${(r.change7d ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{pct(r.change7d)}</td>
                      <td className={`p-2 ${(r.change30d ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{pct(r.change30d)}</td>
                      <td className="p-2">
                        <Sparkline values={r.series} />
                      </td>
                      <td className="p-2">
                        {r.forecast7d ? (
                          <div>
                            {inr(r.forecast7d.value)}{" "}
                            {r.trendConfidence && <StatusBadge status={r.trendConfidence} />}
                            <div className="text-xs text-stone-400">
                              {inr(r.forecast7d.low)}–{inr(r.forecast7d.high)}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-2">
                        {distanceTo.get(r.marketId)} {t("km", "किमी")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
