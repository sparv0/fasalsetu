import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { availableOrderActions } from "@/lib/engine/states";
import { expireStaleOffers, poolPayouts } from "@/lib/marketplace";
import { inr } from "@/lib/format";
import { getT } from "@/lib/lang";
import { commodityName, gradeName, orderActionName, perQt, qtyL } from "@/lib/i18n";
import LotForm from "@/components/LotForm";
import { aiEnabled } from "@/lib/ai/gemini";
import { Badge, Card, Empty, SectionTitle, Stat, StatusBadge } from "@/components/ui";

export default async function FarmerDashboard() {
  const user = await requirePageUser("FARMER");
  const { t, lang } = await getT();
  await expireStaleOffers();

  const [lots, orders, fpo] = await Promise.all([
    prisma.lot.findMany({
      where: { farmerId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        offers: { where: { status: "PENDING" }, select: { id: true } },
        contributedTo: { include: { poolLot: { include: { farmer: true } } } },
        media: { select: { id: true } },
      },
    }),
    prisma.order.findMany({
      where: { farmerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { lot: true, buyer: true },
    }),
    user.fpoId ? prisma.user.findUnique({ where: { id: user.fpoId } }) : Promise.resolve(null),
  ]);

  const poolIds = [...new Set(lots.flatMap((l) => (l.contributedTo ? [l.contributedTo.poolLotId] : [])))];
  const payouts = new Map(await Promise.all(poolIds.map(async (pid) => [pid, await poolPayouts(pid)] as const)));
  const myPoolShare = (poolLotId: string) => payouts.get(poolLotId)?.shares.find((s) => s.farmerId === user.id);
  const poolSettled = poolIds.reduce((s, pid) => s + (myPoolShare(pid)?.settled ?? 0), 0);

  const pendingOffers = lots.reduce((n, l) => n + l.offers.length, 0);
  const activeOrders = orders.filter((o) => o.status !== "CLOSED");
  const earned =
    orders.filter((o) => o.status === "PAID" || o.status === "CLOSED").reduce((s, o) => s + o.agreedPrice * o.quantityQt, 0) + poolSettled;
  const ordersNeedingMe = activeOrders.filter((o) => availableOrderActions(o.status, "FARMER").length > 0);
  const lotsWithOffers = lots.filter((l) => l.offers.length > 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">
          {t("Namaste", "नमस्ते")}, {user.name}
        </h1>
        <p className="text-stone-600 text-sm">
          {t(`${user.district} district`, `${user.district} ज़िला`)} · {t("Farmer", "किसान")} ·{" "}
          {user.verified ? t("verified", "सत्यापित") : t("not verified", "असत्यापित")}
          {fpo && <> · {t(`member of ${fpo.name}`, `${fpo.name} के सदस्य`)}</>}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t("Lots on market", "बाज़ार में लॉट")} value={lots.filter((l) => l.status === "OPEN" || l.status === "PARTIALLY_SOLD").length} />
        <Stat label={t("Offers to answer", "जवाब देने लायक ऑफ़र")} value={pendingOffers} />
        <Stat label={t("Active orders", "चालू ऑर्डर")} value={activeOrders.length} />
        <Stat label={t("Received so far", "अब तक मिला")} value={inr(earned)} />
      </div>

      <Link href="/assistant" className="block">
        <Card className="bg-gradient-to-r from-violet-600 to-emerald-700 text-white border-0 hover:opacity-95">
          <div className="font-semibold">{t("✨ Ask Kisan Sahayak", "✨ किसान सहायक से पूछें")}</div>
          <div className="text-sm text-violet-100">
            {t(
              "“Where should I sell my onion?” · “आत्ता विकू की साठवू?” — type or speak in English, हिंदी or मराठी. It knows your lots, offers and today's prices.",
              "“मेरा प्याज कहाँ बेचूँ?” · “अभी बेचूँ या स्टोर करूँ?” — हिंदी, मराठी या English में लिखें या बोलें। इसे आपके लॉट, ऑफ़र और आज के भाव पता हैं।"
            )}
          </div>
        </Card>
      </Link>

      {(lotsWithOffers.length > 0 || ordersNeedingMe.length > 0) && (
        <section>
          <SectionTitle title={t("Needs your attention", "आपका ध्यान चाहिए")} />
          <div className="space-y-2">
            {lotsWithOffers.map((l) => (
              <Link key={l.id} href={`/farmer/lots/${l.id}`} className="block">
                <Card className="flex justify-between items-center hover:border-emerald-400">
                  <span className="text-sm">
                    {t(
                      `${l.offers.length} new offer${l.offers.length > 1 ? "s" : ""} on your ${l.commodity} lot`,
                      `आपके ${commodityName(l.commodity, lang)} लॉट पर ${l.offers.length} नए ऑफ़र`
                    )}
                  </span>
                  <span className="text-xs text-emerald-700 font-medium">{t("Review →", "देखें →")}</span>
                </Card>
              </Link>
            ))}
            {ordersNeedingMe.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="block">
                <Card className="flex justify-between items-center hover:border-emerald-400">
                  <span className="text-sm">
                    {t(`${o.lot.commodity} order with ${o.buyer.name}:`, `${o.buyer.name} के साथ ${commodityName(o.lot.commodity, lang)} ऑर्डर:`)}{" "}
                    {availableOrderActions(o.status, "FARMER")
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
          title={t("Create a digital lot", "डिजिटल लॉट बनाएँ")}
          hint={t("Your lot is listed for verified buyers and analysed against every market.", "आपका लॉट सत्यापित खरीदारों को दिखेगा और हर मंडी से उसकी तुलना होगी।")}
        />
        <Card>
          <LotForm today={today} ai={aiEnabled()} />
        </Card>
      </section>

      <section>
        <SectionTitle title={t("Your lots", "आपके लॉट")} />
        {lots.length === 0 ? (
          <Empty>{t("No lots yet — create one above to see where to sell.", "अभी कोई लॉट नहीं — कहाँ बेचें यह जानने के लिए ऊपर लॉट बनाएँ।")}</Empty>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {lots.map((lot) => (
              <Link key={lot.id} href={`/farmer/lots/${lot.id}`} className="block">
                <Card className="hover:border-emerald-400 transition h-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {commodityName(lot.commodity, lang)} · {t("Grade", "ग्रेड")} {gradeName(lot.qualityGrade, lang)}
                    </span>
                    <StatusBadge status={lot.status} />
                  </div>
                  <div className="text-sm text-stone-600 mt-1">
                    {lot.status === "POOLED" && lot.contributedTo
                      ? t(
                          `${qtyL(lot.contributedTo.quantityQt, lang)} pooled into ${lot.contributedTo.poolLot.farmer.name}`,
                          `${qtyL(lot.contributedTo.quantityQt, lang)} ${lot.contributedTo.poolLot.farmer.name} के पूल में`
                        )
                      : t(
                          `${qtyL(lot.availableQt, lang)} available of ${qtyL(lot.quantityQt, lang)}`,
                          `${qtyL(lot.quantityQt, lang)} में से ${qtyL(lot.availableQt, lang)} उपलब्ध`
                        )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <Badge tone={lot.qualityParams ? "emerald" : "stone"}>
                      {lot.qualityParams ? t("measured quality", "मापी गई गुणवत्ता") : t("self-declared", "स्वयं बताई")}
                    </Badge>
                    {lot.media.length > 0 && <Badge tone="sky">{t(`${lot.media.length} photo(s)`, `${lot.media.length} फ़ोटो`)}</Badge>}
                  </div>
                  <div className="text-xs text-stone-500 mt-1">
                    {lot.contributedTo
                      ? (() => {
                          const share = myPoolShare(lot.contributedTo.poolLotId);
                          return share
                            ? t(
                                `Your share ${share.sharePct.toFixed(1)}% · received ${inr(share.settled)} · pending ${inr(share.pending)}`,
                                `आपका हिस्सा ${share.sharePct.toFixed(1)}% · मिला ${inr(share.settled)} · बाकी ${inr(share.pending)}`
                              )
                            : t("Pooled", "पूल में");
                        })()
                      : lot.offers.length > 0
                        ? t(`${lot.offers.length} offer(s) waiting for you`, `${lot.offers.length} ऑफ़र आपके जवाब का इंतज़ार कर रहे हैं`)
                        : t("No pending offers", "कोई लंबित ऑफ़र नहीं")}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle title={t("Your orders", "आपके ऑर्डर")} />
        {orders.length === 0 ? (
          <Empty>{t("No orders yet. Accept an offer on a lot to create one.", "अभी कोई ऑर्डर नहीं। लॉट पर कोई ऑफ़र स्वीकार करने से ऑर्डर बनेगा।")}</Empty>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="block">
                <Card className="flex flex-wrap justify-between items-center gap-2 hover:border-emerald-400">
                  <span className="text-sm">
                    {commodityName(o.lot.commodity, lang)} · {qtyL(o.quantityQt, lang)} → {o.buyer.name} · {inr(o.agreedPrice)}
                    {perQt(lang)}
                  </span>
                  <StatusBadge status={o.status} />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
