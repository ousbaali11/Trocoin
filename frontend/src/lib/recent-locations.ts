"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/** Une localisation utilisée récemment (recherche ou dépôt d'annonce). */
export interface RecentLocation {
  city: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

const KEY = "trocoin_recent_locations";
export const MAX_RECENT_LOCATIONS = 5;

function readLocal(): RecentLocation[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.city === "string").slice(0, MAX_RECENT_LOCATIONS) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: RecentLocation[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* navigation privée ou stockage plein : l'historique reste en mémoire */
  }
}

const sameKey = (a: RecentLocation) => `${a.city.toLowerCase()}|${a.postalCode ?? ""}`;

/** Ajoute en tête (sans doublon), 5 entrées au plus. */
export function pushRecent(list: RecentLocation[], entry: RecentLocation): RecentLocation[] {
  const key = sameKey(entry);
  return [entry, ...list.filter((e) => sameKey(e) !== key)].slice(0, MAX_RECENT_LOCATIONS);
}

/**
 * Historique des dernières communes utilisées : conservé dans le navigateur (localStorage) et,
 * quand la personne est connectée, aussi dans son compte (`recentLocations` sur /users/me) pour
 * le retrouver sur un autre appareil. Les deux listes sont fusionnées (compte d'abord).
 * La liste n'est affichée que dans un menu ouvert au clic : aucune différence de rendu serveur/client.
 */
export function useRecentLocations(): { recent: RecentLocation[]; remember: (entry: RecentLocation) => void } {
  const { user } = useAuth();
  const [local, setLocal] = useState<RecentLocation[]>(() => readLocal());

  const recent = useMemo(() => {
    const fromAccount = ((user?.recentLocations ?? []) as RecentLocation[]).filter((e) => e && typeof e.city === "string");
    let merged = fromAccount.slice(0, MAX_RECENT_LOCATIONS);
    for (const e of local) if (!merged.some((m) => sameKey(m) === sameKey(e))) merged = [...merged, e];
    return merged.slice(0, MAX_RECENT_LOCATIONS);
  }, [user?.recentLocations, local]);

  const remember = useCallback(
    (entry: RecentLocation) => {
      if (!entry.city) return;
      const next = pushRecent(recent, entry);
      setLocal(next);
      writeLocal(next);
      if (user) api("/users/me", { method: "PATCH", body: { recentLocations: next } }).catch(() => undefined);
    },
    [recent, user],
  );

  return { recent, remember };
}
