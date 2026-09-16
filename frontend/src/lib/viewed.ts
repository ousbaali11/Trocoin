"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * Annonces déjà consultées, pour le badge « Déjà vu » des cartes de résultats.
 * - Visiteur : liste locale au navigateur (100 derniers identifiants), alimentée par la fiche annonce.
 * - Membre connecté : la même liste locale, fusionnée avec l'historique serveur
 *   (`GET /listings/history/ids`, celui de la page « Annonces consultées »), donc valable d'un appareil à l'autre.
 */
const KEY = "trocoin_viewed";
const MAX = 100;

let ids = new Set<string>();
let loadedFor: string | null | undefined; // undefined = jamais chargé
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readLocal(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeLocal(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* stockage indisponible (navigation privée) : le badge reste local à la session */
  }
}

/** À appeler depuis la fiche annonce : mémorise l'identifiant en tête de liste. */
export function markViewed(id: string) {
  const list = [id, ...readLocal().filter((x) => x !== id)];
  writeLocal(list);
  ids.add(id);
  notify();
}

async function load(userId: string | null) {
  if (loadedFor === userId) return;
  loadedFor = userId;
  ids = new Set(readLocal());
  notify();
  if (!userId) return;
  try {
    const remote = await api<string[]>("/listings/history/ids");
    remote.forEach((id) => ids.add(id));
    notify();
  } catch {
    /* hors ligne ou session expirée : la liste locale suffit */
  }
}

/** Ensemble des identifiants consultés (mis à jour en direct). */
export function useViewedIds(userId: string | null): Set<string> {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    load(userId);
    return () => {
      listeners.delete(l);
    };
  }, [userId]);
  return ids;
}
