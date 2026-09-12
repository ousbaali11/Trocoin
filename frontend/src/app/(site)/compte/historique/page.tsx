"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { ListingCard as ListingCardType } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListingCard } from "@/components/ui/ListingCard";

export default function HistoriquePage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ListingCardType[] | null>(null);
  const load = () => api<ListingCardType[]>("/listings/history").then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);
  const clear = async () => {
    try {
      await api("/listings/history", { method: "DELETE" });
      toast("Historique effacé.", "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Annonces consultées</h1>
          <p className="muted" style={{ margin: 0 }}>Les 40 dernières annonces que vous avez ouvertes, de la plus récente à la plus ancienne.</p>
        </div>
        {items && items.length > 0 && <button className="btn btn-outline" onClick={clear}>Effacer l&apos;historique</button>}
      </div>
      {items === null ? <div className="skeleton" style={{ height: 200 }} /> : items.length === 0 ? (
        <EmptyState title="Aucune annonce consultée" text="Les annonces que vous ouvrez apparaîtront ici pour les retrouver facilement." action={{ href: "/recherche", label: "Explorer les annonces" }} />
      ) : (
        <div className="grid-cards">{items.map((l) => <ListingCard key={l.id} listing={l} showStatus />)}</div>
      )}
    </div>
  );
}
