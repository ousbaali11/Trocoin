"use client";

import { useEffect, useId, useState } from "react";

const STORAGE_KEY = "trocoin_filters_sections";

function readState(): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
function writeState(key: string, open: boolean) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readState(), [key]: open }));
  } catch {
    /* navigation privée : l'état reste en mémoire pour la page */
  }
}

/**
 * Section repliable du panneau « Tous les filtres » : en-tête bouton (chevron, compteur de
 * filtres actifs), ouverture animée par grid-template-rows, état ouvert / fermé mémorisé pour la
 * session (docs/design-system.md §5).
 */
export function FilterSection({ id, title, defaultOpen = false, activeCount = 0, children }: { id: string; title: string; defaultOpen?: boolean; activeCount?: number; children: React.ReactNode }) {
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const saved = readState()[id];
    // Une section avec un filtre actif s'ouvre d'elle-même, sinon on suit le choix mémorisé
    if (activeCount > 0) setOpen(true);
    else if (typeof saved === "boolean") setOpen(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggle = () => {
    setOpen((o) => {
      writeState(id, !o);
      return !o;
    });
  };

  return (
    <section className="filter-section" data-testid={`filter-section-${id}`} data-open={open}>
      <h2 style={{ margin: 0, fontSize: "inherit", fontFamily: "inherit", fontWeight: "inherit", letterSpacing: 0 }}>
        <button type="button" className="filter-section-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <span>
            {title}
            {activeCount > 0 && <span className="pill pill-green" style={{ marginLeft: 8 }}>{activeCount}</span>}
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.18s" }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </h2>
      <div className="accordion-body" data-open={open} id={bodyId} aria-hidden={!open}>
        <div>
          <div className="filter-section-body">{children}</div>
        </div>
      </div>
    </section>
  );
}
