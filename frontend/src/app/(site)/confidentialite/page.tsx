import { legalMetadata, LegalPageView } from "@/components/pages/LegalPageView";

// Rendu à la demande : le build (CI, Vercel) ne doit pas dépendre de l'API.
export const dynamic = "force-dynamic";
export const generateMetadata = () => legalMetadata("confidentialite");

export default function Page() {
  return <LegalPageView slug="confidentialite" eyebrow="Juridique · RGPD" />;
}
