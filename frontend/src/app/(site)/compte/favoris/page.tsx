"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ListingCard as ListingCardType } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListingCard } from "@/components/ui/ListingCard";

export default function FavorisPage() {
  const [items, setItems] = useState<ListingCardType[] | null>(null);
  useEffect(() => {
    api<ListingCardType[]>("/users/me/favorites").then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <div>
      <h1>Mes favoris</h1>
      {items === null ? <div className="skeleton" style={{ height: 200 }} /> : items.length === 0 ? (
        <EmptyState title="Aucun favori" text="Cliquez sur le cœur d'une annonce pour la retrouver ici." action={{ href: "/recherche", label: "Explorer les annonces" }} />
      ) : (
        <div className="grid-cards">{items.map((l) => <ListingCard key={l.id} listing={l} showStatus />)}</div>
      )}
    </div>
  );
}
