"use client";

import { useEffect, useState } from "react";

/**
 * Présence animée : garde l'élément monté le temps de l'animation de sortie.
 * `mounted` dit s'il faut rendre l'élément, `leaving` s'il joue sa sortie (classe `menu-leave`…).
 */
export function usePresence(open: boolean, leaveMs = 170): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      // Réouverture pendant la sortie : le minuteur de démontage est annulé par le nettoyage de l'effet précédent
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setMounted(false);
      return;
    }
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, leaveMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { mounted, leaving };
}
