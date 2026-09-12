"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { formatDate } from "@/lib/format";
import type { SavedSearch } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

function toQueryString(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) p.set(k, v.join(","));
    else p.set(k, String(v));
  }
  return p.toString();
}

export default function AlertesPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<SavedSearch[] | null>(null);
  const load = () => api<SavedSearch[]>("/users/me/saved-searches").then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  const toggle = async (s: SavedSearch, field: "notifyPush" | "notifySms") => {
    try {
      await api(`/users/me/saved-searches/${s.id}`, { method: "PATCH", body: { [field]: !s[field] } });
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const remove = async (s: SavedSearch) => {
    try {
      await api(`/users/me/saved-searches/${s.id}`, { method: "DELETE" });
      toast("Alerte supprimée.", "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Mes recherches</h1>
          <p className="muted" style={{ margin: 0 }}>Jusqu&apos;à 50 recherches sauvegardées. Nous vérifions les nouvelles annonces toutes les 5 minutes.</p>
        </div>
        <Link href="/recherche" className="btn btn-outline">Nouvelle recherche</Link>
      </div>
      {items === null ? <div className="skeleton" style={{ height: 160 }} /> : items.length === 0 ? (
        <EmptyState title="Aucune recherche sauvegardée" text="Depuis une page de résultats, cliquez sur « Sauvegarder cette recherche » pour être prévenu des nouvelles annonces." action={{ href: "/recherche", label: "Lancer une recherche" }} />
      ) : (
        <div className="stack">
          {items.map((s) => (
            <div key={s.id} className="card row spread" style={{ alignItems: "flex-start" }}>
              <div>
                <strong style={{ display: "block" }}>{s.name}</strong>
                <span className="small muted">Créée le {formatDate(s.createdAt)} · {s.matchesNotified} annonce{s.matchesNotified > 1 ? "s" : ""} signalée{s.matchesNotified > 1 ? "s" : ""}</span>
                <div className="row" style={{ marginTop: 8 }}>
                  <label className="checkbox small"><input type="checkbox" checked={s.notifyPush} onChange={() => toggle(s, "notifyPush")} /> Notification</label>
                  <label className="checkbox small"><input type="checkbox" checked={s.notifySms} onChange={() => toggle(s, "notifySms")} /> SMS</label>
                </div>
              </div>
              <div className="row">
                <Link href={`/recherche?${toQueryString(s.query)}`} className="btn btn-outline btn-sm">Voir les résultats</Link>
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--brick)" }} onClick={() => remove(s)}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
