import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchPage } from "@/components/search/SearchPage";
import { api, SITE_URL } from "@/lib/api";
import type { CategoryNode } from "@/lib/types";

const DEFAULT_DESC = "Filtrez par catégorie, prix, état, distance et livraison. Vue liste ou carte, alertes sur vos recherches.";

/** Titre / description / canonique par catégorie (pages listées dans le sitemap) ou par mot-clé. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const sp = await searchParams;
  const category = typeof sp.category === "string" ? sp.category : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  if (category) {
    const tree = await api<CategoryNode[]>("/categories/tree", { token: null, revalidate: 3600 }).catch(() => [] as CategoryNode[]);
    for (const root of tree) {
      const node = root.slug === category ? root : root.children.find((c) => c.slug === category);
      if (node) {
        const parent = node === root ? "" : ` (${root.name})`;
        return {
          title: `${node.name} : annonces d'occasion${parent}`,
          description: `Toutes les annonces ${node.name} près de chez vous ou dans toute la France : particuliers et professionnels, prix, état, livraison, dons et échanges.`,
          alternates: { canonical: `${SITE_URL}/recherche?category=${node.slug}` },
        };
      }
    }
  }
  if (q) return { title: `« ${q} » : annonces`, description: `Annonces correspondant à « ${q} » sur Trocoin.`, robots: { index: false } };
  return { title: "Rechercher une annonce", description: DEFAULT_DESC, alternates: { canonical: `${SITE_URL}/recherche` } };
}

/**
 * Rendu à la demande : la page dépend des paramètres d'adresse. Sans cela, Next sert d'abord le
 * squelette puis diffuse le résultat dans un segment caché que le navigateur remplace ; pendant
 * cet instant, la page existe deux fois dans le DOM (bandeau livraison, zone aria-live en double).
 */
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="container page" style={{ minHeight: "calc(100vh - var(--header-h))" }} aria-busy="true"><div className="skeleton" style={{ height: 44, width: 320, marginBottom: 22 }} /><div className="skeleton" style={{ height: 480 }} /></div>}>
      <SearchPage />
    </Suspense>
  );
}
