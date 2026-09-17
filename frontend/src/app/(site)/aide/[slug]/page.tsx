import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findHelpArticle, HELP_ARTICLES } from "@/lib/help-content";
import { renderMarkdown } from "@/lib/markdown";
import { api } from "@/lib/api";
import { DEFAULT_FEE_RATES, formatBuyerFeeFormula, formatPercent, type FeeRates } from "@/lib/format";

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = findHelpArticle(slug);
  return a ? { title: `${a.title} · Aide`, description: a.summary } : { title: "Article introuvable" };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = findHelpArticle(slug);
  if (!article) notFound();
  const siblings = article.section.articles.filter((a) => a.slug !== article.slug);
  // Barème en vigueur (réglé par l'admin, AUDIT §51) : les articles portent des jetons, pas des chiffres en dur
  const fees = await api<{ fees?: FeeRates }>("/settings/public", { revalidate: 300 }).then((s) => s.fees ?? DEFAULT_FEE_RATES).catch(() => DEFAULT_FEE_RATES);
  return (
    <div className="container page narrow">
      <nav className="small muted" aria-label="Fil d'Ariane" style={{ marginBottom: 12 }}>
        <Link href="/">Accueil</Link> › <Link href="/aide">Centre d&apos;aide</Link> › <Link href={`/aide#${article.section.slug}`}>{article.section.title}</Link>
      </nav>
      <p className="eyebrow">{article.section.title}</p>
      <h1>{article.title}</h1>
      <p className="muted" style={{ fontSize: "1.05rem" }}>{article.summary}</p>
      <div className="panel legal" dangerouslySetInnerHTML={{ __html: renderMarkdown(article.body.replaceAll("{{frais_acheteur}}", formatBuyerFeeFormula(fees)).replaceAll("{{commission}}", formatPercent(fees.commissionPercent))) }} />
      <style>{`.legal h2{font-size:1.15rem;margin-top:1.4em}.legal h2:first-child{margin-top:0}.legal ul,.legal ol{padding-left:20px}.legal p{margin:0 0 .9em}.legal li{margin-bottom:.35em}`}</style>

      {siblings.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: "1.1rem" }}>Dans la même rubrique</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {siblings.map((a) => (
              <li key={a.slug}><Link href={`/aide/${a.slug}`}>{a.title}</Link> <span className="small muted">— {a.summary}</span></li>
            ))}
          </ul>
        </section>
      )}
      <p style={{ marginTop: 28 }}><Link href="/aide" className="btn btn-outline btn-sm">← Toutes les rubriques</Link></p>
    </div>
  );
}
