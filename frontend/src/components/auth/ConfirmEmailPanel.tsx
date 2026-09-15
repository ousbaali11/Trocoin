"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/** Page ouverte depuis le lien de l'e-mail : le jeton est envoyé une seule fois au serveur. */
export function ConfirmEmailPanel() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const { user, refresh } = useAuth();
  const [state, setState] = useState<{ status: "pending" | "ok" | "error"; email?: string; changed?: boolean; message?: string }>({ status: "pending" });
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api<{ ok: true; email: string; changed?: boolean }>("/auth/email/verify", { method: "POST", body: { token }, token: null })
      .then(async (res) => {
        setState({ status: "ok", email: res.email, changed: !!res.changed });
        await refresh().catch(() => undefined);
      })
      .catch((err) => setState({ status: "error", message: err instanceof ApiError ? err.message : "Confirmation impossible pour le moment. Réessayez plus tard." }));
  }, [token, refresh]);

  if (!token) {
    return (
      <div className="panel">
        <p className="eyebrow">Adresse e-mail</p>
        <h1 style={{ fontSize: "1.8rem" }}>Lien incomplet</h1>
        <p className="muted">Ce lien est incomplet. Vous pouvez demander un nouvel e-mail depuis <Link href="/compte/parametres#identifiants">vos paramètres</Link>.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="eyebrow">Adresse e-mail</p>
      <h1 style={{ fontSize: "1.8rem" }}>Confirmation de votre adresse</h1>
      {state.status === "pending" && <p className="muted" aria-live="polite">Vérification en cours…</p>}
      {state.status === "ok" && (
        <>
          <div className="alert alert-success" role="status">
            {state.changed ? <>Votre nouvelle adresse {state.email} est enregistrée et confirmée. Utilisez-la désormais pour vous connecter.</> : <>Votre adresse {state.email} est confirmée. Merci !</>}
          </div>
          <p>
            {user ? <Link className="btn btn-primary" href="/compte">Aller à mon compte</Link> : <Link className="btn btn-primary" href="/connexion?next=/compte">Se connecter</Link>}
          </p>
        </>
      )}
      {state.status === "error" && (
        <>
          <div className="alert alert-error" role="alert">{state.message}</div>
          <p className="muted small">
            {user ? (
              <>Demandez un nouvel e-mail depuis <Link href="/compte/parametres#identifiants">vos paramètres</Link>.</>
            ) : (
              <><Link href="/connexion?next=/compte/parametres">Connectez-vous</Link> puis demandez un nouvel e-mail depuis vos paramètres.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}
