"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PasswordInput } from "@/components/ui/PasswordInput";

/**
 * Changement d'adresse e-mail : mot de passe exigé, lien de confirmation envoyé à la nouvelle
 * adresse ; l'adresse actuelle reste active (et est prévenue) tant que le lien n'est pas ouvert.
 */
export function ChangeEmailForm({ currentEmail }: { currentEmail?: string | null }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ ok: true; email: string }>("/auth/email/change", { method: "POST", body: { newEmail: newEmail.trim(), password } });
      setSentTo(res.email);
      setPassword("");
      setNewEmail("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Changement impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }} data-testid="change-email">
      {sentTo && (
        <div className="alert alert-info" role="status">
          Un lien de confirmation a été envoyé à <strong>{sentTo}</strong>. Votre adresse actuelle{currentEmail ? ` (${currentEmail})` : ""} reste utilisée tant que ce lien n&apos;est pas ouvert (valable 24 heures).
        </div>
      )}
      {!open ? (
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>Changer d&apos;adresse e-mail</button>
      ) : (
        <form onSubmit={submit} className="panel" style={{ padding: 14, marginTop: 4 }}>
          <p className="small muted" style={{ marginTop: 0 }}>Un lien sera envoyé à la nouvelle adresse pour la confirmer. Par sécurité, votre adresse actuelle sera prévenue de la demande.</p>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="form-row">
            <div className="field">
              <label htmlFor="new-email">Nouvelle adresse e-mail</label>
              <input id="new-email" className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="email-password">Votre mot de passe</label>
              <PasswordInput id="email-password" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !newEmail.includes("@") || password.length === 0}>{busy ? "Envoi…" : "Envoyer le lien de confirmation"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setError(null); }}>Annuler</button>
          </div>
        </form>
      )}
    </div>
  );
}
