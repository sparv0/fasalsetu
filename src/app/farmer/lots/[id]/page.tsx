import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { analyseLot } from "@/lib/decision";
import { buyerMatchesForLot } from "@/lib/match";
import { acceptOffer, bookStorage, cancelStorage, counterOffer, rejectOffer, uploadLotMedia, withdrawLot } from "@/lib/actions";
import { hoursLeft, lotAcceptsOffers } from "@/lib/engine/states";
import { MARKET_CHARGES_PCT, MEDIA_MAX_PER_LOT, type Commodity } from "@/lib/engine/config";
import { QUALITY_PARAMS } from "@/lib/engine/quality";
import { districtPoint, roadDistanceKm } from "@/lib/engine/logistics";
import { expireStaleOffers, poolPayouts, storageAlerts } from "@/lib/marketplace";
import { dateTime, inr } from "@/lib/format";
import { getT } from "@/lib/lang";
import { commodityName, gradeName, locale, paramName, perQt, qtyL, statusName } from "@/lib/i18n";
import ActionForm from "@/components/ActionForm";
import { Badge, Card, Empty, SectionTitle, StatusBadge, inlineInputClass, inputClass, labelClass } from "@/components/ui";
import Timeline from "@/components/Timeline";
import { aiEnabled } from "@/lib/ai/gemini";
import { adviseOffer, analysePhoto, explainLot } from "@/lib/ai/actions";
import type { PhotoAssessment } from "@/lib/ai/assess";
import { AiTextPanel, OfferAdvicePanel, PhotoAnalyseButton } from "@/components/ai/AiPanels";

