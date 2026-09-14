"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { ListingCard as ListingCardType } from "@/lib/types";
import { ListingCard } from "@/components/ui/ListingCard";

/**
 * Accueil, membre connecté : reprise des dernières annonces consultées
 * (comme le bloc « Vos dernières visites » des grands sites d'annonces).
 * Invisible pour les visiteurs et tant que l'historique est vide.
 */
export function RecentlyViewed() {
  const { user } = useAuth();
  const [items, setItems] = useState<ListingCardType[]>([]);

  useEffect(() => {
    if (!user) return;
    api<ListingCardType[]>("/listings/history").then((l) => setItems(l.filter((x) => x.status === "en_ligne").slice(0, 4))).catch(() => setItems([]));
  }, [user]);

  if (!user || items.length === 0) return null;
  return (
    <section className="container" style={{ marginTop: 32 }}>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <p className="eyebrow">Reprendre</p>
          <h2 style={{ margin: 0 }}>Vos dernières annonces consultées</h2>
        </div>
        <Link href="/compte/historique" className="btn btn-outline btn-sm">Tout l&apos;historique</Link>
      </div>
      <div className="grid-cards">
        {items.map((l) => <ListingCard key={l.id} listing={l} />)}
      </div>
    </section>
  );
}
