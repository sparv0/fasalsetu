import Link from "next/link";
import { getT } from "@/lib/lang";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="max-w-md mx-auto text-center py-16">
      <h1 className="text-xl font-bold text-emerald-900">{t("Not found", "नहीं मिला")}</h1>
      <p className="text-stone-600 mt-2 text-sm">
        {t("That page doesn't exist, or it belongs to another account.", "यह पेज मौजूद नहीं है, या किसी दूसरे खाते का है।")}
      </p>
      <Link href="/" className="inline-block mt-4 bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm">
        {t("Go to my dashboard", "मेरे डैशबोर्ड पर जाएँ")}
      </Link>
    </div>
  );
}