export default async function LotDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser("FARMER", "FPO");
  const { t, lang } = await getT();
  await expireStaleOffers();

  const lot = await prisma.lot.findUnique({
    where: { id },
    include: {
      offers: { include: { buyer: true, order: true }, orderBy: { createdAt: "desc" } },
      orders: { include: { buyer: true }, orderBy: { createdAt: "desc" } },
      media: { orderBy: { createdAt: "asc" } },
      contributedTo: { include: { poolLot: { include: { farmer: true } } } },
      storageBookings: { where: { status: "ACTIVE" }, include: { facility: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!lot || lot.farmerId !== user.id) notFound();

  const open = lotAcceptsOffers(lot.status);
  const [analysis, matches, events, alerts, pool, facilities] = await Promise.all([
    open ? analyseLot(lot.id, lang) : Promise.resolve(null),
    open ? buyerMatchesForLot(lot, lang) : Promise.resolve([]),
    prisma.auditEvent.findMany({ where: { lotId: lot.id }, include: { actor: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    open && user.role === "FARMER" ? storageAlerts(user.id, lang) : Promise.resolve([]),
    lot.isPool ? poolPayouts(lot.id) : lot.contributedTo ? poolPayouts(lot.contributedTo.poolLotId) : Promise.resolve(null),
    open ? prisma.storageFacility.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const here = districtPoint(lot.district);
  const storageOptions = facilities
    .filter((f) => f.commodities.split(",").includes(lot.commodity) && f.availableQt > 0)
    .map((f) => ({ ...f, distanceKm: roadDistanceKm(here, { lat: f.lat, lng: f.lng }) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const stored = lot.storageBookings.reduce((s, b) => s + b.quantityQt, 0);
  const measured: Record<string, number> | null = lot.qualityParams && !lot.isPool ? JSON.parse(lot.qualityParams) : null;
  const paramDefs = QUALITY_PARAMS[lot.commodity as Commodity] ?? [];
  const myShare = pool?.shares.find((s) => s.farmerId === user.id);
  const ai = aiEnabled();
  const crop = commodityName(lot.commodity, lang);
  const pq = perQt(lang);

  const activeOffers = lot.offers.filter((o) => o.status === "PENDING" || o.status === "COUNTERED");
  const pastOffers = lot.offers.filter((o) => o.status !== "PENDING" && o.status !== "COUNTERED");
  const reasonsFor = (buyerId: string, stored: string): string[] => matches.find((m) => m.buyerId === buyerId)?.reasons ?? JSON.parse(stored);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={user.role === "FPO" ? "/fpo" : "/farmer"} className="text-xs text-emerald-700">
            ← {user.role === "FPO" ? t("FPO dashboard", "एफपीओ डैशबोर्ड") : t("My lots", "मेरे लॉट")}
          </Link>
          <h1 className="text-2xl font-bold text-emerald-900 mt-1">
            {crop} · {t("Grade", "ग्रेड")} {gradeName(lot.qualityGrade, lang)}
          </h1>
          <p className="text-stone-600 text-sm">
            {t(
              `${qtyL(lot.availableQt, lang)} available of ${qtyL(lot.quantityQt, lang)}`,
              `${qtyL(lot.quantityQt, lang)} में से ${qtyL(lot.availableQt, lang)} उपलब्ध`
            )}{" "}
            · {lot.district} · {t("harvested", "कटाई")} {lot.harvestDate.toLocaleDateString(locale(lang))}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <StatusBadge status={lot.status} />
            {lot.isPool && <Badge tone="sky">{t(`Pooled lot · ${pool?.shares.length ?? 0} farmers`, `पूल लॉट · ${pool?.shares.length ?? 0} किसान`)}</Badge>}
            <Badge tone={lot.qualityParams ? "emerald" : "stone"}>
              {lot.qualityParams ? t("measured quality", "मापी गई गुणवत्ता") : t("self-declared quality", "स्वयं बताई गुणवत्ता")}
            </Badge>
            {stored > 0 && <Badge tone="amber">{t(`${qtyL(stored, lang)} in storage`, `${qtyL(stored, lang)} गोदाम में`)}</Badge>}
          </div>
        </div>
        {open && (
          <ActionForm
            action={withdrawLot}
            hidden={{ lotId: lot.id }}
            submitLabel={
              lot.isPool && lot.orders.length === 0
                ? t("Dissolve pool", "पूल भंग करें")
                : t("Withdraw remaining quantity", "बची मात्रा वापस लें")
            }
            pendingLabel={t("Withdrawing…", "वापस ले रहे हैं…")}
            variant="secondary"
          />
        )}
      </div>

      {!open && (
        <Card className="bg-stone-100">
          {lot.status === "SOLD"
            ? t("This lot is fully sold. See the orders below.", "यह लॉट पूरा बिक गया है। नीचे ऑर्डर देखें।")
            : lot.status === "POOLED" && lot.contributedTo
              ? t(
                  `This lot is pooled into ${lot.contributedTo.poolLot.farmer.name}'s ${lot.commodity} lot (${qtyL(lot.contributedTo.poolLot.quantityQt, lang)} total). The FPO sells it; you receive your pro-rata share${myShare ? ` — ${myShare.sharePct.toFixed(1)}%: ${inr(myShare.settled)} received, ${inr(myShare.pending)} pending` : ""}.`,
                  `यह लॉट ${lot.contributedTo.poolLot.farmer.name} के ${crop} पूल (कुल ${qtyL(lot.contributedTo.poolLot.quantityQt, lang)}) में है। एफपीओ इसे बेचता है; आपको मात्रा के अनुसार हिस्सा मिलता है${myShare ? ` — ${myShare.sharePct.toFixed(1)}%: ${inr(myShare.settled)} मिला, ${inr(myShare.pending)} बाकी` : ""}।`
                )
              : t("This lot has been withdrawn from the market.", "यह लॉट बाज़ार से वापस ले लिया गया है।")}
        </Card>
      )}

      {analysis && (
        <section className="bg-emerald-900 text-white rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="font-semibold text-emerald-200 uppercase text-xs tracking-wide">{t("SmartSell recommendation", "स्मार्टसेल सलाह")}</h2>
            {analysis.best && <StatusBadge status={analysis.best.confidence} />}
          </div>
          <p className="text-lg leading-snug">{analysis.recommendation}</p>
          {analysis.best && (
            <ul className="mt-3 text-sm text-emerald-100 list-disc list-inside space-y-1">
              {analysis.best.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <AiTextPanel run={explainLot.bind(null, lot.id)} label={t("Explain this in my language", "मेरी भाषा में समझाएँ")} tone="dark" enabled={ai} />
          </div>
          {alerts.length > 0 && lot.commodity === "Onion" && (
            <div className="mt-3 bg-amber-400/20 border border-amber-300/40 rounded-lg p-3 text-sm text-amber-100">
              <strong className="text-amber-200">{t("Field Nigrani signal:", "फ़ील्ड निगरानी संकेत:")}</strong>
              <ul className="list-disc list-inside">
                {alerts.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
              <span className="text-xs">{t("This leans toward selling sooner rather than storing.", "इसका मतलब: रखने के बजाय जल्दी बेचना बेहतर है।")}</span>
            </div>
          )}
        </section>
      )}

      <section>
        <SectionTitle
          title={t("Quality evidence", "गुणवत्ता का सबूत")}
          hint={t(
            "What buyers see. Measured lots are graded by platform rules; photos are checked by file content and fingerprinted.",
            "यही खरीदार देखते हैं। मापे गए लॉट का ग्रेड प्लेटफ़ॉर्म के नियमों से तय होता है; फ़ोटो की जाँच और फ़िंगरप्रिंट होता है।"
          )}
        />
        <Card>
          {measured ? (
            <dl className="grid grid-cols-3 gap-3 text-sm">
              {paramDefs.map((d) => (
                <div key={d.key}>
                  <dt className="text-xs text-stone-500">{paramName(d.label, lang)}</dt>
                  <dd className="font-medium">
                    {measured[d.key]} {d.unit}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-stone-600">
              {lot.isPool
                ? t("Pooled lot — graded at the lowest contributed grade.", "पूल लॉट — सबसे कम ग्रेड के आधार पर ग्रेड तय।")
                : t("Grade is self-declared (no measurements recorded).", "ग्रेड स्वयं बताया गया है (कोई माप दर्ज नहीं)।")}
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            {lot.media.map((m) => {
              const a: PhotoAssessment | null = m.aiAssessment ? JSON.parse(m.aiAssessment) : null;
              return (
                <div key={m.id} className="flex gap-3 border border-stone-100 rounded-lg p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/media/${m.id}`}
                    alt={t(`${lot.commodity} lot quality photo`, `${crop} लॉट की फ़ोटो`)}
                    className="w-28 h-28 object-cover rounded-lg border border-stone-200 shrink-0"
                  />
                  <div className="text-xs space-y-1 min-w-0">
                    {a ? (
                      <>
                        <div className="flex flex-wrap gap-1">
                          {a.matchesLot && a.grade ? (
                            <Badge tone="sky">{t(`AI estimate: grade ${a.grade}`, `एआई अनुमान: ग्रेड ${gradeName(a.grade, lang)}`)}</Badge>
                          ) : (
                            <Badge tone="rose">
                              {a.matchesLot
                                ? t("photo unclear", "फ़ोटो साफ़ नहीं")
                                : t(`looks like ${a.detectedCommodity}, not ${lot.commodity}`, `यह ${commodityName(a.detectedCommodity, lang)} लगता है, ${crop} नहीं`)}
                            </Badge>
                          )}
                          <Badge>{t(`${a.confidence.toLowerCase()} confidence`, `${statusName(a.confidence, lang)} भरोसा`)}</Badge>
                        </div>
                        {a.matchesLot && (
                          <div className="text-stone-600">
                            {paramDefs.map((d) => `${paramName(d.label, lang)} ≈ ${a.estimates[d.key]}${d.unit === "%" ? "%" : ` ${d.unit}`}`).join(" · ")}
                          </div>
                        )}
                        <ul className="list-disc list-inside text-stone-500">
                          {a.observations.map((o, i) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="text-stone-500">{ai ? t("Not analysed yet.", "अभी जाँच नहीं हुई।") : t("AI grading needs a Gemini key.", "एआई ग्रेडिंग के लिए Gemini कुंजी चाहिए।")}</p>
                    )}
                    {open && <PhotoAnalyseButton run={analysePhoto.bind(null, m.id)} enabled={ai} again={Boolean(a)} />}
                  </div>
                </div>
              );
            })}
          </div>
          {open && lot.media.length < MEDIA_MAX_PER_LOT && (
            <div className="mt-3">
              <ActionForm
                action={uploadLotMedia}
                hidden={{ lotId: lot.id }}
                submitLabel={t("Upload photo", "फ़ोटो अपलोड करें")}
                pendingLabel={t("Uploading…", "अपलोड हो रहा है…")}
                variant="secondary"
                resetOnSuccess
                encType="multipart/form-data"
              >
                <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required aria-label={t("Quality photo", "गुणवत्ता फ़ोटो")} className="text-sm" />
              </ActionForm>
              <p className="text-xs text-stone-400 mt-1">
                {t(
                  `JPEG/PNG/WebP, up to 3 MB, ${MEDIA_MAX_PER_LOT} photos per lot.`,
                  `JPEG/PNG/WebP, अधिकतम 3 MB, हर लॉट पर ${MEDIA_MAX_PER_LOT} फ़ोटो।`
                )}
                {ai && t(" Gemini vision grades each photo automatically.", " Gemini हर फ़ोटो का ग्रेड अपने आप जाँचता है।")}
              </p>
            </div>
          )}
        </Card>
      </section>

      {lot.isPool && pool && (
        <section>
          <SectionTitle
            title={t("Pool members & payout split", "पूल सदस्य और कमाई का बँटवारा")}
            hint={t("Proceeds from this lot are split by contributed quantity.", "इस लॉट की कमाई दी गई मात्रा के अनुसार बाँटी जाती है।")}
          />
          <div className="overflow-x-auto border border-stone-200 rounded-xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-stone-600 text-left text-xs">
                <tr>
                  <th className="p-2">{t("Farmer", "किसान")}</th>
                  <th className="p-2">{t("Contributed", "दिया")}</th>
                  <th className="p-2">{t("Share", "हिस्सा")}</th>
                  <th className="p-2">{t("Received", "मिला")}</th>
                  <th className="p-2">{t("Pending", "बाकी")}</th>
                </tr>
              </thead>
              <tbody>
                {pool.shares.map((s) => (
                  <tr key={s.memberLotId} className="border-t border-stone-100">
                    <td className="p-2">{s.farmerName}</td>
                    <td className="p-2">{qtyL(s.quantityQt, lang)}</td>
                    <td className="p-2">{s.sharePct.toFixed(1)}%</td>
                    <td className="p-2">{inr(s.settled)}</td>
                    <td className="p-2">{inr(s.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {analysis?.storage && (
        <section>
          <SectionTitle
            title={t("Sell now or store?", "अभी बेचें या रखें?")}
            hint={t(
              "Projection uses a straight-line trend over the last 30 days of DEMO prices — an estimate, not a promise.",
              "अनुमान पिछले 30 दिन के नमूना भावों के सीधे रुझान पर आधारित है — यह अनुमान है, वादा नहीं।"
            )}
          />
          <Card>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-medium">{t("Verdict:", "फ़ैसला:")}</span>
              <Badge tone={analysis.storage.verdict === "STORE" ? "amber" : "emerald"}>
                {analysis.storage.verdict === "STORE"
                  ? t(`Store ${analysis.storage.best?.days} days`, `${analysis.storage.best?.days} दिन रखें`)
                  : t("Sell now", "अभी बेचें")}
              </Badge>
            </div>
            <p className="text-sm text-stone-700">{analysis.storage.reason}</p>
            {analysis.storage.facility && analysis.storage.scenarios.length > 0 && (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead className="text-left text-stone-500 text-xs">
                    <tr>
                      <th className="py-1 pr-3">{t("Scenario", "विकल्प")}</th>
                      <th className="py-1 pr-3">{t("Projected price", "अनुमानित भाव")}</th>
                      <th className="py-1 pr-3">{t("Storage + handling", "भंडारण + ढुलाई-लदाई")}</th>
                      <th className="py-1 pr-3">{t("Net", "शुद्ध")}</th>
                      <th className="py-1">{t("vs. sell now", "अभी बेचने की तुलना में")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-stone-100">
                      <td className="py-1.5 pr-3">
                        {t("Sell now", "अभी बेचें")} ({analysis.bestMandi?.label})
                      </td>
                      <td className="py-1.5 pr-3">
                        {inr(analysis.bestMandi?.pricePerQt ?? 0)}
                        {pq}
                      </td>
                      <td className="py-1.5 pr-3">—</td>
                      <td className="py-1.5 pr-3 font-semibold">{inr(analysis.storage.sellNowNet)}</td>
                      <td className="py-1.5">—</td>
                    </tr>
                    {analysis.storage.scenarios.map((s) => {
                      const diff = s.netTotal - analysis.storage!.sellNowNet;
                      return (
                        <tr key={s.days} className="border-t border-stone-100">
                          <td className="py-1.5 pr-3">{t(`Store ${s.days}d → ${s.marketName}`, `${s.days} दिन रखें → ${s.marketName}`)}</td>
                          <td className="py-1.5 pr-3">
                            {inr(s.forecastPrice)}
                            {pq}{" "}
                            <span className="text-xs text-stone-400">
                              ({inr(s.forecastLow)}–{inr(s.forecastHigh)}, {statusName(s.trendConfidence, lang).toLowerCase()})
                            </span>
                          </td>
                          <td className="py-1.5 pr-3">{inr(s.storageCost)}</td>
                          <td className="py-1.5 pr-3 font-semibold">{inr(s.netTotal)}</td>
                          <td className={`py-1.5 ${diff >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {diff >= 0 ? "+" : "−"}
                            {inr(Math.abs(diff))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-xs text-stone-500 mt-2">
                  {t(
                    `Storage at ${analysis.storage.facility.name} (${analysis.storage.facility.distanceKm} km, ₹${analysis.storage.facility.costPerQtPerDay.toFixed(2)}/qt/day). Includes weight loss in storage and transport farm → store → market.`,
                    `भंडारण: ${analysis.storage.facility.name} (${analysis.storage.facility.distanceKm} किमी, ₹${analysis.storage.facility.costPerQtPerDay.toFixed(2)}/क्विंटल/दिन)। इसमें गोदाम में सूखत और खेत → गोदाम → मंडी की ढुलाई शामिल है।`
                  )}
                </p>
              </div>
            )}
          </Card>
        </section>
      )}

      {open && (
        <section>
          <SectionTitle
            title={t("Book storage", "भंडारण बुक करें")}
            hint={t(
              "Mock provider: a booking reserves capacity as a platform record. Stored stock stays on the market.",
              "नमूना सेवा: बुकिंग से प्लेटफ़ॉर्म पर जगह आरक्षित होती है। गोदाम में रखा माल भी बिक्री के लिए उपलब्ध रहता है।"
            )}
          />
          {lot.storageBookings.length > 0 && (
            <div className="space-y-2 mb-3">
              {lot.storageBookings.map((b) => (
                <Card key={b.id} className="flex flex-wrap justify-between items-center gap-2">
                  <span className="text-sm">
                    {t(
                      `${qtyL(b.quantityQt, lang)} at ${b.facility.name} for ${b.days} days from ${b.startDate.toLocaleDateString("en-IN")} · est. ${inr(b.costEstimate)}`,
                      `${qtyL(b.quantityQt, lang)} — ${b.facility.name} में ${b.days} दिन, ${b.startDate.toLocaleDateString("hi-IN")} से · अनुमानित ${inr(b.costEstimate)}`
                    )}
                  </span>
                  <ActionForm
                    action={cancelStorage}
                    hidden={{ bookingId: b.id }}
                    submitLabel={t("Cancel", "रद्द करें")}
                    pendingLabel={t("Cancelling…", "रद्द कर रहे हैं…")}
                    variant="secondary"
                  />
                </Card>
              ))}
            </div>
          )}
          {storageOptions.length === 0 ? (
            <Empty>{t(`No facility near you currently stores ${lot.commodity}.`, `आपके पास अभी कोई गोदाम ${crop} नहीं रखता।`)}</Empty>
          ) : lot.availableQt - stored <= 0 ? (
            <Empty>{t("All available quantity is already in storage.", "पूरी उपलब्ध मात्रा पहले से गोदाम में है।")}</Empty>
          ) : (
            <Card>
              <ActionForm
                action={bookStorage}
                hidden={{ lotId: lot.id }}
                submitLabel={t("Book storage", "भंडारण बुक करें")}
                pendingLabel={t("Booking…", "बुक कर रहे हैं…")}
                className="grid sm:grid-cols-4 gap-3 items-end"
              >
                <label className={labelClass}>
                  {t("Facility", "गोदाम")}
                  <select name="facilityId" className={inputClass}>
                    {storageOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} · {f.distanceKm} {t("km", "किमी")} · ₹{f.costPerQtPerDay.toFixed(2)}
                        {t("/qt/day", "/क्विंटल/दिन")} · {t(`${qtyL(f.availableQt, lang)} free`, `${qtyL(f.availableQt, lang)} खाली`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  {t("Quantity (qt)", "मात्रा (क्विंटल)")}
                  <input
                    name="quantityQt"
                    type="number"
                    min={0.1}
                    step="0.1"
                    max={lot.availableQt - stored}
                    defaultValue={lot.availableQt - stored}
                    required
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("Days", "दिन")}
                  <input name="days" type="number" min={1} max={180} defaultValue={14} required className={inputClass} />
                </label>
              </ActionForm>
            </Card>
          )}
        </section>
      )}

      {analysis && (
        <section>
          <SectionTitle
            title={t("All selling options, ranked by net realisation", "बिक्री के सभी विकल्प — शुद्ध कमाई के क्रम में")}
            hint={t(
              `Mandi options deduct transport (cheapest vehicle plan) and ${(MARKET_CHARGES_PCT * 100).toFixed(0)}% market charges. Buyer offers are farm-gate: the buyer pays pickup.`,
              `मंडी विकल्पों में ढुलाई (सबसे सस्ता वाहन) और ${(MARKET_CHARGES_PCT * 100).toFixed(0)}% मंडी शुल्क घटाया गया है। खरीदार के ऑफ़र खेत पर हैं: भाड़ा खरीदार देता है।`
            )}
          />
          <div className="overflow-x-auto border border-stone-200 rounded-xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-stone-600 text-left text-xs">
                <tr>
                  <th className="p-2">{t("Option", "विकल्प")}</th>
                  <th className="p-2">{t("Price", "भाव")}</th>
                  <th className="p-2">{t("Distance", "दूरी")}</th>
                  <th className="p-2">{t("Transport", "ढुलाई")}</th>
                  <th className="p-2">{t("Charges", "शुल्क")}</th>
                  <th className="p-2">{t("Net / qt", "शुद्ध / क्विंटल")}</th>
                  <th className="p-2">{t("Net total", "कुल शुद्ध")}</th>
                  <th className="p-2">{t("Confidence", "भरोसा")}</th>
                </tr>
              </thead>
              <tbody>
                {analysis.options.map((o, i) => (
                  <tr key={o.kind + o.id} className={i === 0 ? "bg-emerald-50" : "border-t border-stone-100"}>
                    <td className="p-2">
                      <div className="font-medium">
                        {o.label} {i === 0 && <span className="text-emerald-700 text-xs">{t("★ best", "★ सबसे अच्छा")}</span>}
                      </div>
                      <div className="text-xs text-stone-500">
                        {o.kind === "MANDI"
                          ? t(`Mandi · ${o.district}`, `मंडी · ${o.district}`)
                          : t(`Buyer offer · ${qtyL(o.quantityQt, lang)}`, `खरीदार का ऑफ़र · ${qtyL(o.quantityQt, lang)}`)}
                        {o.freshnessDays !== null && o.freshnessDays > 1 && t(` · data ${o.freshnessDays}d old`, ` · डेटा ${o.freshnessDays} दिन पुराना`)}
                      </div>
                    </td>
                    <td className="p-2">{inr(o.pricePerQt)}</td>
                    <td className="p-2">{o.distanceKm !== null ? `${o.distanceKm} ${t("km", "किमी")}` : t("farm gate", "खेत पर")}</td>
                    <td className="p-2">{o.transport ? inr(o.transport.total) : "—"}</td>
                    <td className="p-2">{o.charges > 0 ? inr(o.charges) : "—"}</td>
                    <td className="p-2 font-semibold">{inr(o.netPerQt)}</td>
                    <td className="p-2">{inr(o.netTotal)}</td>
                    <td className="p-2">
                      <StatusBadge status={o.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <SectionTitle
          title={t("Offers", "ऑफ़र")}
          hint={t("Accept to create an order, counter with a higher price, or reject.", "स्वीकार करने पर ऑर्डर बनेगा, ज़्यादा भाव माँगें, या अस्वीकार करें।")}
        />
        {activeOffers.length === 0 && <Empty>{t("No open offers right now.", "अभी कोई खुला ऑफ़र नहीं।")}</Empty>}
        <div className="space-y-3">
          {activeOffers.map((o) => {
            const reasons = reasonsFor(o.buyerId, o.matchReasons);
            const fits = o.quantityQt <= lot.availableQt;
            return (
              <Card key={o.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {o.buyer.name}{" "}
                      <Badge tone={o.buyer.verified ? "emerald" : "rose"}>{o.buyer.verified ? t("verified", "सत्यापित") : t("not verified", "असत्यापित")}</Badge>
                    </div>
                    <div className="text-sm text-stone-700 mt-0.5">
                      {inr(o.pricePerQt)}
                      {pq} × {qtyL(o.quantityQt, lang)} = <strong>{inr(o.pricePerQt * o.quantityQt)}</strong>
                      {o.matchScore > 0 && <span className="text-stone-500"> · {t(`match ${o.matchScore}/100`, `मेल ${o.matchScore}/100`)}</span>}
                      <span className="text-stone-500"> · {t(`expires in ${hoursLeft(o.expiresAt)}h`, `${hoursLeft(o.expiresAt)} घंटे में समाप्त`)}</span>
                    </div>
                    <ul className="text-xs text-stone-500 mt-1 list-disc list-inside">
                      {reasons.slice(0, 3).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                  <StatusBadge status={o.status} />
                </div>

                {o.status === "COUNTERED" && (
                  <p className="text-sm text-amber-800 mt-2">
                    {t(
                      `You countered at ${inr(o.counterPricePerQt ?? 0)}/qt — waiting for the buyer to accept or decline.`,
                      `आपने ${inr(o.counterPricePerQt ?? 0)}/क्विंटल का जवाबी भाव दिया — खरीदार के जवाब का इंतज़ार है।`
                    )}
                  </p>
                )}

                {o.status === "PENDING" && !fits && (
                  <p className="text-sm text-rose-700 mt-2">
                    {t(
                      `This offer is for more than the ${qtyL(lot.availableQt, lang)} still available.`,
                      `यह ऑफ़र बची हुई ${qtyL(lot.availableQt, lang)} से ज़्यादा मात्रा के लिए है।`
                    )}
                  </p>
                )}

                {o.status === "PENDING" && <OfferAdvicePanel run={adviseOffer.bind(null, o.id)} enabled={ai} />}

                {o.status === "PENDING" && (
                  <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-stone-100">
                    {fits && (
                      <ActionForm action={acceptOffer} hidden={{ offerId: o.id }} submitLabel={t("Accept", "स्वीकार करें")} pendingLabel={t("Accepting…", "स्वीकार कर रहे हैं…")} />
                    )}
                    <ActionForm
                      action={counterOffer}
                      hidden={{ offerId: o.id }}
                      submitLabel={t("Counter", "जवाबी भाव")}
                      pendingLabel={t("Sending…", "भेज रहे हैं…")}
                      variant="warning"
                    >
                      <input
                        name="counterPricePerQt"
                        type="number"
                        min={1}
                        step="1"
                        required
                        placeholder={`₹${pq}`}
                        aria-label={t("Counter price per quintal", "जवाबी भाव प्रति क्विंटल")}
                        defaultValue={Math.round(Math.max(o.pricePerQt * 1.05, analysis?.bestMandi?.netPerQt ?? 0))}
                        className={inlineInputClass}
                      />
                    </ActionForm>
                    <ActionForm
                      action={rejectOffer}
                      hidden={{ offerId: o.id }}
                      submitLabel={t("Reject", "अस्वीकार करें")}
                      pendingLabel={t("Rejecting…", "अस्वीकार कर रहे हैं…")}
                      variant="secondary"
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        {pastOffers.length > 0 && (
          <details className="mt-3">
            <summary className="text-sm text-stone-600 cursor-pointer">{t(`Past offers (${pastOffers.length})`, `पुराने ऑफ़र (${pastOffers.length})`)}</summary>
            <div className="space-y-1 mt-2">
              {pastOffers.map((o) => (
                <div key={o.id} className="flex justify-between text-sm bg-white border border-stone-200 rounded-lg px-3 py-2">
                  <span>
                    {o.buyer.name} · {inr(o.order?.agreedPrice ?? o.pricePerQt)}
                    {pq} × {qtyL(o.quantityQt, lang)}
                  </span>
                  <StatusBadge status={o.status} />
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {open && (
        <section>
          <SectionTitle
            title={t("Buyers looking for this", "इसके खरीदार")}
            hint={t("Posted buyer demand for this commodity, scored against your lot.", "इस फ़सल के लिए दर्ज खरीदारों की माँग, आपके लॉट से मिलान करके।")}
          />
          {matches.length === 0 ? (
            <Empty>{t(`No buyer has posted demand for ${lot.commodity} yet.`, `अभी किसी खरीदार ने ${crop} की माँग दर्ज नहीं की है।`)}</Empty>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {matches.slice(0, 6).map((m) => (
                <Card key={m.demandId}>
                  <div className="flex justify-between items-center gap-2">
                    <span className="font-medium">{m.buyerName}</span>
                    <Badge tone={m.score >= 70 ? "emerald" : m.score >= 45 ? "amber" : "stone"}>{t(`Match ${m.score}/100`, `मेल ${m.score}/100`)}</Badge>
                  </div>
                  <div className="text-sm text-stone-600">
                    {t(
                      `Wants ${qtyL(m.quantityWantedQt, lang)} · grade ${m.qualityMin}+ · ~${inr(m.pricePerQt)}/qt · within ${m.deliveryDays} days`,
                      `चाहिए ${qtyL(m.quantityWantedQt, lang)} · ग्रेड ${gradeName(m.qualityMin, lang)}+ · ~${inr(m.pricePerQt)}/क्विंटल · ${m.deliveryDays} दिन में`
                    )}
                  </div>
                  <ul className="text-xs text-stone-500 mt-1 list-disc list-inside">
                    {m.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {lot.orders.length > 0 && (
        <section>
          <SectionTitle title={t("Orders from this lot", "इस लॉट के ऑर्डर")} />
          <div className="space-y-2">
            {lot.orders.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="block">
                <Card className="flex flex-wrap justify-between items-center gap-2 hover:border-emerald-400">
                  <span className="text-sm">
                    {o.buyer.name} · {qtyL(o.quantityQt, lang)} @ {inr(o.agreedPrice)}
                    {pq} · {dateTime(o.createdAt, lang)}
                  </span>
                  <StatusBadge status={o.status} />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle title={t("Activity log", "गतिविधि रिकॉर्ड")} />
        <Timeline events={events} />
      </section>
    </div>
  );
}
