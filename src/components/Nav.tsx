import Link from "next/link";
import type { User } from "@prisma/client";
import { logout } from "@/lib/actions";
import { homePathFor } from "@/lib/session";
import { makeT, roleName, type UiLang } from "@/lib/i18n";
import LanguageToggle from "./ai/LanguageToggle";

export default function Nav({ user, lang }: { user: User | null; lang: UiLang }) {
  const t = makeT(lang);
  const LINKS: Record<User["role"], { href: string; label: string }[]> = {
    FARMER: [
      { href: "/farmer", label: t("My lots", "मेरे लॉट") },
      { href: "/markets", label: t("PricePulse", "मंडी भाव") },
      { href: "/farmer/fayda", label: t("Fayda forecast", "फ़ायदा अनुमान") },
      { href: "/farmer/field", label: t("Field Nigrani", "फ़ील्ड निगरानी") },
      { href: "/farmer/schemes", label: t("Schemes", "योजनाएँ") },
    ],
    FPO: [
      { href: "/fpo", label: t("FPO dashboard", "एफपीओ डैशबोर्ड") },
      { href: "/markets", label: t("PricePulse", "मंडी भाव") },
      { href: "/farmer/schemes", label: t("Schemes", "योजनाएँ") },
    ],
    BUYER: [
      { href: "/buyer", label: t("Marketplace", "बाज़ार") },
      { href: "/markets", label: t("PricePulse", "मंडी भाव") },
    ],
    ADMIN: [
      { href: "/admin", label: t("Admin", "एडमिन") },
      { href: "/markets", label: t("PricePulse", "मंडी भाव") },
    ],
  };
  const links = user ? [{ href: "/assistant", label: t("✨ AI Sahayak", "✨ एआई सहायक") }, ...LINKS[user.role]] : [];

  return (
    <header className="bg-emerald-900 text-white">
      <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href={user ? homePathFor(user.role) : "/login"} className="font-bold tracking-tight text-lg">
          FASALSETU <span className="text-emerald-300">AI</span>
        </Link>
        <nav className="order-last w-full sm:order-none sm:w-auto flex gap-4 text-sm overflow-x-auto">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-emerald-100 hover:text-white whitespace-nowrap">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <LanguageToggle current={lang} />
          <span className="text-[10px] uppercase tracking-wider bg-amber-400 text-amber-950 font-bold px-2 py-0.5 rounded">
            {t("Demo mode", "डेमो")}
          </span>
          {user ? (
            <>
              <span className="text-emerald-100 hidden sm:inline">
                {user.name} <span className="text-emerald-300">· {roleName(user.role, lang)}</span>
              </span>
              <form action={logout}>
                <button className="bg-emerald-800 hover:bg-emerald-700 px-3 py-1 rounded text-xs">{t("Switch user", "यूज़र बदलें")}</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="bg-emerald-800 px-3 py-1 rounded text-xs">
              {t("Log in", "लॉग इन")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
