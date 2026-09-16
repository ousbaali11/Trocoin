import Link from "next/link";
import { api, SITE_URL } from "@/lib/api";
import type { CategoryNode, SearchResult } from "@/lib/types";
import { ListingCard } from "@/components/ui/ListingCard";
import { CategoryTiles } from "@/components/home/CategoryTiles";
import { HomeSearch } from "@/components/home/HomeSearch";
import { RecentlyViewed } from "@/components/home/RecentlyViewed";
import styles from "./home.module.css";

export const revalidate = 60;

/** Adresse canonique de l'accueil (résolue sur metadataBase : https://www.trocoin.fr). */
export const metadata = { alternates: { canonical: "/" }, openGraph: { url: "/" } };

async function load() {
  try {
    const [tree, recent, pro, settings] = await Promise.all([
      api<CategoryNode[]>("/categories/tree", { revalidate: 3600 }),
      api<SearchResult>("/listings?page_size=8", { revalidate: 60 }),
      api<SearchResult>("/listings?seller_type=professionnel&page_size=4", { revalidate: 120 }),
      api<{ monetizationEnabled: boolean }>("/settings/public", { revalidate: 60 }).catch(() => ({ monetizationEnabled: false })),
    ]);
    return { tree, recent: recent.items, pro: pro.items, total: recent.total, ok: true, free: !settings.monetizationEnabled };
  } catch {
    return { tree: [], recent: [], pro: [], total: 0, ok: false, free: true };
  }
}

export default async function HomePage() {
  const { tree, recent, pro, total, ok, free } = await load();
  const jsonLd = [
    { "@context": "https://schema.org", "@type": "WebSite", name: "Trocoin", url: SITE_URL, inLanguage: "fr-FR", potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/recherche?q={search_term_string}` }, "query-input": "required name=search_term_string" } },
    // Organisation : logo PNG 512 px net (le favicon .ico ne convient pas aux résultats de recherche) ; aucun
    // « sameAs » : Trocoin n'a pas encore de profil public sur un réseau social (à ajouter le jour où il existe).
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Trocoin",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png`, width: 512, height: 512 },
      description: "Site français de petites annonces entre voisins : achat, vente, don et échange près de chez soi, paiement sécurisé et messagerie intégrée.",
    },
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {/* Grille d'icônes des catégories directement sous l'en-tête (AUDIT §47 : remplace l'ancienne
          rangée de liens texte ; le bandeau de réassurance a été retiré) ; panneau des sous-catégories
          au survol sur bureau (AUDIT §48) */}
      <CategoryTiles tree={tree} />
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroHead}>
            <h1 className={styles.heroTitle}>Rechercher une annonce</h1>
            <p className={styles.heroText}>
              Dans toute la France ou près de chez vous. Un compte par numéro de mobile français{free ? ", dépôt gratuit" : ""}.
            </p>
          </div>
          <HomeSearch total={total} />
        </div>
      </section>

      <RecentlyViewed />

      <section className="container" style={{ marginTop: 40 }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Fraîchement publiées</p>
            <h2 style={{ margin: 0 }}>Les dernières annonces</h2>
          </div>
          <Link href="/recherche" className="btn btn-outline">Voir toutes les annonces</Link>
        </div>
        {!ok && <div className="alert alert-error">Le service est momentanément indisponible. Réessayez dans quelques instants.</div>}
        {ok && recent.length === 0 && (
          <div className="panel" style={{ textAlign: "center" }}>
            <p>Aucune annonce pour le moment. Soyez le premier à publier !</p>
            <Link href="/deposer" className="btn btn-primary">Déposer une annonce</Link>
          </div>
        )}
        <div className="grid-cards">
          {recent.map((l) => <ListingCard key={l.id} listing={l} />)}
          {ok && recent.length > 0 && recent.length < 4 && (
            // Site jeune : une grille presque vide fait mauvaise impression, l'invitation remplit la rangée (audit §42)
            <Link href="/deposer" className={styles.inviteCard} data-testid="invite-card" aria-label="Vendez le vôtre : déposer une annonce">
              <span className={styles.inviteVisual} aria-hidden="true">
                <span className={styles.invitePlus}>+</span>
                <span className="eyebrow">Vendez le vôtre</span>
              </span>
              <span className={styles.inviteBody}>
                <span className={styles.inviteTitle}>Déposez une annonce</span>
                <span className={styles.inviteText}>Gratuit, en ligne en deux minutes.</span>
                <span className="btn btn-primary btn-sm">Déposer</span>
              </span>
            </Link>
          )}
        </div>
      </section>

      {pro.length > 0 && (
        <section className="container" style={{ marginTop: 48 }}>
          <div className="page-head">
            <div>
              <p className="eyebrow">Professionnels vérifiés</p>
              <h2 style={{ margin: 0 }}>Les boutiques Trocoin</h2>
            </div>
            <Link href="/recherche?seller_type=professionnel" className="btn btn-outline">Toutes les annonces pro</Link>
          </div>
          <div className="grid-cards">
            {pro.map((l) => <ListingCard key={l.id} listing={l} />)}
          </div>
        </section>
      )}

      <section className="container" style={{ marginTop: 56 }}>
        <div className={styles.steps}>
          <div>
            <p className="eyebrow">Comment ça marche</p>
            <h2>Trois étapes, zéro paperasse</h2>
          </div>
          <ol className={styles.stepList}>
            <li><strong>Un numéro, un compte.</strong> Inscription en deux minutes avec votre mobile français, votre e-mail et un mot de passe.</li>
            <li><strong>Publiez en deux minutes.</strong> Photos, prix, localisation approximative : votre annonce est en ligne aussitôt, ou vérifiée par notre équipe si besoin.</li>
            <li><strong>Échangez sereinement.</strong> Messagerie intégrée, paiement sécurisé avec fonds bloqués jusqu&apos;à la réception, avis après chaque vente.</li>
          </ol>
        </div>
      </section>

      <section className="container" style={{ marginTop: 48 }}>
        <div className={styles.proBanner}>
          <div>
            <p className="eyebrow">Espace professionnel</p>
            <h2>Garage, agence, commerce : ouvrez votre vitrine</h2>
            <p style={{ maxWidth: 560, margin: 0, color: "var(--ink-soft)" }}>
              Badge Pro, page boutique, import de catalogue, gestion à plusieurs, statistiques. {free ? "Toutes les fonctionnalités sont gratuites pendant le lancement." : "Formules à partir de 29 € par mois."}
            </p>
          </div>
          <Link href="/aide/espace-pro" className="btn btn-primary btn-lg">Découvrir l&apos;offre pro</Link>
        </div>
      </section>
    </>
  );
}
