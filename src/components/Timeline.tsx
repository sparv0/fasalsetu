"use client";

import type { AuditEvent, User } from "@prisma/client";
import { dateTime } from "@/lib/format";
import { auditName } from "@/lib/i18n";
import { useLang, useT } from "./I18nProvider";
import { Empty } from "./ui";

export default function Timeline({ events }: { events: (AuditEvent & { actor: User | null })[] }) {
  const lang = useLang();
  const t = useT();
  if (events.length === 0) return <Empty>{t("No activity yet.", "अभी कोई गतिविधि नहीं।")}</Empty>;
  return (
    <ol className="border-l-2 border-emerald-200 ml-2 space-y-3">
      {events.map((e) => (
        <li key={e.id} className="pl-4 relative">
          <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-emerald-600 border-2 border-white" />
          <div className="text-sm">
            <span className="font-medium">{auditName(e.action, lang)}</span>
            <span className="text-stone-600"> — {e.detail}</span>
          </div>
          <div className="text-xs text-stone-400">
            {dateTime(new Date(e.createdAt), lang)}
            {e.actor && ` · ${e.actor.name}`}
          </div>
        </li>
      ))}
    </ol>
  );
}
