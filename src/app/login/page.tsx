import { prisma } from "@/lib/prisma";
import { loginAs, quickStart, registerUser } from "@/lib/actions";
import { getT } from "@/lib/lang";
import { DISTRICTS } from "@/lib/engine/config";

export default async function LoginPage() {
  const [{ t }, users] = await Promise.all([getT(), prisma.user.findMany({ orderBy: { name: "asc" } })]);

  const groups = [
    {
      role: "FARMER",
      title: t("Farmers", "किसान"),
      blurb: t("Create lots, compare markets, accept or counter offers.", "लॉट बनाएँ, मंडियों की तुलना करें, ऑफ़र स्वीकार करें या मोलभाव करें।"),
      color: "bg-emerald-50 border-emerald-300 hover:border-emerald-500",
    },
    {
      role: "FPO",
      title: t("Farmer Producer Organisation", "किसान उत्पादक संगठन (FPO)"),
      blurb: t("Pool member lots into bulk lots, sell together, split proceeds pro-rata.", "सदस्यों के लॉट मिलाकर बड़ा लॉट बनाएँ, मिलकर बेचें, कमाई मात्रा के अनुसार बाँटें।"),
      color: "bg-teal-50 border-teal-300 hover:border-teal-500",
    },
    {
      role: "BUYER",
      title: t("Buyers", "खरीदार"),
      blurb: t("Post demand, browse lots, make offers, book pickup, pay.", "माँग दर्ज करें, लॉट देखें, ऑफ़र दें, पिकअप बुक करें, भुगतान करें।"),
      color: "bg-amber-50 border-amber-300 hover:border-amber-500",
    },
    {
      role: "ADMIN",
      title: t("Platform admin", "प्लेटफ़ॉर्म एडमिन"),
      blurb: t("Verify users, resolve grievances, see the audit trail.", "उपयोगकर्ता सत्यापित करें, शिकायतें सुलझाएँ, पूरा रिकॉर्ड देखें।"),
      color: "bg-slate-50 border-slate-300 hover:border-slate-500",
    },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-emerald-900">{t("Choose a demo account", "डेमो खाता चुनें")}</h1>
        <p className="text-stone-600 mt-1 text-sm">
          {t(
            "All accounts and market data are seeded DEMO/SAMPLE data. Pick anyone to continue — use “Switch user” in the top bar to change roles mid-demo.",
            "सभी खाते और मंडी भाव नमूना (DEMO) डेटा हैं। आगे बढ़ने के लिए कोई भी खाता चुनें — भूमिका बदलने के लिए ऊपर “यूज़र बदलें” दबाएँ।"
          )}
        </p>
      </div>

      <form action={quickStart} className="mb-8">
        <button className="w-full bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl p-4 text-left">
          <div className="font-semibold">{t("Judge quick start → Find the best selling opportunity", "जज क्विक स्टार्ट → सबसे अच्छा बिक्री विकल्प देखें")}</div>
          <div className="text-xs text-emerald-200 mt-0.5">
            {t(
              "Logs in as demo farmer Ramesh Patil and opens SmartSell on his largest open lot.",
              "डेमो किसान रमेश पाटिल के रूप में लॉग इन करके उनके सबसे बड़े लॉट का स्मार्टसेल खोलता है।"
            )}
          </div>
        </button>
      </form>

      {groups.map((g) => (
        <section key={g.role} className="mb-6">
          <h2 className="font-semibold text-stone-800">{g.title}</h2>
          <p className="text-xs text-stone-500 mb-2">{g.blurb}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {users
              .filter((u) => u.role === g.role)
              .map((u) => (
                <form action={loginAs} key={u.id}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className={`w-full text-left border rounded-lg p-3 transition ${g.color}`}>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-stone-500">
                      {u.district} · {u.verified ? t("verified", "सत्यापित") : t("not verified", "असत्यापित")}
                    </div>
                  </button>
                </form>
              ))}
          </div>
        </section>
      ))}
      
      <section className="mb-8 border-t pt-8">
        <h2 className="font-semibold text-stone-800 mb-4">{t("Create a new demo account", "नया डेमो खाता बनाएँ")}</h2>
        <form action={registerUser} className="space-y-3 bg-white p-5 border rounded-xl">
          <div className="grid sm:grid-cols-2 gap-3">
            <input name="name" type="text" required placeholder={t("Full Name", "पूरा नाम")} className="border rounded p-2 text-sm" />
            <input name="phone" type="tel" required placeholder={t("Phone Number (10 digits)", "फ़ोन नंबर")} className="border rounded p-2 text-sm" />
            <select name="role" required className="border rounded p-2 text-sm bg-white">
              <option value="">{t("Select Role", "भूमिका चुनें")}</option>
              <option value="FARMER">Farmer</option>
              <option value="FPO">FPO</option>
              <option value="BUYER">Buyer</option>
            </select>
            <select name="district" required className="border rounded p-2 text-sm bg-white">
              <option value="">{t("Select District", "ज़िला चुनें")}</option>
              {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <button type="submit" className="w-full bg-stone-800 hover:bg-stone-900 text-white rounded p-3 font-medium transition">
            {t("Create Account & Login", "खाता बनाएँ और लॉग इन करें")}
          </button>
        </form>
      </section>
    </div>
  );
}
