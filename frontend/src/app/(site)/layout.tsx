import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main style={{ minHeight: "calc(100vh - var(--header-h) - 320px)" }}>{children}</main>
      <Footer />
    </>
  );
}
