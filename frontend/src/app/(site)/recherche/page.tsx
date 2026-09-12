import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchPage } from "@/components/search/SearchPage";

export const metadata: Metadata = {
  title: "Rechercher une annonce",
  description: "Filtrez par catégorie, prix, état, distance et livraison. Vue liste ou carte, alertes sur vos recherches.",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="container page"><div className="skeleton" style={{ height: 400 }} /></div>}>
      <SearchPage />
    </Suspense>
  );
}
