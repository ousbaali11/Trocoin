import { legalMetadata, LegalPageView } from "@/components/pages/LegalPageView";

export const revalidate = 60;
export const generateMetadata = () => legalMetadata("mentions-legales");

export default function Page() {
  return <LegalPageView slug="mentions-legales" eyebrow="Juridique" />;
}
