"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { markViewed } from "@/lib/viewed";

/**
 * Fiche annonce affichée : mémorise la consultation pour le badge « Déjà vu » (stockage local) et
 * signale la vue à l'API (`POST /listings/:id/view`) : compteur « Vues » du vendeur et, pour un
 * membre, historique « Annonces consultées ». Une fois par affichage, une fois la session connue
 * (le jeton part avec l'appel), jamais depuis le rendu serveur ni les préchargements.
 */
export function ViewedMarker({ listingId }: { listingId: string }) {
  const { loading } = useAuth();
  useEffect(() => {
    markViewed(listingId);
  }, [listingId]);
  useEffect(() => {
    if (loading) return;
    api(`/listings/${listingId}/view`, { method: "POST" }).catch(() => undefined);
  }, [listingId, loading]);
  return null;
}
