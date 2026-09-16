import { Suspense } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { RouteProgress } from "@/components/layout/RouteProgress";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense>
        <RouteProgress />
      </Suspense>
      <Header />
      <main id="contenu" tabIndex={-1} style={{ minHeight: "calc(100vh - var(--header-h) - 320px)", outline: "none" }}>{children}</main>
      <Footer />
    </>
  );
}
