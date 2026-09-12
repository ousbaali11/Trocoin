"use client";

import dynamic from "next/dynamic";

/** Leaflet dépend de window : chargé uniquement côté client. */
export const ListingsMapDynamic = dynamic(() => import("./ListingsMap").then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 520 }} />,
});
export const ApproxMapDynamic = dynamic(() => import("./ListingsMap").then((m) => m.ApproxMap), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 260 }} />,
});
