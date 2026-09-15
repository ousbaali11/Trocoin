"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PasswordInput } from "@/components/ui/PasswordInput";

/** Choix d'un nouveau mot de passe à partir du jeton reçu par e-mail. */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const mismatch = confirmation.length > 0 && password !== confirmation;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmation) return setError("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    try {
      await api("/auth/password/reset", { method: "POST", body: { token, password, passwordConfirmation: confirmation }, token: null });
      setDone(true);
      setTimeout(() => router.replace("/connexion"), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Réinitialisation impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="panel">
        <p className="eyebrow">Réinitialisation</p>
        <h1 style={{ fontSize: "1.8rem" }}>Lien incomplet</h1>
        <p className="muted">Ce lien est incomplet.<Link href="/mot-de-passe-oublie">Refaire une demande</Link>.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="eyebrow">Réinitialisation</p>
      <h1 style={{ fontSize: "1.8rem" }}>Choisir un nouveau mot de passe</h1>
      {done ? (
        <div className="alert alert-info">Mot de passe modifié. Vos autres sessions ont été déconnectées. Redirection vers la connexion…</div>
      ) : (
        <>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="password">Nouveau mot de passe</label>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
              <span className="hint">8 caractères minimum.</span>
            </div>
            <div className="field">
              <label htmlFor="confirmation">Confirmer le mot de passe</label>
              <PasswordInput id="confirmation" value={confirmation} onChange={setConfirmation} autoComplete="new-password" invalid={mismatch} />
              {mismatch && <span className="hint" style={{ color: "var(--brick)" }}>Les deux mots de passe ne correspondent pas.</span>}
            </div>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || mismatch || password.length < 8}>
              {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
