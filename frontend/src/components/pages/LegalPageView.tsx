import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, ApiError, SITE_URL } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import type { LegalPage } from "@/lib/types";

export async function getLegalPage(slug: string): Promise<LegalPage | null> {
  try {
    return await api<LegalPage>(`/pages/${slug}`, { token: null, revalidate: 60 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Description SEO : premier paragraphe de la page, sans Markdown ni mentions « modèle à compléter ». */
function describe(content: string): string | undefined {
  const para = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("_") && !l.startsWith("[") && !l.startsWith("-"));
  const first = para[0]?.replace(/\*\*/g, "").replace(/_/g, "");
  return first ? (first.length > 155 ? first.slice(0, 152).trimEnd() + "…" : first) : undefined;
}

export async function legalMetadata(slug: string): Promise<Metadata> {
  const page = await getLegalPage(slug);
  if (!page) return { title: "Page introuvable" };
  return { title: page.title, description: describe(page.content), alternates: { canonical: `${SITE_URL}/${slug}` } };
}

/** Page éditée depuis le back-office (CMS) : contenu Markdown rendu et échappé. */
export async function LegalPageView({ slug, eyebrow }: { slug: string; eyebrow: string }) {
  const page = await getLegalPage(slug);
  if (!page) notFound();
  return (
    <div className="container page narrow">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{page.title}</h1>
      <p className="muted small">Dernière mise à jour : {formatDate(page.updatedAt)}</p>
      <div className="panel legal" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.content) }} />
      <style>{`.legal h2{font-size:1.25rem;margin-top:1.4em}.legal h2:first-child{margin-top:0}.legal h3{font-size:1.05rem;margin-top:1.2em}.legal ul{padding-left:20px}.legal p{margin:0 0 .9em}`}</style>
    </div>
  );
}
