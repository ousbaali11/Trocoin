"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { CategoryNode } from "@/lib/types";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import styles from "./CategoryBar.module.css";

/**
 * Barre des familles sous l'en-tête (bureau uniquement, ≥ 1024 px) : chaque famille ouvre au
 * survol ou au clic un grand panneau avec ses sous-catégories en colonnes, comme sur leboncoin.
 * Sur mobile, le menu « Catégories » du bouton principal (accordéon) remplace cette barre.
 * Pas d'encart promotionnel : rien à inventer.
 */
export function CategoryBar() {
  const pathname = usePathname();
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    api<CategoryNode[]>("/categories/tree", { revalidate: 3600 }).then(setTree).catch(() => setTree([]));
  }, []);
  useEffect(() => setOpen(null), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        (root.current?.querySelector(`[data-family="${open}"]`) as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const enter = (slug: string) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpen(slug);
  };
  const leave = () => {
    closeTimer.current = window.setTimeout(() => setOpen(null), 180);
  };

  if (tree.length === 0) return null;
  const current = tree.find((r) => r.slug === open) || null;
  // Colonnes lisibles : au plus 8 sous-catégories par colonne
  const columns: CategoryNode["children"][] = [];
  if (current) for (let i = 0; i < current.children.length; i += 8) columns.push(current.children.slice(i, i + 8));

  return (
    <nav className={styles.bar} aria-label="Familles de catégories" ref={root} onMouseLeave={leave} onMouseEnter={() => closeTimer.current && window.clearTimeout(closeTimer.current)}>
      <div className={`container ${styles.inner}`}>
        <ul className={styles.list}>
          {tree.map((r) => (
            <li key={r.slug} onMouseEnter={() => enter(r.slug)}>
              <button
                type="button"
                data-family={r.slug}
                className={`${styles.family} ${open === r.slug ? styles.familyOpen : ""}`}
                aria-expanded={open === r.slug}
                aria-controls={open === r.slug ? `family-panel-${r.slug}` : undefined}
                onClick={() => setOpen(r.slug)}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {current && (
        <div className={styles.panel} id={`family-panel-${current.slug}`} role="region" aria-label={`Sous-catégories de ${current.name}`} onMouseEnter={() => enter(current.slug)}>
          <div className={`container ${styles.panelInner}`}>
            <div className={styles.panelHead}>
              <CategoryIcon name={current.icon} size={22} />
              <Link href={`/recherche?category=${current.slug}`} className={styles.panelTitle}>Tout {current.name}</Link>
            </div>
            <div className={styles.columns}>
              {columns.length === 0 && (
                <ul className={styles.column}>
                  <li><Link href={`/recherche?category=${current.slug}`}>Toutes les annonces {current.name}</Link></li>
                </ul>
              )}
              {columns.map((col, i) => (
                <ul key={i} className={styles.column}>
                  {col.map((c) => (
                    <li key={c.slug}><Link href={`/recherche?category=${c.slug}`}>{c.name}</Link></li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
