import { legalMetadata, LegalPageView } from "@/components/pages/LegalPageView";

export const revalidate = 60;
export const generateMetadata = () => legalMetadata("confidentialite");

export default function Page() {
  return <LegalPageView slug="confidentialite" eyebrow="Juridique · RGPD" />;
}
