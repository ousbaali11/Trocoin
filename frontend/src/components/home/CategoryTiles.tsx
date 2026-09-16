"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CategoryNode } from "@/lib/types";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { usePresence } from "@/lib/use-presence";
import styles from "@/app/(site)/home.module.css";

/**
 * Grille d'icônes des catégories sous l'en-tête de l'accueil (AUDIT §47), avec le panneau des
 * sous-catégories de l'ancienne rangée de familles (AUDIT §48) : au survol d'une tuile sur bureau
 * (pointeur précis, ≥ 1024 px), un panneau posé sous la tuile, large comme son contenu, sous-catégories
 * en colonnes de 8 au plus. Les tuiles elles-mêmes sont inchangées (icône + libellé, mêmes classes) ;
 * un clic navigue toujours vers la catégorie. Sans souris (mobile, tactile), rien ne s'ouvre : les
 * sous-catégories restent dans le menu principal (accordéon).
 */
export function CategoryTiles({ tree }: { tree: CategoryNode[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const presence = usePresence(!!open);
  const root = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelLeft, setPanelLeft] = useState(0);
  const closeTimer = useRef<number | null>(null);

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

  const hoverable = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)").matches;
  const enter = (slug: string) => {
    if (!hoverable()) return;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpen(slug);
  };
  const leave = () => {
    closeTimer.current = window.setTimeout(() => setOpen(null), 180);
  };

  useEffect(() => {
    if (open) setShown(open);
  }, [open]);
  useLayoutEffect(() => {
    const slug = open || shown;
    const band = root.current;
    const panel = panelRef.current;
    if (!slug || !band || !panel) return;
    const tile = band.querySelector<HTMLElement>(`[data-family="${slug}"]`);
    if (!tile) return;
    const bandBox = band.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    const maxLeft = Math.max(0, bandBox.width - panel.offsetWidth - 16);
    setPanelLeft(Math.round(Math.min(tileBox.left - bandBox.left, maxLeft)));
  }, [open, shown, presence.mounted]);

  const current = presence.mounted ? tree.find((r) => r.slug === (open || shown)) || null : null;
  const columns: CategoryNode["children"][] = [];
  if (current) for (let i = 0; i < current.children.length; i += 8) columns.push(current.children.slice(i, i + 8));

  return (
    <div className={styles.catBand} ref={root} onMouseLeave={leave} onMouseEnter={() => closeTimer.current && window.clearTimeout(closeTimer.current)}>
      <nav className={`container ${styles.categories}`} aria-label="Catégories" data-testid="category-tiles">
        {tree.map((c) => (
          <Link
            key={c.slug}
            href={`/recherche?category=${c.slug}`}
            className={styles.category}
            data-family={c.slug}
            aria-expanded={open === c.slug ? true : undefined}
            aria-controls={open === c.slug ? `family-panel-${c.slug}` : undefined}
            onMouseEnter={() => enter(c.slug)}
          >
            <span className={styles.categoryIcon}><CategoryIcon name={c.icon} /></span>
            <span>{c.name}</span>
          </Link>
        ))}
      </nav>
      {current && (
        <div ref={panelRef} style={{ left: panelLeft }} className={`${styles.panel} ${presence.leaving ? "menu-leave" : "menu-enter"}`} id={`family-panel-${current.slug}`} role="region" aria-label={`Sous-catégories de ${current.name}`} onMouseEnter={() => enter(current.slug)}>
          <div className={styles.panelInner}>
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
    </div>
  );
}
