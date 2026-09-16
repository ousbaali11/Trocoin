"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Carrousel horizontal de cartes (« Ces annonces peuvent vous intéresser ») : défilement natif
 * avec accroche, flèches affichées seulement quand le contenu déborde, molette et tactile conservés.
 */
export function CardCarousel({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ canPrev: false, canNext: false });

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setState({ canPrev: el.scrollLeft > 4, canNext: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);
  const go = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <div style={{ position: "relative" }} data-testid="card-carousel">
      <div ref={ref} className="card-carousel" role="region" aria-label={label}>
        {children}
      </div>
      {state.canPrev && <button type="button" className="card-carousel-arrow" style={{ left: -6 }} onClick={() => go(-1)} aria-label="Annonces précédentes">‹</button>}
      {state.canNext && <button type="button" className="card-carousel-arrow" style={{ right: -6 }} onClick={() => go(1)} aria-label="Annonces suivantes">›</button>}
    </div>
  );
}
