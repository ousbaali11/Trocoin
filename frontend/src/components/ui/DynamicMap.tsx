"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

/** Leaflet dépend de window : chargé uniquement côté client. */
export const ListingsMapDynamic = dynamic(() => import("./ListingsMap").then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 520 }} />,
});
const ApproxMapInner = dynamic(() => import("./ListingsMap").then((m) => m.ApproxMap), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 320 }} />,
});

/**
 * Carte de la page d'annonce (et de l'aperçu avant publication) : le code Leaflet et les tuiles
 * (≈ 200 Ko) ne sont demandés que lorsque la section approche de l'écran.
 */
export function ApproxMapDynamic({ latitude, longitude, height = 320 }: { latitude: number; longitude: number; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ minHeight: height, borderRadius: "var(--radius)", overflow: "hidden" }} data-testid="approx-map">
      {near ? <ApproxMapInner latitude={latitude} longitude={longitude} height={height} /> : <div className="skeleton" style={{ height }} aria-hidden="true" />}
    </div>
  );
}
