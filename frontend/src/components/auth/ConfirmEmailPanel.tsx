"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ResendVerificationButton } from "@/components/account/ResendVerificationButton";

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

  // Lien inutilisable (incomplet, expiré ou déjà utilisé) : message clair et nouvel envoi depuis cette page (AUDIT §43)
  const renewBlock = (
    <div data-testid="confirm-email-renew">
      {user?.emailVerified ? (
        <div className="alert alert-success" role="status">Votre adresse {user.email} est déjà confirmée : rien à faire. <Link href="/compte">Aller à mon compte</Link></div>
      ) : user ? (
        <>
          <p style={{ margin: "0 0 10px" }}>Recevez un nouveau lien à l&apos;adresse <strong>{user.email}</strong> :</p>
          <ResendVerificationButton />
        </>
      ) : (
        <>
          <p style={{ margin: "0 0 10px" }}>Connectez-vous pour recevoir un nouveau lien : le bouton d&apos;envoi apparaîtra ici.</p>
          <Link className="btn btn-primary" href="/connexion?next=/confirmer-email" data-testid="confirm-email-login">Se connecter pour recevoir un nouveau lien</Link>
        </>
      )}
    </div>
  );

  if (!token) {
    return (
      <div className="panel">
        <p className="eyebrow">Adresse e-mail</p>
        <h1 style={{ fontSize: "1.8rem" }}>{user && !user.emailVerified ? "Recevoir un nouveau lien" : "Lien incomplet"}</h1>
        {!(user && !user.emailVerified) && <p className="muted">Ce lien est incomplet : ouvrez celui de l&apos;e-mail en entier, ou demandez-en un nouveau.</p>}
        {renewBlock}
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
          <div className="alert alert-error" role="alert" data-testid="confirm-email-invalid">
            <strong>Ce lien n&apos;est plus valable.</strong> Il a expiré (les liens durent 24 heures) ou a déjà été utilisé. Rien n&apos;est perdu : demandez un nouveau lien ci-dessous.
          </div>
          {renewBlock}
        </>
      )}
    </div>
  );
}
