"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Filet vert en haut de l'écran pendant un changement de page : démarre au clic sur un lien
 * interne, s'arrête quand l'adresse a changé (sécurité : 8 s). Aucune action longue ne doit
 * ressembler à un écran figé (docs/design-system.md §7).
 */
export function RouteProgress() {
  const pathname = usePathname();
  const params = useSearchParams();
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
  }, [pathname, params]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("/") || href.startsWith("//")) return;
      const current = window.location.pathname + window.location.search;
      if (href === current || href.startsWith("#")) return;
      setActive(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setActive(false), 8000);
    return () => window.clearTimeout(t);
  }, [active]);

  if (!active) return null;
  return <div className="route-progress" role="progressbar" aria-label="Chargement de la page" aria-busy="true" />;
}
