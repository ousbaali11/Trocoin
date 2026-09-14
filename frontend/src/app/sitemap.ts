import type { MetadataRoute } from "next";
import { api, SITE_URL } from "@/lib/api";
import type { CategoryNode, SearchResult } from "@/lib/types";
import { HELP_ARTICLES } from "@/lib/help-content";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/recherche`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/aide`, changeFrequency: "monthly", priority: 0.4 },
    ...HELP_ARTICLES.map((a) => ({ url: `${SITE_URL}/aide/${a.slug}`, changeFrequency: "monthly" as const, priority: 0.3 })),
    { url: `${SITE_URL}/a-propos`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/cgu`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/confidentialite`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/mentions-legales`, changeFrequency: "yearly", priority: 0.2 },
  ];
  try {
    const [tree, recent] = await Promise.all([
      api<CategoryNode[]>("/categories/tree", { revalidate: 3600 }),
      api<SearchResult>("/listings?page_size=50", { revalidate: 600 }),
    ]);
    for (const c of tree) {
      entries.push({ url: `${SITE_URL}/recherche?category=${c.slug}`, changeFrequency: "hourly", priority: 0.7 });
      for (const s of c.children) entries.push({ url: `${SITE_URL}/recherche?category=${s.slug}`, changeFrequency: "hourly", priority: 0.6 });
    }
    for (const l of recent.items) entries.push({ url: `${SITE_URL}/annonces/${l.id}`, lastModified: l.updatedAt, changeFrequency: "daily", priority: 0.6 });
  } catch {
    /* API indisponible : sitemap minimal */
  }
  return entries;
}
