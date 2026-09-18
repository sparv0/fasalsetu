import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { importPrices, setVerified } from "@/lib/actions";
import { sourceRegistry } from "@/lib/marketplace";
import { PRICE_CSV_HEADER } from "@/lib/engine/priceCsv";
import { dateTime, inr } from "@/lib/format";
import { getT } from "@/lib/lang";
import { commodityName, grievanceName, qtyL, roleName } from "@/lib/i18n";
import ActionForm from "@/components/ActionForm";
import Timeline from "@/components/Timeline";
import { Badge, Card, Empty, SectionTitle, Stat, StatusBadge } from "@/components/ui";

export default async function AdminDashboard() {
  await requirePageUser("ADMIN");
  const { t, lang } = await getT();

  const [users, lotsOnMarket, orders, grievances, events, sources] = await Promise.all([
    prisma.user.findMany({ where: { role: { not: "ADMIN" } }, orderBy: [{ role: "asc" }, { name: "asc" }] }),
    prisma.lot.count({ where: { status: { in: ["OPEN", "PARTIALLY_SOLD"] } } }),
    prisma.order.findMany({ include: { lot: true, farmer: true, buyer: true }, orderBy: { updatedAt: "desc" } }),
    prisma.grievance.findMany({
      where: { status: "OPEN" },
      include: { raisedBy: true, order: { include: { lot: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditEvent.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, take: 25 }),
    sourceRegistry(),
  ]);

  const settled = orders.filter((o) => o.status === "PAID" || o.status === "CLOSED");
  const gmv = settled.reduce((s, o) => s + o.agreedPrice * o.quantityQt, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{t("Platform admin", "प्लेटफ़ॉर्म एडमिन")}</h1>
        <p className="text-stone-600 text-sm">{t("Verification, grievance resolution and a cross-tenant audit view.", "सत्यापन, शिकायत निपटारा और पूरे प्लेटफ़ॉर्म का रिकॉर्ड।")}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label={t("Farmers / buyers", "किसान / खरीदार")} value={`${users.filter((u) => u.role === "FARMER").length} / ${users.filter((u) => u.role === "BUYER").length}`} />
        <Stat label={t("Lots on market", "बाज़ार में लॉट")} value={lotsOnMarket} />
        <Stat label={t("Active orders", "चालू ऑर्डर")} value={orders.filter((o) => o.status !== "CLOSED").length} />
        <Stat label={t("Settled value", "भुगतान हुई रकम")} value={inr(gmv)} />
        <Stat label={t("Open grievances", "खुली शिकायतें")} value={grievances.length} />
      </div>

      <section>
        <SectionTitle title={t("Open grievances", "खुली शिकायतें")} hint={t("Oldest first. Open the order to resolve.", "सबसे पुरानी पहले। सुलझाने के लिए ऑर्डर खोलें।")} />
        {grievances.length === 0 ? (
          <Empty>{t("No open grievances.", "कोई खुली शिकायत नहीं।")}</Empty>
        ) : (
          <div className="space-y-2">
            {grievances.map((g) => (
              <Link key={g.id} href={`/orders/${g.orderId}`} className="block">
                <Card className="hover:border-rose-400">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-sm">
                      {grievanceName(g.category, lang)} · {t(`${g.order.lot.commodity} order`, `${commodityName(g.order.lot.commodity, lang)} ऑर्डर`)}
                    </span>
                    <span className="text-xs text-rose-700 font-medium">{t("Resolve →", "सुलझाएँ →")}</span>
                  </div>
                  <p className="text-sm text-stone-700">{g.description}</p>
                  <p className="text-xs text-stone-400">
                    {g.raisedBy.name} · {dateTime(g.createdAt, lang)}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle
          title={t("User verification", "उपयोगकर्ता सत्यापन")}
          hint={t("Verified status feeds buyer match scores and is shown to farmers on every offer.", "सत्यापन से मैच स्कोर बनता है और किसानों को हर ऑफ़र पर दिखता है।")}
        />
        <div className="overflow-x-auto border border-stone-200 rounded-xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-stone-600 text-left text-xs">
              <tr>
                <th className="p-2">{t("Name", "नाम")}</th>
                <th className="p-2">{t("Role", "भूमिका")}</th>
                <th className="p-2">{t("District", "ज़िला")}</th>
                <th className="p-2">{t("Status", "स्थिति")}</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-stone-100">
                  <td className="p-2 font-medium">{u.name}</td>
                  <td className="p-2">{roleName(u.role, lang)}</td>
                  <td className="p-2">{u.district}</td>
                  <td className="p-2">
                    <StatusBadge status={u.verified ? "VERIFIED" : "UNVERIFIED"} />
                  </td>
                  <td className="p-2 text-right">
                    <ActionForm
                      action={setVerified}
                      hidden={{ userId: u.id, verified: String(!u.verified) }}
                      submitLabel={u.verified ? t("Revoke", "हटाएँ") : t("Verify", "सत्यापित करें")}
                      pendingLabel={t("Saving…", "सहेज रहे हैं…")}
                      variant={u.verified ? "secondary" : "primary"}
                      className="flex justify-end"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle
          title={t("Market data sources", "मंडी डेटा के स्रोत")}
          hint={t("Where PricePulse numbers come from. No live external feed is configured in this build.", "मंडी भाव के आँकड़े कहाँ से आते हैं। इस संस्करण में कोई लाइव बाहरी स्रोत नहीं जुड़ा है।")}
        />
        <div className="overflow-x-auto border border-stone-200 rounded-xl bg-white mb-3">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-stone-600 text-left text-xs">
              <tr>
                <th className="p-2">{t("Source", "स्रोत")}</th>
                <th className="p-2">{t("Mode", "प्रकार")}</th>
                <th className="p-2">{t("Records", "रिकॉर्ड")}</th>
                <th className="p-2">{t("Latest", "नवीनतम")}</th>
                <th className="p-2">{t("Freshness", "ताज़गी")}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source} className="border-t border-stone-100">
                  <td className="p-2 font-medium">{s.source}</td>
                  <td className="p-2">
                    <Badge tone={s.mode === "IMPORT" ? "sky" : "amber"}>{s.mode === "IMPORT" ? t("import", "आयात") : t("mock", "नमूना")}</Badge>
                  </td>
                  <td className="p-2">{s.records}</td>
                  <td className="p-2">{s.latest ? s.latest.toLocaleDateString("en-IN") : "—"}</td>
                  <td className="p-2">
                    <Badge tone={s.status === "FRESH" ? "emerald" : "rose"}>{s.status === "FRESH" ? t("fresh", "ताज़ा") : t("stale", "पुराना")}</Badge>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-stone-100 text-stone-500">
                <td className="p-2">AGMARKNET / e-NAM</td>
                <td className="p-2">
                  <Badge>{t("not configured", "जुड़ा नहीं")}</Badge>
                </td>
                <td className="p-2" colSpan={3}>
                  {t("Adapter slot only — enable after access, credentials and terms are verified.", "सिर्फ़ एडैप्टर की जगह — अनुमति, क्रेडेंशियल और शर्तें पक्की होने के बाद चालू करें।")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Card>
          <h3 className="font-medium text-sm mb-1">{t("Import prices from CSV", "CSV से भाव आयात करें")}</h3>
          <p className="text-xs text-stone-500 mb-2">
            {t("Header:", "हेडर:")} <code>{PRICE_CSV_HEADER.join(",")}</code>.{" "}
            {t(
              "Dates as YYYY-MM-DD. Bad rows are rejected individually; duplicates of existing records are skipped.",
              "तारीख YYYY-MM-DD में। गलत पंक्तियाँ अलग-अलग अस्वीकार होती हैं; पहले से मौजूद रिकॉर्ड छोड़ दिए जाते हैं।"
            )}{" "}
            <a href="/api/sample-prices" className="text-emerald-700 underline">
              {t("Download a sample file", "नमूना फ़ाइल डाउनलोड करें")}
            </a>{" "}
            {t("(backfills the stale Solapur wheat feed and includes bad rows).", "(सोलापुर गेहूं का पुराना डेटा भरती है और इसमें कुछ गलत पंक्तियाँ भी हैं)।")}
          </p>
          <ActionForm action={importPrices} submitLabel={t("Import", "आयात करें")} pendingLabel={t("Importing…", "आयात हो रहा है…")} resetOnSuccess encType="multipart/form-data">
            <input type="file" name="csv" accept=".csv,text/csv" required aria-label={t("Price CSV file", "भाव की CSV फ़ाइल")} className="text-sm" />
          </ActionForm>
        </Card>
      </section>

      <section>
        <SectionTitle title={t("All orders", "सभी ऑर्डर")} />
        {orders.length === 0 ? (
          <Empty>{t("No orders yet.", "अभी कोई ऑर्डर नहीं।")}</Empty>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="block">
                <Card className="flex flex-wrap justify-between items-center gap-2 hover:border-emerald-400">
                  <span className="text-sm">
                    {commodityName(o.lot.commodity, lang)} · {qtyL(o.quantityQt, lang)} · {o.farmer.name} → {o.buyer.name} · {inr(o.agreedPrice * o.quantityQt)}
                  </span>
                  <StatusBadge status={o.status} />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle title={t("Recent platform activity", "प्लेटफ़ॉर्म की हाल की गतिविधि")} />
        <Timeline events={events} />
      </section>
    </div>
  );
}
