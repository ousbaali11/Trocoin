"use client";

import { useId, useState } from "react";

/**
 * Bloc repliable (AUDIT §60) : une barre large — pastille d'icône, libellé, résumé, et à droite une commande
 * « Afficher / Réduire » avec un chevron dans un médaillon qui pivote — qui déplie son contenu en douceur
 * (hauteur animée, sans saut de mise en page). Replié par défaut. Bouton natif : clavier, `aria-expanded`,
 * `aria-controls` ; contenu replié retiré de la tabulation (`inert`) ; animation coupée si l'utilisateur la refuse.
 */
export function Disclosure({
  label,
  summary,
  icon,
  children,
  defaultOpen = false,
  tone = "plain",
  testId,
  openLabel = "Afficher",
  closeLabel = "Réduire",
}: {
  label: React.ReactNode;
  summary?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  tone?: "plain" | "tint";
  testId?: string;
  openLabel?: string;
  closeLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className="disclosure" data-open={open} data-tone={tone} data-testid={testId}>
      <button type="button" className="disclosure-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)} data-testid={testId ? `${testId}-toggle` : undefined}>
        {icon && <span className="disclosure-icon" aria-hidden="true">{icon}</span>}
        <span className="disclosure-text">
          <span className="disclosure-label">{label}</span>
          {summary && <span className="disclosure-summary">{summary}</span>}
        </span>
        <span className="disclosure-action">
          <span className="disclosure-action-label">{open ? closeLabel : openLabel}</span>
          <span className="disclosure-chevron" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </span>
      </button>
      {/* `inert` : le contenu replié n'est ni focalisable ni lu ; la hauteur s'anime par la grille (0fr → 1fr) */}
      <div className="disclosure-panel" id={panelId} {...(open ? {} : { inert: true })}>
        <div className="disclosure-inner">{children}</div>
      </div>
    </div>
  );
}
