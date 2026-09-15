"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

/**
 * Seconde étape de connexion quand la double authentification est activée : code à 6 chiffres
 * de l'application d'authentification, ou l'un des codes de récupération.
 */
export function TwoFactorStep({ challengeToken, onSuccess, onCancel }: { challengeToken: string; onSuccess: (tokens: { accessToken: string; refreshToken: string }) => Promise<void> | void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>("/auth/login/2fa", { method: "POST", body: { challengeToken, code: code.trim() }, token: null });
      await onSuccess(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible pour le moment.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} data-testid="two-factor-step">
      <div className="alert alert-info">Votre compte est protégé par la double authentification. Ouvrez votre application d&apos;authentification et saisissez le code affiché pour Trocoin.</div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="two-factor-code">Code de l&apos;application</label>
        <input id="two-factor-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={20} placeholder="123 456" />
        <span className="hint">Téléphone perdu ? Saisissez ici l&apos;un de vos codes de récupération (xxxxx-xxxxx).</span>
      </div>
      <button className="btn btn-primary btn-block btn-lg" disabled={busy || code.trim().length < 6}>
        {busy ? "Vérification…" : "Valider le code"}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={onCancel}>Revenir à la connexion</button>
    </form>
  );
}
