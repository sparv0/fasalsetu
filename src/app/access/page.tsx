import { unlock } from "@/lib/accessActions";
import { safeNext } from "@/lib/access";
import { getT } from "@/lib/lang";
import ActionForm from "@/components/ActionForm";
import { Card, inputClass, labelClass } from "@/components/ui";

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const { t } = await getT();
  return (
    <div className="max-w-sm mx-auto py-10">
      <Card>
        <h1 className="text-xl font-bold text-emerald-900">FASALSETU AI</h1>
        <p className="text-sm text-stone-600 mt-1 mb-4">
          {t("This demo is private. Enter the access code shared by team CODESURGE.", "यह डेमो निजी है। टीम CODESURGE द्वारा दिया गया एक्सेस कोड डालें।")}
        </p>
        <ActionForm action={unlock} hidden={{ next: safeNext(next) }} submitLabel={t("Enter", "प्रवेश करें")} pendingLabel={t("Checking…", "जाँच रहे हैं…")} className="space-y-3">
          <label className={labelClass}>
            {t("Access code", "एक्सेस कोड")}
            <input name="code" type="password" required autoFocus autoComplete="off" className={inputClass} />
          </label>
        </ActionForm>
      </Card>
    </div>
  );
}
