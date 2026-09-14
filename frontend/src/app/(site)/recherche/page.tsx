import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchPage } from "@/components/search/SearchPage";

export const metadata: Metadata = {
  title: "Rechercher une annonce",
  description: "Filtrez par catégorie, prix, état, distance et livraison. Vue liste ou carte, alertes sur vos recherches.",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="container page" style={{ minHeight: "calc(100vh - var(--header-h))" }} aria-busy="true"><div className="skeleton" style={{ height: 44, width: 320, marginBottom: 22 }} /><div className="skeleton" style={{ height: 480 }} /></div>}>
      <SearchPage />
    </Suspense>
  );
}
