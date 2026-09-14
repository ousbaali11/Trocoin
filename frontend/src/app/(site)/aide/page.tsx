import type { Metadata } from "next";
import Link from "next/link";
import { HELP_ARTICLES, HELP_SECTIONS } from "@/lib/help-content";
import { HelpSearch } from "@/components/help/HelpSearch";

export const metadata: Metadata = {
  title: "Centre d'aide",
  description: "Comment fonctionne Trocoin : compte, dépôt d'annonce, recherche, paiement sécurisé, sécurité, espace professionnel. Articles et questions fréquentes.",
};

export default function AidePage() {
  const popular = HELP_ARTICLES.filter((a) => a.popular);
  return (
    <div className="container page">
      <div style={{ maxWidth: 760, marginBottom: 32 }}>
        <p className="eyebrow">Centre d&apos;aide</p>
        <h1>Comment pouvons-nous vous aider ?</h1>
        <p className="muted">Des réponses concrètes sur chaque étape : compte, annonces, achat, paiement sécurisé, sécurité et espace professionnel.</p>
        <HelpSearch />
      </div>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: "1.25rem" }}>Questions les plus consultées</h2>
        <div className="row" style={{ gap: 8 }}>
          {popular.map((a) => (
            <Link key={a.slug} href={`/aide/${a.slug}`} className="btn btn-outline btn-sm">{a.title}</Link>
          ))}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {HELP_SECTIONS.map((s) => (
          <section key={s.slug} id={s.slug} className="panel" style={{ padding: 22 }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>{s.title}</h2>
            <p className="small muted" style={{ marginBottom: 12 }}>{s.intro}</p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {s.articles.map((a) => (
                <li key={a.slug}>
                  <Link href={`/aide/${a.slug}`} style={{ display: "block", padding: "7px 0", fontWeight: 500 }}>{a.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 36, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: "1.15rem", marginBottom: 4 }}>Vous n&apos;avez pas trouvé ?</h2>
          <p className="muted small" style={{ margin: 0 }}>Un problème sur une annonce ou une transaction se signale directement depuis la page concernée : notre équipe reçoit chaque signalement et vous répond par notification.</p>
        </div>
        <div className="row">
          <Link href="/aide/signaler" className="btn btn-outline">Comment signaler</Link>
          <Link href="/mentions-legales" className="btn btn-ghost">Nous contacter</Link>
        </div>
      </section>
    </div>
  );
}
