"use client";

import { useEffect } from "react";
import { markViewed } from "@/lib/viewed";

/** Fiche annonce : mémorise la consultation pour le badge « Déjà vu » des cartes de résultats. */
export function ViewedMarker({ listingId }: { listingId: string }) {
  useEffect(() => {
    markViewed(listingId);
  }, [listingId]);
  return null;
}
