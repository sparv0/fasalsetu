import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createPool } from "@/lib/actions";
import { expireStaleOffers, poolPayouts } from "@/lib/marketplace";
import { lowestGrade } from "@/lib/engine/quality";
import { inr } from "@/lib/format";
import { getT } from "@/lib/lang";
import { commodityName, gradeName, perQt, qtyL } from "@/lib/i18n";
import ActionForm from "@/components/ActionForm";
import { Badge, Card, Empty, SectionTitle, Stat, StatusBadge } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/gemini";
import { fpoAdvice } from "@/lib/ai/actions";
import { AiTextPanel } from "@/components/ai/AiPanels";

export default async function FpoDashboard() {
  const fpo = await requirePageUser("FPO");
  const { t, lang } = await getT();
  await expireStaleOffers();

  const [members, poolLots] = await Promise.all([
    prisma.user.findMany({
      where: { fpoId: fpo.id },
      orderBy: { name: "asc" },
      include: {
        lots: { orderBy: { createdAt: "desc" }, include: { storageBookings: { where: { status: "ACTIVE" }, select: { id: true } } } },
      },
    }),
    prisma.lot.findMany({
      where: { farmerId: fpo.id },
      orderBy: { createdAt: "desc" },
      include: { offers: { where: { status: "PENDING" }, select: { id: true } }, orders: true },
    }),
  ]);

  const openMemberLots = members.flatMap((m) => m.lots.filter((l) => l.status === "OPEN").map((l) => ({ ...l, farmerName: m.name })));
  const byCommodity = new Map<string, typeof openMemberLots>();
  for (const l of openMemberLots) byCommodity.set(l.commodity, [...(byCommodity.get(l.commodity) ?? []), l]);

  const payouts = new Map(await Promise.all(poolLots.filter((l) => l.isPool).map(async (l) => [l.id, await poolPayouts(l.id)] as const)));
  const settled = [...payouts.values()].reduce((s, p) => s + p.settledTotal, 0);
  const soldQt = poolLots.flatMap((l) => l.orders).reduce((s, o) => s + o.quantityQt, 0);
  const soldValue = poolLots.flatMap((l) => l.orders).reduce((s, o) => s + o.agreedPrice * o.quantityQt, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{fpo.name}</h1>
        <p className="text-stone-600 text-sm">
          {t(
            `${fpo.district} district · Farmer Producer Organisation · ${members.length} member farmers on the platform`,
            `${fpo.district} ज़िला · किसान उत्पादक संगठन · प्लेटफ़ॉर्म पर ${members.length} सदस्य किसान`
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t("Member supply on market", "सदस्यों का बाज़ार में माल")} value={qtyL(openMemberLots.reduce((s, l) => s + l.availableQt, 0), lang)} />
        <Stat label={t("Pooled lots", "पूल लॉट")} value={poolLots.filter((l) => l.isPool).length} />
        <Stat label={t("Sold through FPO", "एफपीओ से बिका")} value={qtyL(soldQt, lang)} />
        <Stat label={t("Avg realised", "औसत भाव मिला")} value={soldQt > 0 ? `${inr(soldValue / soldQt)}${perQt(lang)}` : "—"} />
      </div>

      <Card className="border-violet-200">
        <h2 className="font-semibold text-sm mb-2">{t("AI pooling advisor", "एआई पूलिंग सलाहकार")}</h2>
        <AiTextPanel run={fpoAdvice} label={t("Which lots should we pool, and where should we sell?", "कौन से लॉट मिलाएँ, और कहाँ बेचें?")} enabled={aiEnabled()} />
      </Card>

      <section>
        <SectionTitle
          title={t("Pool member lots", "सदस्यों के लॉट मिलाएँ")}
          hint={t(
            "Combine members' open lots of one commodity into a single bulk lot. Grade = lowest contributed grade; proceeds split by quantity.",
            "एक ही फ़सल के सदस्यों के खुले लॉट मिलाकर एक बड़ा लॉट बनाएँ। ग्रेड = सबसे कम ग्रेड; कमाई मात्रा के अनुसार बँटती है।"
          )}
        />
        {byCommodity.size === 0 && <Empty>{t("No open member lots to pool right now.", "अभी मिलाने लायक सदस्यों का कोई खुला लॉट नहीं।")}</Empty>}
        <div className="space-y-3">
          {[...byCommodity.entries()].map(([commodity, lots]) => (
            <Card key={commodity}>
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">
                  {commodityName(commodity, lang)} · {qtyL(lots.reduce((s, l) => s + l.availableQt, 0), lang)} ·{" "}
                  {t(`${lots.length} lot(s)`, `${lots.length} लॉट`)}
                </span>
                <Badge>
                  {t("pooled grade would be", "पूल का ग्रेड होगा")} {gradeName(lowestGrade(lots.map((l) => l.qualityGrade)), lang)}
                </Badge>
              </div>
              {lots.length < 2 ? (
                <p className="text-sm text-stone-500">{t("Only one open member lot — pooling needs at least two.", "सिर्फ़ एक खुला लॉट है — मिलाने के लिए कम से कम दो चाहिए।")}</p>
              ) : (
                <ActionForm
                  action={createPool}
                  submitLabel={t(`Create pooled ${commodity} lot`, `${commodityName(commodity, lang)} का पूल लॉट बनाएँ`)}
                  pendingLabel={t("Pooling…", "पूल बना रहे हैं…")}
                  className="space-y-2"
                >
                  {lots.map((l) => (
                    <label key={l.id} className={`flex items-center gap-2 text-sm ${l.storageBookings.length ? "text-stone-400" : ""}`}>
                      <input type="checkbox" name="lotIds" value={l.id} defaultChecked={l.storageBookings.length === 0} disabled={l.storageBookings.length > 0} />
                      {l.farmerName} · {qtyL(l.availableQt, lang)} · {t("grade", "ग्रेड")} {gradeName(l.qualityGrade, lang)}
                      {l.qualityParams ? t(" · measured", " · मापा गया") : t(" · self-declared", " · स्वयं बताया")}
                      {l.storageBookings.length > 0 && t(" · in storage (cancel booking to pool)", " · गोदाम में (पूल के लिए बुकिंग रद्द करें)")}
                    </label>
                  ))}
                </ActionForm>
              )}
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle title={t("FPO lots", "एफपीओ लॉट")} hint={t("Pooled lots are sold like any lot: SmartSell, offers, orders.", "पूल लॉट भी बाकी लॉट की तरह बिकते हैं: स्मार्टसेल, ऑफ़र, ऑर्डर।")} />
        {poolLots.length === 0 ? (
          <Empty>{t("No FPO lots yet.", "अभी कोई एफपीओ लॉट नहीं।")}</Empty>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {poolLots.map((l) => {
              const p = payouts.get(l.id);
              return (
                <Link key={l.id} href={`/farmer/lots/${l.id}`} className="block">
                  <Card className="hover:border-emerald-400 h-full">
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-medium">
                        {commodityName(l.commodity, lang)} · {t("Grade", "ग्रेड")} {gradeName(l.qualityGrade, lang)}
                      </span>
                      <StatusBadge status={l.status} />
                    </div>
                    <div className="text-sm text-stone-600 mt-1">
                      {t(`${qtyL(l.availableQt, lang)} available of ${qtyL(l.quantityQt, lang)}`, `${qtyL(l.quantityQt, lang)} में से ${qtyL(l.availableQt, lang)} उपलब्ध`)}
                      {p && t(` · ${p.shares.length} members`, ` · ${p.shares.length} सदस्य`)}
                    </div>
                    <div className="text-xs text-stone-500 mt-1">
                      {t(`${l.offers.length} pending offer(s)`, `${l.offers.length} लंबित ऑफ़र`)}
                      {p &&
                        p.settledTotal + p.pendingTotal > 0 &&
                        t(` · ${inr(p.settledTotal)} settled, ${inr(p.pendingTotal)} pending`, ` · ${inr(p.settledTotal)} मिला, ${inr(p.pendingTotal)} बाकी`)}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle title={t("Members", "सदस्य")} />
        <div className="overflow-x-auto border border-stone-200 rounded-xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-stone-600 text-left text-xs">
              <tr>
                <th className="p-2">{t("Farmer", "किसान")}</th>
                <th className="p-2">{t("Land", "ज़मीन")}</th>
                <th className="p-2">{t("Open supply", "खुला माल")}</th>
                <th className="p-2">{t("Pooled", "पूल में")}</th>
                <th className="p-2">{t("Status", "स्थिति")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-stone-100">
                  <td className="p-2 font-medium">{m.name}</td>
                  <td className="p-2">{m.landAcres ? t(`${m.landAcres} acres`, `${m.landAcres} एकड़`) : "—"}</td>
                  <td className="p-2">
                    {m.lots
                      .filter((l) => l.status === "OPEN" || l.status === "PARTIALLY_SOLD")
                      .map((l) => `${commodityName(l.commodity, lang)} ${qtyL(l.availableQt, lang)}`)
                      .join(", ") || "—"}
                  </td>
                  <td className="p-2">{t(`${m.lots.filter((l) => l.status === "POOLED").length} lot(s)`, `${m.lots.filter((l) => l.status === "POOLED").length} लॉट`)}</td>
                  <td className="p-2">
                    <StatusBadge status={m.verified ? "VERIFIED" : "UNVERIFIED"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-stone-500 mt-2">{t(`Total settled to members so far: ${inr(settled)}.`, `अब तक सदस्यों को कुल भुगतान: ${inr(settled)}।`)}</p>
      </section>
    </div>
  );
}
