"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfirm } from "@/lib/confirm-context";
import { useToast } from "@/lib/toast-context";
import { formatDate } from "@/lib/format";

interface Session {
  id?: string;
  familyId?: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string | null;
  ip?: string | null;
  current?: boolean;
}

/** Résumé lisible d'un navigateur à partir de l'en-tête User-Agent (sans bibliothèque). */
function describe(ua?: string | null): string {
  if (!ua) return "Appareil inconnu";
  const os = /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Appareil";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "navigateur";
  return `${browser} sur ${os}`;
}

/**
 * Appareils connectés (Paramètres) : liste des sessions ouvertes (API GET /auth/sessions) et
 * déconnexion de tous les appareils (DELETE /auth/sessions, qui ferme aussi la session courante).
 */
export function SessionsSection() {
  const { logout } = useAuth();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    api<Session[]>("/auth/sessions").then(setSessions).catch(() => setSessions([]));
  }, []);

  const revokeAll = async () => {
    const ok = await confirm({ title: "Déconnecter tous les appareils ?", text: "Toutes les sessions seront fermées, y compris celle-ci : vous devrez vous reconnecter.", confirmLabel: "Tout déconnecter", danger: true });
    if (!ok) return;
    try {
      await api("/auth/sessions", { method: "DELETE" });
      toast("Tous les appareils ont été déconnectés.", "success");
      logout();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <section className="panel" id="appareils">
      <h2 className="h3">Appareils connectés</h2>
      <p className="small muted">Les sessions ouvertes sur votre compte (30 jours sans activité au plus). Un appareil que vous ne reconnaissez pas ? Déconnectez tout, puis changez votre mot de passe.</p>
      {sessions === null ? (
        <div className="skeleton" style={{ height: 60 }} />
      ) : sessions.length === 0 ? (
        <p className="small muted">Aucune session active.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }} data-testid="sessions">
          {sessions.map((s) => (
            <li key={s.familyId ?? s.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}>
              <span>
                <strong>{describe(s.userAgent)}</strong>
                {s.ip && <span className="muted"> · {s.ip}</span>}
              </span>
              <span className="muted">ouverte le {formatDate(s.createdAt)}{s.current ? " · cet appareil" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-outline btn-sm" onClick={revokeAll} disabled={!sessions || sessions.length === 0}>Déconnecter tous les appareils</button>
    </section>
  );
}
