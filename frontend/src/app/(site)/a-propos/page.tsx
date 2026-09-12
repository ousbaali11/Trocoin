import { legalMetadata, LegalPageView } from "@/components/pages/LegalPageView";

export const revalidate = 60;
export const generateMetadata = () => legalMetadata("a-propos");

export default function Page() {
  return <LegalPageView slug="a-propos" eyebrow="À propos" />;
}
