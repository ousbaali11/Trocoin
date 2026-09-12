"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

/** Cache partagé des favoris de l'utilisateur (évite un appel par carte). */
let cache: { ids: Set<string>; userId: string | null } = { ids: new Set(), userId: null };
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}
export async function loadFavorites(userId: string | null) {
  if (!userId) {
    cache = { ids: new Set(), userId: null };
    notify();
    return;
  }
  if (cache.userId === userId) return;
  try {
    const ids = await api<string[]>("/users/me/favorites/ids");
    cache = { ids: new Set(ids), userId };
  } catch {
    cache = { ids: new Set(), userId };
  }
  notify();
}

export function FavoriteButton({ listingId, compact = false }: { listingId: string; compact?: boolean }) {
  const { user, requireAuth } = useAuth();
  const { toast } = useToast();
  const [, force] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    loadFavorites(user?.id ?? null);
    return () => {
      listeners.delete(l);
    };
  }, [user?.id]);

  const active = cache.ids.has(listingId);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!requireAuth()) return;
    if (busy) return;
    setBusy(true);
    try {
      if (active) {
        await api(`/listings/${listingId}/favorite`, { method: "DELETE" });
        cache.ids.delete(listingId);
      } else {
        await api(`/listings/${listingId}/favorite`, { method: "POST" });
        cache.ids.add(listingId);
        toast("Ajouté à vos favoris", "success");
      }
      notify();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={active}
      aria-label={active ? "Retirer des favoris" : "Ajouter aux favoris"}
      title={active ? "Retirer des favoris" : "Ajouter aux favoris"}
      className={compact ? undefined : "btn btn-outline"}
      style={
        compact
          ? {
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "1px solid var(--line-soft)",
              background: "var(--white)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: active ? "var(--brick)" : "var(--ink-soft)",
              boxShadow: "var(--shadow)",
            }
          : { color: active ? "var(--brick)" : undefined }
      }
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.3 4.5 6.8 4.5c2 0 3.4 1.1 4.2 2.3.8-1.2 2.2-2.3 4.2-2.3 3.5 0 5.4 3.5 4.1 6.8C19.5 15.9 12 20.5 12 20.5z" />
      </svg>
      {!compact && (active ? "Dans vos favoris" : "Ajouter aux favoris")}
    </button>
  );
}
