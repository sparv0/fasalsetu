import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/lang";
import Nav from "@/components/Nav";
import { I18nProvider } from "@/components/I18nProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FASALSETU AI",
  description: "Know your price. Know your buyer. Sell with confidence.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [user, { t, lang }] = await Promise.all([getCurrentUser(), getT()]);

  return (
    <html lang={lang} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <I18nProvider lang={lang}>
          <Nav user={user} lang={lang} />
          <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6">{children}</main>
          {user && (
            <Link
              href="/assistant"
              className="fixed bottom-4 right-4 z-50 bg-violet-600 hover:bg-violet-700 text-white rounded-full shadow-lg px-4 py-3 text-sm font-semibold"
            >
              {t("✨ Ask AI", "✨ एआई से पूछें")}
            </Link>
          )}
          <footer className="text-center text-xs text-stone-400 py-4 border-t border-stone-200">
            FASALSETU AI &middot; CODESURGE &middot; SIH26132 &middot;{" "}
            {t("DEMO MODE — seeded data only", "डेमो मोड — केवल नमूना डेटा")}
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}
