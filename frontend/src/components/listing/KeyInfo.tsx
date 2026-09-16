"use client";

import { useState } from "react";

export interface KeyInfoItem {
  key: string;
  label: string;
  value: string;
}

const VISIBLE = 6;

/**
 * « Les informations clés » : critères de la catégorie en grille à deux colonnes ; au-delà de six,
 * le reste se déplie avec « Voir les critères supplémentaires (n) ».
 */
export function KeyInfo({ items }: { items: KeyInfoItem[] }) {
  const [open, setOpen] = useState(false);
  const hidden = Math.max(0, items.length - VISIBLE);
  const shown = open ? items : items.slice(0, VISIBLE);
  return (
    <div data-testid="key-info">
      <dl className="key-info-grid" style={{ margin: 0 }}>
        {shown.map((it) => (
          <div key={it.key} className="key-info-row">
            <dt>{it.label}</dt>
            <dd>{it.value}</dd>
          </div>
        ))}
      </dl>
      {hidden > 0 && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Voir moins de critères" : `Voir les critères supplémentaires (${hidden})`}
        </button>
      )}
    </div>
  );
}

/**
 * « Équipements » : options cochées dans les critères (booléens à « oui »). Au-delà de six,
 * « Voir tous les équipements (n) » déplie la liste.
 */
export function Equipments({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  const hidden = Math.max(0, items.length - VISIBLE);
  const shown = open ? items : items.slice(0, VISIBLE);
  return (
    <div data-testid="equipments">
      <ul className="key-info-grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {shown.map((label) => (
          <li key={label} className="key-info-row" style={{ justifyContent: "flex-start", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-dark)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>
            {label}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Voir moins d'équipements" : `Voir tous les équipements (${items.length})`}
        </button>
      )}
    </div>
  );
}
