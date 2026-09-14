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
  loading: () => <div className="skeleton" style={{ height: 260 }} />,
});

/**
 * Carte de la page d'annonce : le code Leaflet et les tuiles (≈ 200 Ko) ne sont demandés que
 * lorsque la section approche de l'écran, pour ne pas peser sur le chargement initial.
 */
export function ApproxMapDynamic({ latitude, longitude }: { latitude: number; longitude: number }) {
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
  return <div ref={ref} style={{ minHeight: 260 }}>{near ? <ApproxMapInner latitude={latitude} longitude={longitude} /> : <div className="skeleton" style={{ height: 260 }} aria-hidden="true" />}</div>;
}
