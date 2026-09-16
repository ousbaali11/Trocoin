"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type { SavedSearch } from "@/lib/types";

/**
 * « Suivre » un vendeur : une recherche sauvegardée dont le seul critère est ce vendeur
 * (`query.seller`). Elle prévient, comme toute alerte, à chaque nouvelle annonce publiée ;
 * elle apparaît et se gère dans « Mes recherches ». « Suivi » = alerte existante ; recliquer la retire.
 */
export function FollowSellerButton({ sellerId, sellerName, returnTo }: { sellerId: string; sellerName: string; returnTo: string }) {
  const { user, requireAuth } = useAuth();
  const { toast } = useToast();
  const [found, setFound] = useState<SavedSearch | null>(null);
  const [busy, setBusy] = useState(false);
  // Sans connexion, aucun suivi n'est possible : la valeur affichée est dérivée, pas remise à zéro dans l'effet
  const existing = user ? found : null;
  const setExisting = setFound;

  useEffect(() => {
    if (!user) return;
    api<SavedSearch[]>("/users/me/saved-searches")
      .then((list) => setFound(list.find((s) => s.query?.seller === sellerId) ?? null))
      .catch(() => setFound(null));
  }, [user, sellerId]);

  if (user?.id === sellerId) return null;

  const toggle = async () => {
    if (!requireAuth(returnTo)) return;
    setBusy(true);
    try {
      if (existing) {
        await api(`/users/me/saved-searches/${existing.id}`, { method: "DELETE" });
        setExisting(null);
        toast("Vous ne suivez plus ce vendeur.", "info");
      } else {
        const created = await api<SavedSearch>("/users/me/saved-searches", { method: "POST", body: { name: `Annonces de ${sellerName}`.slice(0, 80), query: { seller: sellerId }, notifyPush: true } });
        setExisting(created);
        toast("Vendeur suivi : vous serez prévenu de ses nouvelles annonces (gérable dans Mes recherches).", "success");
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`btn btn-sm ${existing ? "btn-dark" : "btn-outline"}`} onClick={toggle} disabled={busy} aria-pressed={!!existing} data-testid="follow-seller" title={existing ? "Ne plus recevoir ses nouvelles annonces" : "Être prévenu de ses nouvelles annonces"}>
      {existing ? "✓ Suivi" : "Suivre"}
    </button>
  );
}
