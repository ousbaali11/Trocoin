import Link from "next/link";
import styles from "./SearchPage.module.css";

export interface DiscoverData {
  breadcrumb: Array<{ slug: string; name: string }>;
  suggestions: Array<{ label: string; href: string }>;
  cities: Array<{ city: string; count: number }>;
}

/**
 * Bas d'une page de catégorie : recherches suggérées (sous-catégories et critères de la
 * catégorie), localisations les plus demandées (villes des annonces en ligne, puis grandes
 * villes) et fil d'Ariane. Tout vient de l'API `/listings/discover`, rien n'est inventé.
 */
export function DiscoverSections({ data, categorySlug }: { data: DiscoverData; categorySlug: string }) {
  return (
    <div className={styles.discover} data-testid="discover">
      {data.suggestions.length > 0 && (
        <section aria-labelledby="discover-suggestions">
          <h2 id="discover-suggestions" className="h3">Les utilisateurs recherchent aussi…</h2>
          <ul className={styles.discoverList}>
            {data.suggestions.map((s) => (
              <li key={s.href}><Link href={s.href}>{s.label}</Link></li>
            ))}
          </ul>
        </section>
      )}
      {data.cities.length > 0 && (
        <section aria-labelledby="discover-cities">
          <h2 id="discover-cities" className="h3">Localisations les plus demandées…</h2>
          <ul className={styles.discoverList}>
            {data.cities.map((c) => (
              <li key={c.city}>
                <Link href={`/recherche?category=${categorySlug}&city=${encodeURIComponent(c.city)}`}>
                  {c.city}{c.count > 0 && <span className="muted"> ({c.count})</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <nav className="small muted" aria-label="Chemin de la catégorie" style={{ marginTop: 20 }}>
        <Link href="/">Accueil</Link>
        {data.breadcrumb.map((b, i) => (
          <span key={b.slug}>
            {" › "}
            {i === data.breadcrumb.length - 1 ? <span aria-current="page">{b.name}</span> : <Link href={`/recherche?category=${b.slug}`}>{b.name}</Link>}
          </span>
        ))}
      </nav>
    </div>
  );
}
