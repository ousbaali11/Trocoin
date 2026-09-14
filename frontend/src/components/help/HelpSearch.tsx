"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { searchHelp } from "@/lib/help-content";

/** Barre de recherche du centre d'aide : filtrage instantané des articles, sans appel réseau. */
export function HelpSearch() {
  const [q, setQ] = useState("");
  const results = useMemo(() => searchHelp(q).slice(0, 8), [q]);
  const active = q.trim().length >= 2;
  return (
    <div style={{ position: "relative", maxWidth: 640 }}>
      <label htmlFor="help-q" className="sr-only">Rechercher dans l&apos;aide</label>
      <input id="help-q" className="input" type="search" placeholder="Rechercher dans l'aide (ex. mot de passe, litige, SIRET)" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" style={{ minHeight: 50, fontSize: "1.02rem" }} />
      {active && (
        <div className="card" role="listbox" aria-label="Résultats" style={{ marginTop: 8, padding: 6 }}>
          {results.length === 0 ? (
            <p className="muted small" style={{ margin: 0, padding: "10px 12px" }}>Aucun article ne correspond. Essayez un autre mot, ou parcourez les rubriques ci-dessous.</p>
          ) : (
            results.map((a) => (
              <Link key={a.slug} href={`/aide/${a.slug}`} role="option" style={{ display: "block", padding: "10px 12px", borderRadius: "var(--radius-sm)" }}>
                <strong style={{ display: "block" }}>{a.title}</strong>
                <span className="small muted">{a.section.title} · {a.summary}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
