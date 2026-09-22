import type { Metadata, Viewport } from "next";
import { Fraunces, Public_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";
import { ConfirmProvider } from "@/lib/confirm-context";
import { SITE_URL } from "@/lib/api";

const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Résultat Google sur le nom « Trocoin » : titre court qui dit ce qu'est le site, description fidèle (149 caractères)
  title: { default: "Trocoin — Les petites annonces entre voisins, en France", template: "%s · Trocoin" },
  description:
    "Trocoin, le site de petites annonces entre voisins : achetez, vendez, donnez ou échangez près de chez vous, paiement sécurisé et messagerie intégrée.",
  openGraph: { siteName: "Trocoin", locale: "fr_FR", type: "website" },
  robots: { index: true, follow: true },
};

/** Couleur de la barre du navigateur mobile (AUDIT §69, avec le manifeste). */
export const viewport: Viewport = { themeColor: "#0f7b5f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${publicSans.variable} ${fraunces.variable}`}>
      <body>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
