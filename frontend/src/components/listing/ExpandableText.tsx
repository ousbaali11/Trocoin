"use client";

import { useState } from "react";

const LIMIT = 500;

/** Description tronquée à 500 caractères (ou 8 lignes) avec « Voir plus » / « Voir moins » ; texte complet dans le HTML pour les moteurs. */
export function ExpandableText({ text, id = "description" }: { text: string; id?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LIMIT || text.split("\n").length > 8;
  return (
    <div data-testid="description" data-expanded={open ? "true" : "false"}>
      <p id={id} className={long && !open ? "description-clamped" : undefined} style={{ whiteSpace: "pre-wrap", margin: 0 }}>
        {text}
      </p>
      {long && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id}>
          {open ? "Voir moins" : "Voir plus"}
        </button>
      )}
    </div>
  );
}
