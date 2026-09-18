import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { type AgreementTerms, verifyAgreement } from "@/lib/engine/agreement";
import { inr } from "@/lib/format";
import { getT } from "@/lib/lang";
import { commodityName, gradeName, locale, perQt, qtyL } from "@/lib/i18n";
import { Badge, Card } from "@/components/ui";

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();
  const { t, lang } = await getT();
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) notFound();
  if (user.role !== "ADMIN" && user.id !== order.farmerId && user.id !== order.buyerId) notFound();

  const terms = JSON.parse(order.agreementTerms) as AgreementTerms;
  const intact = verifyAgreement(order.agreementTerms, order.agreementHash);

  // The stored English terms are what the fingerprint covers; Hindi here is a display translation only.
  const CLAUSE_HI: Record<string, string> = {
    "Farm-gate. Buyer books and pays for pickup from the seller's location.": "खेत पर सौदा। खरीदार विक्रेता के स्थान से पिकअप बुक करेगा और भाड़ा देगा।",
    "Buyer pays the full value through the platform payment tracker after confirming delivery.": "माल मिलने की पुष्टि के बाद खरीदार प्लेटफ़ॉर्म के भुगतान ट्रैकर से पूरी रकम देगा।",
    "Either party may raise a grievance; the platform admin reviews evidence and records a resolution.": "कोई भी पक्ष शिकायत कर सकता है; प्लेटफ़ॉर्म एडमिन सबूत देखकर समाधान दर्ज करता है।",
  };
  const clause = (en: string) => (lang === "hi" ? (CLAUSE_HI[en] ?? en) : en);

  const rows: [string, React.ReactNode][] = [
    [
      t("Seller", "विक्रेता"),
      `${terms.seller.name} (${terms.seller.kind === "FPO" ? t("FPO", "एफपीओ") : t("farmer", "किसान")}, ${terms.seller.district})`,
    ],
    [
      t("Buyer", "खरीदार"),
      `${terms.buyer.name} (${terms.buyer.district}) — ${
        terms.buyer.verified ? t("verified at signing", "अनुबंध के समय सत्यापित") : t("not verified at signing", "अनुबंध के समय असत्यापित")
      }`,
    ],
    [t("Commodity", "फ़सल"), commodityName(terms.commodity, lang)],
    [
      t("Quality", "गुणवत्ता"),
      `${t("Grade", "ग्रेड")} ${gradeName(terms.qualityGrade, lang)} (${
        terms.qualityBasis === "MEASURED" ? t("measured", "मापी गई") : t("self-declared", "स्वयं बताई")
      })`,
    ],
    [t("Quantity", "मात्रा"), qtyL(terms.quantityQt, lang)],
    [t("Price", "भाव"), `${inr(terms.pricePerQt)}${perQt(lang)}`],
    [t("Total value", "कुल रकम"), inr(terms.totalValue)],
    [t("Delivery", "डिलीवरी"), `${clause(terms.deliveryTerms)} ${t(`Within ${terms.deliveryWindowDays} days.`, `${terms.deliveryWindowDays} दिन के भीतर।`)}`],
    [t("Payment", "भुगतान"), clause(terms.paymentTerms)],
    [t("Disputes", "विवाद"), clause(terms.disputeResolution)],
    [t("Agreed at", "सहमति का समय"), new Date(terms.agreedAt).toLocaleString(locale(lang))],
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link href={`/orders/${order.id}`} className="text-xs text-emerald-700">
        ← {t("Back to order", "ऑर्डर पर वापस")}
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{t("Digital trade agreement", "डिजिटल व्यापार अनुबंध")}</h1>
        <p className="text-sm text-stone-600">
          {terms.version} · {t("created automatically when the offer was accepted", "ऑफ़र स्वीकार होते ही अपने आप बना")}
        </p>
      </div>
      <Card>
        <dl className="divide-y divide-stone-100">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-3 gap-3 py-2 text-sm">
              <dt className="text-stone-500">{k}</dt>
              <dd className="col-span-2">{v}</dd>
            </div>
          ))}
        </dl>
        {lang === "hi" && <p className="text-xs text-stone-400 mt-2">रिकॉर्ड की गई शर्तें अंग्रेज़ी में हैं; फ़िंगरप्रिंट उन्हीं पर बनता है। यह हिंदी अनुवाद केवल पढ़ने के लिए है।</p>}
      </Card>
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{t("SHA-256 fingerprint", "SHA-256 फ़िंगरप्रिंट")}</span>
          <Badge tone={intact ? "emerald" : "rose"}>
            {intact ? t("intact", "सही") : t("MISMATCH — terms changed after signing", "मेल नहीं खाता — अनुबंध के बाद शर्तें बदली गईं")}
          </Badge>
        </div>
        <code className="block text-xs break-all bg-stone-100 rounded p-2">{order.agreementHash}</code>
        <p className="text-xs text-stone-500 mt-2">
          {t(
            "The fingerprint is computed over the canonical terms above and re-checked every time this page loads, so any later edit to the stored terms is detectable. This is a platform record, not a legally registered contract; no blockchain anchoring is used.",
            "फ़िंगरप्रिंट ऊपर की शर्तों से बनता है और हर बार पेज खुलने पर दोबारा जाँचा जाता है, इसलिए बाद में शर्तों में कोई भी बदलाव पकड़ में आ जाता है। यह प्लेटफ़ॉर्म का रिकॉर्ड है, कानूनी रूप से पंजीकृत अनुबंध नहीं; ब्लॉकचेन का उपयोग नहीं होता।"
          )}
        </p>
      </Card>
    </div>
  );
}
