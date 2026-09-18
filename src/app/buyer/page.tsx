import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { matchForBuyer } from "@/lib/match";
import { acceptCounter, createDemand, deleteDemand, rejectCounter, sendOffer, withdrawOffer } from "@/lib/actions";
import { COMMODITIES, QUALITY_GRADES } from "@/lib/engine/config";
import { availableOrderActions, hoursLeft, isActiveOffer } from "@/lib/engine/states";
import { expireStaleOffers } from "@/lib/marketplace";
import { aiEnabled } from "@/lib/ai/gemini";
import { adviseBuy } from "@/lib/ai/actions";
import type { PhotoAssessment } from "@/lib/ai/assess";
import { AiTextPanel } from "@/components/ai/AiPanels";
import { inr } from "@/lib/format";
import { getT } from "@/lib/lang";
import { commodityName, gradeName, orderActionName, perQt, qtyL, statusName } from "@/lib/i18n";
import ActionForm from "@/components/ActionForm";
import { Badge, Card, Empty, SectionTitle, Stat, StatusBadge, inlineInputClass, inputClass, labelClass } from "@/components/ui";

export default async function BuyerDashboard({ searchParams }: { searchParams: Promise<{ commodity?: string }> }) {
  const user = await requirePageUser("BUYER");
  const { t, lang } = await getT();
  const pq = perQt(lang);
  const { commodity } = await searchParams;
  const filter = COMMODITIES.find((c) => c === commodity) ?? null;
  await expireStaleOffers();

  const [lots, demands, offers, orders] = await Promise.all([
    prisma.lot.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_SOLD"] }, ...(filter ? { commodity: filter } : {}) },
      include: { farmer: true, media: { select: { id: true, aiAssessment: true }, take: 3 }, _count: { select: { poolParts: true } } },
    }),
    prisma.buyerDemand.findMany({ where: { buyerId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.offer.findMany({
      where: { buyerId: user.id },
      include: { lot: { include: { farmer: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.order.findMany({ where: { buyerId: user.id }, include: { lot: true, farmer: true }, orderBy: { updatedAt: "desc" } }),
  ]);

  const views = await Promise.all(lots.map(async (lot) => ({ lot, view: await matchForBuyer(lot, user, lang) })));
  views.sort((a, b) => {
    if (a.view.hasDemand !== b.view.hasDemand) return a.view.hasDemand ? -1 : 1;
    if (a.view.hasDemand && b.view.hasDemand) return b.view.score - a.view.score;
    return a.view.distanceKm - b.view.distanceKm;
  });

  const activeOfferByLot = new Map(
    offers.filter((o) => isActiveOffer(o.status)).map((o) => [o.lotId, o])
  );
  const countered = offers.filter((o) => o.status === "COUNTERED");
  const ai = aiEnabled();
  const aiGrade = (media: { aiAssessment: string | null }[]) => {
    const a = media.map((m) => (m.aiAssessment ? (JSON.parse(m.aiAssessment) as PhotoAssessment) : null)).find((x) => x?.matchesLot && x.grade);
    return a ? `${gradeName(a.grade!, lang)} (${statusName(a.confidence, lang).toLowerCase()})` : null;
  };
  const activeOrders = orders.filter((o) => o.status !== "CLOSED");
  const ordersNeedingMe = activeOrders.filter((o) => availableOrderActions(o.status, "BUYER").length > 0);
  const spent = orders.filter((o) => o.status === "PAID" || o.status === "CLOSED").reduce((s, o) => s + o.agreedPrice * o.quantityQt, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{user.name}</h1>
        <p className="text-stone-600 text-sm">
          {t(`${user.district} district`, `${user.district} ज़िला`)} · {t("Buyer", "खरीदार")} ·{" "}
          {user.verified ? t("verified", "सत्यापित") : t("not verified — farmers see this on your offers", "असत्यापित — किसान आपके ऑफ़र पर यह देखते हैं")}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t("Posted demands", "दर्ज माँग")} value={demands.length} />
        <Stat label={t("Open offers", "खुले ऑफ़र")} value={activeOfferByLot.size} />
        <Stat label={t("Active orders", "चालू ऑर्डर")} value={activeOrders.length} />
        <Stat label={t("Paid so far", "अब तक भुगतान")} value={inr(spent)} />
      </div>

      {(countered.length > 0 || ordersNeedingMe.length > 0) && (
        <section>
          <SectionTitle title={t("Needs your attention", "आपका ध्यान चाहिए")} />
          <div className="space-y-2">
            {countered.map((o) => (
              <Card key={o.id}>
                <p className="text-sm">
                  <strong>{o.lot.farmer.name}</strong>{" "}
                  {t(`countered your ${o.lot.commodity} offer:`, `ने आपके ${commodityName(o.lot.commodity, lang)} ऑफ़र पर जवाबी भाव दिया:`)} {inr(o.pricePerQt)} →{" "}
                  <strong>
                    {inr(o.counterPricePerQt ?? 0)}
                    {pq}
                  </strong>{" "}
                  {t(`for ${qtyL(o.quantityQt, lang)}`, `${qtyL(o.quantityQt, lang)} के लिए`)} ({t("total", "कुल")} {inr((o.counterPricePerQt ?? 0) * o.quantityQt)}).
                </p>
                <div className="flex flex-wrap gap-3 mt-2">
                  <ActionForm action={acceptCounter} hidden={{ offerId: o.id }} submitLabel={t("Accept counter", "जवाबी भाव स्वीकार करें")} pendingLabel={t("Accepting…", "स्वीकार कर रहे हैं…")} />
                  <ActionForm action={rejectCounter} hidden={{ offerId: o.id }} submitLabel={t("Decline", "मना करें")} pendingLabel={t("Declining…", "मना कर रहे हैं…")} variant="secondary" />
                </div>
              </Card>
            ))}
            {ordersNeedingMe.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="block">
                <Card className="flex justify-between items-center hover:border-emerald-400">
                  <span className="text-sm">
                    {t(`${o.lot.commodity} from ${o.farmer.name}:`, `${o.farmer.name} से ${commodityName(o.lot.commodity, lang)}:`)}{" "}
                    {availableOrderActions(o.status, "BUYER")
                      .map((a) => orderActionName(a, lang))
                      .join(" / ")}
                  </span>
                  <span className="text-xs text-emerald-700 font-medium">{t("Open →", "खोलें →")}</span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle
          title={t("Your demand", "आपकी माँग")}
          hint={t("What you want to buy. Farmers see this, and lots are scored against it.", "आप क्या खरीदना चाहते हैं। किसान इसे देखते हैं, और लॉट का मिलान इसी से होता है।")}
        />
        <div className="space-y-2 mb-3">
          {demands.length === 0 && <Empty>{t("No demand posted yet.", "अभी कोई माँग दर्ज नहीं।")}</Empty>}
          {demands.map((d) => (
            <Card key={d.id} className="flex flex-wrap justify-between items-center gap-2">
              <span className="text-sm">
                <strong>{commodityName(d.commodity, lang)}</strong> · {qtyL(d.quantityQt, lang)} · {t("grade", "ग्रेड")} {gradeName(d.qualityMin, lang)}+ · ~
                {inr(d.pricePerQt)}
                {pq} · {t(`within ${d.deliveryDays} days`, `${d.deliveryDays} दिन में`)}
              </span>
              <ActionForm action={deleteDemand} hidden={{ demandId: d.id }} submitLabel={t("Remove", "हटाएँ")} pendingLabel={t("Removing…", "हटा रहे हैं…")} variant="secondary" />
            </Card>
          ))}
        </div>
        <Card>
          <ActionForm action={createDemand} submitLabel={t("Post demand", "माँग दर्ज करें")} pendingLabel={t("Posting…", "दर्ज कर रहे हैं…")} resetOnSuccess className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
            <label className={labelClass}>
              {t("Commodity", "फ़सल")}
              <select name="commodity" className={inputClass}>
                {COMMODITIES.map((c) => (
                  <option key={c} value={c}>
                    {commodityName(c, lang)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t("Quantity (qt)", "मात्रा (क्विंटल)")}
              <input name="quantityQt" type="number" min={0.1} step="0.1" required className={inputClass} />
            </label>
            <label className={labelClass}>
              {t("Min grade", "न्यूनतम ग्रेड")}
              <select name="qualityMin" defaultValue="B" className={inputClass}>
                {QUALITY_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {gradeName(g, lang)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t("Price (₹/qt)", "भाव (₹/क्विंटल)")}
              <input name="pricePerQt" type="number" min={1} step="1" required className={inputClass} />
            </label>
            <label className={labelClass}>
              {t("Within (days)", "कितने दिन में")}
              <input name="deliveryDays" type="number" min={1} max={60} defaultValue={7} required className={inputClass} />
            </label>
          </ActionForm>
        </Card>
      </section>

      <section>
        <SectionTitle
          title={t("Lots on the market", "बाज़ार में लॉट")}
          hint={t("Offers are farm-gate: you arrange and pay for pickup after the farmer accepts.", "ऑफ़र खेत पर हैं: किसान के स्वीकार करने के बाद गाड़ी और भाड़ा आपका।")}
        />
        <div className="flex flex-wrap gap-2 mb-3 text-sm">
          <Link href="/buyer" className={`px-3 py-1 rounded-full border ${!filter ? "bg-emerald-700 text-white border-emerald-700" : "bg-white border-stone-300"}`}>
            {t("All", "सभी")}
          </Link>
          {COMMODITIES.map((c) => (
            <Link
              key={c}
              href={`/buyer?commodity=${c}`}
              className={`px-3 py-1 rounded-full border ${filter === c ? "bg-emerald-700 text-white border-emerald-700" : "bg-white border-stone-300"}`}
            >
              {commodityName(c, lang)}
            </Link>
          ))}
        </div>
        {views.length === 0 && (
          <Empty>
            {t(`No lots on the market${filter ? ` for ${filter}` : ""} right now.`, `अभी बाज़ार में ${filter ? `${commodityName(filter, lang)} का ` : ""}कोई लॉट नहीं।`)}
          </Empty>
        )}
        <div className="space-y-3">
          {views.map(({ lot, view }) => {
            const mine = activeOfferByLot.get(lot.id);
            const demand = demands.find((d) => d.commodity === lot.commodity);
            return (
              <Card key={lot.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {commodityName(lot.commodity, lang)} · {t("Grade", "ग्रेड")} {gradeName(lot.qualityGrade, lang)} ·{" "}
                      {t(`${qtyL(lot.availableQt, lang)} available`, `${qtyL(lot.availableQt, lang)} उपलब्ध`)}
                    </div>
                    <div className="text-xs text-stone-500">
                      {lot.farmer.name} · {lot.district} · {t(`~${view.distanceKm} km from you`, `आपसे ~${view.distanceKm} किमी`)}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Badge tone={lot.qualityParams ? "emerald" : "stone"}>
                        {lot.qualityParams ? t("measured quality", "मापी गई गुणवत्ता") : t("self-declared quality", "स्वयं बताई गुणवत्ता")}
                      </Badge>
                      {lot.isPool && <Badge tone="sky">{t(`FPO pool · ${lot._count.poolParts} farmers`, `एफपीओ पूल · ${lot._count.poolParts} किसान`)}</Badge>}
                      {!lot.farmer.verified && <Badge tone="rose">{t("seller not verified", "विक्रेता असत्यापित")}</Badge>}
                      {aiGrade(lot.media) && <Badge tone="sky">{t(`✨ AI photo grade ${aiGrade(lot.media)}`, `✨ एआई फ़ोटो ग्रेड ${aiGrade(lot.media)}`)}</Badge>}
                    </div>
                  </div>
                  {view.hasDemand ? (
                    <Badge tone={view.score >= 70 ? "emerald" : view.score >= 45 ? "amber" : "stone"}>{t(`Match ${view.score}/100`, `मेल ${view.score}/100`)}</Badge>
                  ) : (
                    <Badge>{t("No demand posted", "माँग दर्ज नहीं")}</Badge>
                  )}
                </div>
                <ul className="text-xs text-stone-500 mt-1 list-disc list-inside">
                  {view.reasons.slice(0, 4).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                {lot.media.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    {lot.media.map((m) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={m.id} src={`/media/${m.id}`} alt={t(`${lot.commodity} quality photo`, `${commodityName(lot.commodity, lang)} की फ़ोटो`)} className="w-16 h-16 object-cover rounded border border-stone-200" />
                    ))}
                  </div>
                )}
                {!mine && ai && (
                  <div className="mt-2">
                    <AiTextPanel run={adviseBuy.bind(null, lot.id)} label={t("Suggest a fair offer", "सही ऑफ़र भाव सुझाएँ")} enabled={ai} />
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-stone-100">
                  {mine ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">
                        {t("Your offer:", "आपका ऑफ़र:")} {inr(mine.pricePerQt)}
                        {pq} × {qtyL(mine.quantityQt, lang)} <StatusBadge status={mine.status} />{" "}
                        <span className="text-xs text-stone-500">{t(`expires in ${hoursLeft(mine.expiresAt)}h`, `${hoursLeft(mine.expiresAt)} घंटे में समाप्त`)}</span>
                        {mine.status === "COUNTERED" &&
                          t(
                            ` — farmer asks ${inr(mine.counterPricePerQt ?? 0)}/qt (respond above)`,
                            ` — किसान ${inr(mine.counterPricePerQt ?? 0)}/क्विंटल माँग रहे हैं (ऊपर जवाब दें)`
                          )}
                      </span>
                      {mine.status === "PENDING" && (
                        <ActionForm
                          action={withdrawOffer}
                          hidden={{ offerId: mine.id }}
                          submitLabel={t("Withdraw offer", "ऑफ़र वापस लें")}
                          pendingLabel={t("Withdrawing…", "वापस ले रहे हैं…")}
                          variant="secondary"
                        />
                      )}
                    </div>
                  ) : (
                    <ActionForm action={sendOffer} hidden={{ lotId: lot.id }} submitLabel={t("Send offer", "ऑफ़र भेजें")} pendingLabel={t("Sending…", "भेज रहे हैं…")} variant="warning">
                      <label className={labelClass}>
                        {t("Price (₹/qt)", "भाव (₹/क्विंटल)")}
                        <input
                          name="pricePerQt"
                          type="number"
                          min={1}
                          step="1"
                          required
                          defaultValue={demand ? Math.round(demand.pricePerQt) : undefined}
                          className={`mt-1 ${inlineInputClass}`}
                        />
                      </label>
                      <label className={labelClass}>
                        {t("Quantity (qt)", "मात्रा (क्विंटल)")}
                        <input
                          name="quantityQt"
                          type="number"
                          min={0.1}
                          step="0.1"
                          max={lot.availableQt}
                          defaultValue={demand ? Math.min(demand.quantityQt, lot.availableQt) : lot.availableQt}
                          required
                          className={`mt-1 ${inlineInputClass}`}
                        />
                      </label>
                    </ActionForm>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle title={t("Your orders", "आपके ऑर्डर")} />
        {orders.length === 0 ? (
          <Empty>{t("No orders yet — they appear when a farmer accepts your offer.", "अभी कोई ऑर्डर नहीं — किसान के ऑफ़र स्वीकार करने पर यहाँ दिखेंगे।")}</Empty>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="block">
                <Card className="flex flex-wrap justify-between items-center gap-2 hover:border-emerald-400">
                  <span className="text-sm">
                    {commodityName(o.lot.commodity, lang)} · {qtyL(o.quantityQt, lang)} · {o.farmer.name} · {inr(o.agreedPrice)}
                    {pq}
                  </span>
                  <StatusBadge status={o.status} />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {offers.some((o) => !isActiveOffer(o.status)) && (
        <details>
          <summary className="text-sm text-stone-600 cursor-pointer">{t("Offer history", "ऑफ़र इतिहास")}</summary>
          <div className="space-y-1 mt-2">
            {offers
              .filter((o) => !isActiveOffer(o.status))
              .map((o) => (
                <div key={o.id} className="flex justify-between text-sm bg-white border border-stone-200 rounded-lg px-3 py-2">
                  <span>
                    {commodityName(o.lot.commodity, lang)} · {o.lot.farmer.name} · {inr(o.pricePerQt)}
                    {pq} × {qtyL(o.quantityQt, lang)}
                  </span>
                  <StatusBadge status={o.status} />
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}
