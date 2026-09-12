import type { Metadata } from "next";
import { Fraunces, Public_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";
import { SITE_URL } from "@/lib/api";

const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Trocoin — Petites annonces entre particuliers et professionnels en France", template: "%s · Trocoin" },
  description:
    "Achetez, vendez, donnez ou échangez près de chez vous. Trocoin est la plateforme d'annonces réservée aux numéros de mobile français, avec paiement sécurisé et messagerie intégrée.",
  openGraph: { siteName: "Trocoin", locale: "fr_FR", type: "website" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${publicSans.variable} ${fraunces.variable}`}>
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
