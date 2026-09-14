"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

/** Demande de lien de réinitialisation (réponse identique que le compte existe ou non). */
export function ForgotPasswordForm() {
  const [identifier, setIdentifier] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/auth/password/forgot", { method: "POST", body: { identifier: identifier.trim() }, token: null });
      setSent(true);
      // Raccourci de développement : l'API ne répond ici qu'avec le fournisseur e-mail mock hors production.
      if (identifier.includes("@")) {
        try {
          const dev = await api<{ link: string }>(`/dev/last-reset-link/${encodeURIComponent(identifier.trim().toLowerCase())}`, { token: null });
          setDevLink(dev.link);
        } catch {
          setDevLink(null);
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Demande impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <p className="eyebrow">Mot de passe oublié</p>
      <h1 style={{ fontSize: "1.8rem" }}>Recevoir un lien de réinitialisation</h1>
      {sent ? (
        <>
          <div className="alert alert-info">
            Si un compte correspond à <strong>{identifier.trim()}</strong>, un e-mail avec un lien valable une heure vient de partir. Pensez à vérifier vos courriers indésirables.
          </div>
          {devLink && (
            <p className="small">
              Mode développement : <a href={devLink}>ouvrir le lien de réinitialisation</a>
            </p>
          )}
          <p className="small muted">Pas d&apos;e-mail sur votre compte ? Contactez le support : un administrateur peut vous remettre un mot de passe temporaire.</p>
        </>
      ) : (
        <>
          <p className="muted">Indiquez l&apos;e-mail ou le nom d&apos;utilisateur de votre compte.</p>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="identifier">E-mail ou nom d&apos;utilisateur</label>
              <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required autoFocus />
            </div>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || identifier.trim().length < 3}>
              {busy ? "Envoi…" : "Envoyer le lien"}
            </button>
          </form>
        </>
      )}
      <hr className="divider" />
      <p className="small muted" style={{ margin: 0 }}>
        <Link href="/connexion">Retour à la connexion</Link>
      </p>
    </div>
  );
}
