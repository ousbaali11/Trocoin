import Link from "next/link";

/**
 * Retour (AUDIT §60) : médaillon rond, flèche dessinée dont la pointe avance et la hampe s'allonge au survol et au
 * focus, libellé facultatif. Remplace les « ← » tapés au clavier. Cible tactile de 40 px.
 */
export function BackLink({ href, label, showLabel = false }: { href: string; label: string; showLabel?: boolean }) {
  return (
    <Link href={href} className="back-link" aria-label={showLabel ? undefined : label} data-testid="back-link">
      <span className="back-link-disc" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path className="back-link-shaft" d="M19 12H6" />
          <path className="back-link-head" d="M11 6l-6 6 6 6" />
        </svg>
      </span>
      {showLabel && <span className="back-link-label">{label}</span>}
    </Link>
  );
}
