import type { MetadataRoute } from "next";
import { api, SITE_URL } from "@/lib/api";
import type { CategoryNode, SearchResult } from "@/lib/types";
import { HELP_ARTICLES } from "@/lib/help-content";

// Généré à la demande (pas figé au build, où l'API n'est pas forcément joignable) ; les appels API sont
// mis en cache 10 min pour les annonces : une annonce publiée, vendue ou retirée disparaît ou apparaît
// du sitemap dans ce délai, sans action manuelle.
export const dynamic = "force-dynamic";

/** Annonces en ligne : 50 par page (maximum de l'API), jusqu'à 2 000 URL (limite prudente bien sous les 50 000 d'un sitemap). */
const LISTING_PAGES = 40;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/recherche`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/aide`, changeFrequency: "monthly", priority: 0.4 },
    ...HELP_ARTICLES.map((a) => ({ url: `${SITE_URL}/aide/${a.slug}`, changeFrequency: "monthly" as const, priority: 0.3 })),
    { url: `${SITE_URL}/a-propos`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/accessibilite`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/cgu`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/confidentialite`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/mentions-legales`, changeFrequency: "yearly", priority: 0.2 },
  ];
  try {
    const tree = await api<CategoryNode[]>("/categories/tree", { revalidate: 3600 });
    for (const c of tree) {
      entries.push({ url: `${SITE_URL}/recherche?category=${c.slug}`, changeFrequency: "hourly", priority: 0.7 });
      for (const s of c.children) entries.push({ url: `${SITE_URL}/recherche?category=${s.slug}`, changeFrequency: "hourly", priority: 0.6 });
    }
    // Toutes les annonces en ligne (l'API ne renvoie que celles-là), les plus récentes d'abord, avec leur date de modification
    for (let page = 1; page <= LISTING_PAGES; page++) {
      const result = await api<SearchResult>(`/listings?page_size=50&page=${page}&sort=recent`, { revalidate: 600 });
      for (const l of result.items) entries.push({ url: `${SITE_URL}/annonces/${l.id}`, lastModified: l.updatedAt, changeFrequency: "daily", priority: 0.6 });
      if (result.items.length < 50) break;
    }
  } catch {
    /* API indisponible : sitemap minimal (pages statiques et aide) */
  }
  return entries;
}
