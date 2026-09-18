import { requirePageUser } from "@/lib/session";
import { registerDevice } from "@/lib/actions";
import { deviceSummaries } from "@/lib/marketplace";
import { dateTime } from "@/lib/format";
import { getT } from "@/lib/lang";
import { aiEnabled } from "@/lib/ai/gemini";
import { storageAdvice } from "@/lib/ai/actions";
import { AiTextPanel } from "@/components/ai/AiPanels";
import ActionForm from "@/components/ActionForm";
import { Badge, Card, Empty, SectionTitle, Sparkline, inputClass, labelClass } from "@/components/ui";

const STATUS_TONE = { OK: "emerald", HIGH: "rose", LOW: "amber", NO_BAND: "stone" } as const;

export default async function FieldPage() {
  const user = await requirePageUser("FARMER");
  const { t, lang } = await getT();
  const devices = await deviceSummaries(user.id);
  const METRIC_HI: Record<string, string> = { temperature_c: "तापमान", humidity_pct: "हवा में नमी", soil_moisture_pct: "मिट्टी की नमी" };
  const STATUS_TEXT: Record<string, [string, string]> = {
    OK: ["ok", "ठीक"],
    HIGH: ["high", "ज़्यादा"],
    LOW: ["low", "कम"],
    NO_BAND: ["no threshold", "कोई सीमा नहीं"],
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{t("Field Nigrani", "फ़ील्ड निगरानी")}</h1>
        <p className="text-stone-600 text-sm">
          {t(
            "Optional sensor readings (e.g. ESP32 in the storage shed or field). Everything else in FASALSETU works without them; when present, storage alerts feed into SmartSell.",
            "वैकल्पिक सेंसर रीडिंग (जैसे गोदाम या खेत में ESP32)। FASALSETU का बाकी सब इनके बिना भी चलता है; सेंसर हों तो गोदाम की चेतावनियाँ स्मार्टसेल में दिखती हैं।"
          )}
        </p>
      </div>

      {devices.length > 0 && (
        <Card className="border-violet-200">
          <h2 className="font-semibold text-sm mb-2">{t("AI storage & field advisory", "एआई भंडारण और खेत सलाह")}</h2>
          <AiTextPanel run={storageAdvice} label={t("What should I do based on these readings?", "इन रीडिंग के आधार पर मुझे क्या करना चाहिए?")} enabled={aiEnabled()} />
        </Card>
      )}
      {devices.length === 0 && <Empty>{t("No devices registered yet.", "अभी कोई उपकरण दर्ज नहीं।")}</Empty>}
      <div className="space-y-4">
        {devices.map((d) => (
          <Card key={d.id}>
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <div>
                <h2 className="font-semibold">{d.name}</h2>
                <p className="text-xs text-stone-500">
                  {d.purpose === "STORAGE" ? t("Storage sensor", "गोदाम सेंसर") : t("Field sensor", "खेत सेंसर")} · {t("key ending", "कुंजी का अंत")} …{d.keyHint}
                </p>
              </div>
              {d.metrics.some((m) => m.status === "HIGH" || m.status === "LOW") ? <Badge tone="rose">{t("attention", "ध्यान दें")}</Badge> : <Badge tone="emerald">{t("normal", "सामान्य")}</Badge>}
            </div>
            {d.metrics.length === 0 ? (
              <p className="text-sm text-stone-500">{t("No readings in the last 48 hours.", "पिछले 48 घंटे में कोई रीडिंग नहीं।")}</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {d.metrics.map((m) => (
                  <div key={m.metric} className="border border-stone-100 rounded-lg p-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-stone-600">{lang === "hi" ? METRIC_HI[m.metric] : m.label}</span>
                      <Badge tone={STATUS_TONE[m.status]}>{t(...STATUS_TEXT[m.status])}</Badge>
                    </div>
                    <div className="text-2xl font-bold text-emerald-900">
                      {m.latest.toFixed(1)}
                      <span className="text-sm font-normal text-stone-500"> {m.unit}</span>
                    </div>
                    <Sparkline values={m.series} width={220} height={36} />
                    <div className="text-xs text-stone-400">
                      {m.band ? t(`Comfort band ${m.band[0]}–${m.band[1]}${m.unit} (configured) · `, `सुरक्षित सीमा ${m.band[0]}–${m.band[1]}${m.unit} · `) : ""}
                      {t("last reading", "आखिरी रीडिंग")} {dateTime(m.latestAt, lang)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <section>
        <SectionTitle
          title={t("Register a device", "उपकरण दर्ज करें")}
          hint={t(
            "You get a device key once. Program it into the device; it posts readings over HTTPS.",
            "उपकरण कुंजी सिर्फ़ एक बार दिखेगी। इसे उपकरण में डालें; वह HTTPS से रीडिंग भेजेगा।"
          )}
        />
        <Card>
          <ActionForm action={registerDevice} submitLabel={t("Register device", "उपकरण दर्ज करें")} pendingLabel={t("Registering…", "दर्ज कर रहे हैं…")} resetOnSuccess className="grid sm:grid-cols-3 gap-3 items-end">
            <label className={labelClass}>
              {t("Device name", "उपकरण का नाम")}
              <input name="name" required minLength={3} maxLength={60} placeholder={t("e.g. Shed sensor 2", "जैसे: गोदाम सेंसर 2")} className={inputClass} />
            </label>
            <label className={labelClass}>
              {t("Installed in", "कहाँ लगा है")}
              <select name="purpose" className={inputClass}>
                <option value="STORAGE">{t("Storage", "गोदाम")}</option>
                <option value="FIELD">{t("Field", "खेत")}</option>
              </select>
            </label>
          </ActionForm>
        </Card>
        <details className="mt-3">
          <summary className="text-sm text-stone-600 cursor-pointer">{t("Device API", "उपकरण API")}</summary>
          <pre className="text-xs bg-stone-900 text-stone-100 rounded-lg p-3 mt-2 overflow-x-auto">{`POST /api/iot/readings
x-device-key: <your device key>
Content-Type: application/json

{"readings":[{"metric":"humidity_pct","value":68.5},
             {"metric":"temperature_c","value":27.9}]}

metrics: temperature_c, humidity_pct, soil_moisture_pct
limits: 100 readings/request, 30 requests/minute/device`}</pre>
        </details>
      </section>
    </div>
  );
}
