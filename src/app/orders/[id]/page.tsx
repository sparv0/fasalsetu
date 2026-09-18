import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser, homePathFor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createGrievance, resolveGrievance, runOrderAction } from "@/lib/actions";
import { GRIEVANCE_CATEGORIES } from "@/lib/engine/config";
import { ORDER_ACTIONS, ORDER_FLOW, availableOrderActions, type OrderAction } from "@/lib/engine/states";
import { dateTime, inr } from "@/lib/format";
import { getT } from "@/lib/lang";
import { commodityName, grievanceName, orderActionName, perQt, qtyL, statusName } from "@/lib/i18n";
import { verifyAgreement } from "@/lib/engine/agreement";
import ActionForm from "@/components/ActionForm";
import Timeline from "@/components/Timeline";
import { aiEnabled } from "@/lib/ai/gemini";
import { triageGrievance } from "@/lib/ai/actions";
import { TriagePanel } from "@/components/ai/AiPanels";
import { Badge, Card, Empty, SectionTitle, StatusBadge, inputClass, labelClass } from "@/components/ui";

const ACTION_VARIANT: Record<OrderAction, "primary" | "info"> = {
  BOOK_LOGISTICS: "primary",
  MARK_IN_TRANSIT: "info",
  MARK_DELIVERED: "primary",
  INITIATE_PAYMENT: "primary",
  CONFIRM_PAYMENT: "primary",
  CLOSE: "info",
};

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();
  const { t, lang } = await getT();
  const pq = perQt(lang);

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      lot: true,
      buyer: true,
      farmer: true,
      logistics: true,
      payment: true,
      grievances: { include: { raisedBy: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) notFound();
  const party = user.id === order.farmerId ? "FARMER" : user.id === order.buyerId ? "BUYER" : null;
  if (!party && user.role !== "ADMIN") notFound();

  const events = await prisma.auditEvent.findMany({
    where: { OR: [{ orderId: order.id }, { offerId: order.offerId }] },
    include: { actor: true },
    orderBy: { createdAt: "desc" },
  });

  const stepIndex = ORDER_FLOW.indexOf(order.status as (typeof ORDER_FLOW)[number]);
  const myActions = availableOrderActions(order.status, party);
  const nextRule = Object.values(ORDER_ACTIONS).find((r) => r.from === order.status);
  const waitingOn =
    nextRule && myActions.length === 0 ? nextRule.by.map((p) => (p === "FARMER" ? order.farmer.name : order.buyer.name)).join(t(" or ", " या ")) : null;
  const nextAction = (Object.keys(ORDER_ACTIONS) as OrderAction[]).find((a) => ORDER_ACTIONS[a].from === order.status);
  const openGrievances = order.grievances.filter((g) => g.status === "OPEN").length;
  const total = order.agreedPrice * order.quantityQt;

  return (
    <div className="space-y-8">
      <div>
        <Link href={party === "FARMER" ? `/farmer/lots/${order.lotId}` : homePathFor(user.role)} className="text-xs text-emerald-700">
          ← {t("Back", "वापस")}
        </Link>
        <h1 className="text-2xl font-bold text-emerald-900 mt-1">
          {commodityName(order.lot.commodity, lang)} · {qtyL(order.quantityQt, lang)} · {inr(order.agreedPrice)}
          {pq}
        </h1>
        <div className="mt-1 mb-1">
          <Link href={`/orders/${order.id}/agreement`} className="text-sm text-emerald-700 underline">
            {t("View digital agreement", "डिजिटल अनुबंध देखें")}
          </Link>{" "}
          <Badge tone={verifyAgreement(order.agreementTerms, order.agreementHash) ? "emerald" : "rose"}>
            {verifyAgreement(order.agreementTerms, order.agreementHash)
              ? t("fingerprint intact", "फ़िंगरप्रिंट सही")
              : t("fingerprint mismatch", "फ़िंगरप्रिंट मेल नहीं खाता")}
          </Badge>
        </div>
        <p className="text-stone-600 text-sm">
          {t("Deal value", "सौदे की रकम")} <strong>{inr(total)}</strong> · {t("Seller", "विक्रेता")} {order.farmer.name} ({order.farmer.district}) →{" "}
          {t("Buyer", "खरीदार")} {order.buyer.name} ({order.buyer.district}) · {t("created", "बना")} {dateTime(order.createdAt, lang)}
        </p>
      </div>

      <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label={t("Order progress", "ऑर्डर की प्रगति")}>
        {ORDER_FLOW.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={`px-2 py-1 rounded-full ${i < stepIndex ? "bg-emerald-700 text-white" : i === stepIndex ? "bg-emerald-900 text-white ring-2 ring-emerald-300" : "bg-stone-200 text-stone-500"}`}
              aria-current={i === stepIndex ? "step" : undefined}
            >
              {statusName(s, lang)}
            </span>
            {i < ORDER_FLOW.length - 1 && <span className="text-stone-300">→</span>}
          </li>
        ))}
      </ol>

      <Card className="border-emerald-300">
        <SectionTitle title={t("Next step", "अगला कदम")} />
        {order.status === "CLOSED" ? (
          <p className="text-sm text-emerald-800">{t("This transaction is closed. Nothing left to do.", "यह सौदा पूरा हो गया है। अब कुछ करना बाकी नहीं।")}</p>
        ) : myActions.length > 0 ? (
          <div className="flex flex-wrap gap-4">
            {myActions.map((a) => (
              <ActionForm
                key={a}
                action={runOrderAction}
                hidden={{ orderId: order.id, action: a }}
                submitLabel={a === "INITIATE_PAYMENT" ? t(`Pay ${inr(total)}`, `${inr(total)} का भुगतान करें`) : orderActionName(a, lang)}
                variant={ACTION_VARIANT[a]}
              />
            ))}
          </div>
        ) : waitingOn ? (
          <p className="text-sm text-stone-600">
            {t("Waiting for", "इंतज़ार:")} <strong>{waitingOn}</strong> — {orderActionName(nextAction!, lang).toLowerCase()}.
          </p>
        ) : (
          <p className="text-sm text-stone-600">{t("You are viewing this order as platform admin.", "आप यह ऑर्डर प्लेटफ़ॉर्म एडमिन के रूप में देख रहे हैं।")}</p>
        )}
        {order.status === "PAID" && openGrievances > 0 && (
          <p className="text-xs text-rose-700 mt-2">
            {t(`${openGrievances} open grievance(s) must be resolved before closing.`, `सौदा पूरा करने से पहले ${openGrievances} खुली शिकायत सुलझानी होगी।`)}
          </p>
        )}
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-semibold">{t("Pickup & transport", "पिकअप और ढुलाई")}</h2>
            <Badge tone="amber">{t("Mock provider", "नमूना सेवा")}</Badge>
          </div>
          {order.logistics ? (
            <dl className="text-sm grid grid-cols-2 gap-y-1">
              <dt className="text-stone-500">{t("Vehicle", "वाहन")}</dt>
              <dd>
                {order.logistics.trips} × {order.logistics.vehicle}
              </dd>
              <dt className="text-stone-500">{t("Route", "रास्ता")}</dt>
              <dd>
                {order.farmer.district} → {order.buyer.district} ({order.logistics.distanceKm} {t("km", "किमी")})
              </dd>
              <dt className="text-stone-500">{t("Quote (buyer pays)", "भाड़ा (खरीदार देगा)")}</dt>
              <dd>{inr(order.logistics.quoteCost)}</dd>
              <dt className="text-stone-500">{t("Status", "स्थिति")}</dt>
              <dd>
                <StatusBadge status={order.logistics.status} />
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-stone-500">{t("Not booked yet. The buyer books pickup (farm-gate terms).", "अभी बुक नहीं हुआ। पिकअप खरीदार बुक करेगा (खेत पर सौदा)।")}</p>
          )}
        </Card>
        <Card>
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-semibold">{t("Payment", "भुगतान")}</h2>
            <Badge tone="amber">{t("Mock provider", "नमूना सेवा")}</Badge>
          </div>
          {order.payment ? (
            <dl className="text-sm grid grid-cols-2 gap-y-1">
              <dt className="text-stone-500">{t("Amount", "रकम")}</dt>
              <dd>{inr(order.payment.amount)}</dd>
              <dt className="text-stone-500">{t("Reference", "संदर्भ")}</dt>
              <dd className="font-mono text-xs break-all">{order.payment.reference}</dd>
              <dt className="text-stone-500">{t("Status", "स्थिति")}</dt>
              <dd>
                <StatusBadge status={order.payment.status} />
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-stone-500">{t("Payment opens after the buyer confirms delivery. No real money moves in this demo.", "खरीदार के माल मिलने की पुष्टि के बाद भुगतान खुलेगा। इस डेमो में असली पैसा नहीं जाता।")}</p>
          )}
        </Card>
      </div>

      <section>
        <SectionTitle
          title={t("Grievances", "शिकायतें")}
          hint={t(
            "Either party can raise an issue; the platform admin resolves it. Closing is blocked while any are open.",
            "कोई भी पक्ष शिकायत कर सकता है; प्लेटफ़ॉर्म एडमिन सुलझाता है। खुली शिकायत रहते सौदा पूरा नहीं होगा।"
          )}
        />
        <div className="space-y-2 mb-3">
          {order.grievances.length === 0 && <Empty>{t("No grievances raised.", "कोई शिकायत नहीं।")}</Empty>}
          {order.grievances.map((g) => (
            <Card key={g.id}>
              <div className="flex justify-between gap-2">
                <span className="font-medium text-sm">{grievanceName(g.category, lang)}</span>
                <StatusBadge status={g.status} />
              </div>
              <p className="text-sm text-stone-700 mt-1">{g.description}</p>
              <p className="text-xs text-stone-400">
                {t("Raised by", "दर्ज की:")} {g.raisedBy.name} · {dateTime(g.createdAt, lang)}
              </p>
              {g.resolutionNote && (
                <p className="text-sm text-emerald-800 mt-2">
                  {t("Resolution:", "समाधान:")} {g.resolutionNote}
                </p>
              )}
              {g.status === "OPEN" && user.role === "ADMIN" && <TriagePanel run={triageGrievance.bind(null, g.id)} enabled={aiEnabled()} />}
              {g.status === "OPEN" && user.role === "ADMIN" && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <ActionForm action={resolveGrievance} hidden={{ grievanceId: g.id }} submitLabel={t("Resolve", "सुलझाएँ")} pendingLabel={t("Resolving…", "सुलझा रहे हैं…")}>
                    <input
                      name="resolutionNote"
                      required
                      minLength={5}
                      placeholder={t("How was this resolved?", "यह कैसे सुलझा?")}
                      aria-label={t("Resolution note", "समाधान नोट")}
                      className={`${inputClass} !mt-0 flex-1 min-w-48`}
                    />
                  </ActionForm>
                </div>
              )}
            </Card>
          ))}
        </div>
        {party && order.status !== "CLOSED" && (
          <Card>
            <ActionForm action={createGrievance} hidden={{ orderId: order.id }} submitLabel={t("Raise grievance", "शिकायत दर्ज करें")} pendingLabel={t("Submitting…", "दर्ज कर रहे हैं…")} variant="danger" resetOnSuccess className="grid sm:grid-cols-4 gap-3 items-end">
              <label className={labelClass}>
                {t("Category", "श्रेणी")}
                <select name="category" className={inputClass}>
                  {GRIEVANCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {grievanceName(c, lang)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                {t("What happened?", "क्या हुआ?")}
                <input
                  name="description"
                  required
                  minLength={10}
                  maxLength={500}
                  placeholder={t("At least 10 characters", "कम से कम 10 अक्षर")}
                  className={inputClass}
                />
              </label>
            </ActionForm>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle
          title={t("Audit trail", "पूरा रिकॉर्ड")}
          hint={t("Every negotiation and execution step, with who did it and when.", "मोलभाव और सौदे का हर कदम — किसने और कब किया।")}
        />
        <Timeline events={events} />
      </section>
    </div>
  );
}
