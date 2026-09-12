import { legalMetadata, LegalPageView } from "@/components/pages/LegalPageView";

export const revalidate = 60;
export const generateMetadata = () => legalMetadata("cgu");

export default function Page() {
  return <LegalPageView slug="cgu" eyebrow="Juridique" />;
}
