"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";

/**
 * Double authentification facultative : QR code à scanner dans une application d'authentification
 * (Google Authenticator, Aegis, Authy…), code de confirmation, puis codes de récupération affichés
 * une seule fois. Désactivation avec mot de passe + code.
 */
export function TwoFactorSection() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disable, setDisable] = useState({ password: "", code: "" });

  if (!user) return null;
  const enabled = !!user.twoFactorEnabled;

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api("/auth/2fa/setup", { method: "POST" }));
      setCode("");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Activation impossible pour le moment.", "error");
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ ok: true; recoveryCodes: string[] }>("/auth/2fa/enable", { method: "POST", body: { code: code.trim() } });
      setRecoveryCodes(res.recoveryCodes);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Activation impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  const closeSetup = () => {
    setSetup(null);
    setRecoveryCodes(null);
    setCode("");
    setError(null);
  };

  const submitDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/auth/2fa/disable", { method: "POST", body: { password: disable.password, code: disable.code.trim() } });
      await refresh();
      setDisableOpen(false);
      setDisable({ password: "", code: "" });
      toast("Double authentification désactivée.", "success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Désactivation impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      toast("Codes copiés dans le presse-papiers.", "success");
    } catch {
      toast("Copie impossible : notez les codes à la main.", "error");
    }
  };

  return (
    <section className="panel" id="double-authentification">
      <h2 className="h3">Double authentification</h2>
      <p className="small muted">
        Facultatif. En plus du mot de passe, un code à 6 chiffres vous sera demandé à chaque connexion. Ce code s&apos;affiche dans une application gratuite sur votre téléphone (Google Authenticator, Aegis, Authy…).
      </p>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {enabled ? (
          <span className="pill pill-green" data-testid="two-factor-status">Activée</span>
        ) : (
          <span className="pill pill-ochre" data-testid="two-factor-status">Désactivée</span>
        )}
        {enabled ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => { setError(null); setDisableOpen(true); }}>Désactiver</button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={start} disabled={busy}>{busy ? "Préparation…" : "Activer la double authentification"}</button>
        )}
      </div>

      <Modal open={!!setup} onClose={closeSetup} title={recoveryCodes ? "Codes de récupération" : "Activer la double authentification"}>
        {setup && !recoveryCodes && (
          <form onSubmit={enable}>
            <ol className="small" style={{ paddingLeft: 18, margin: "0 0 12px" }}>
              <li>Ouvrez l&apos;application sur votre téléphone et scannez ce QR code pour ajouter Trocoin.</li>
              <li>Saisissez ci-dessous le code à 6 chiffres qu&apos;elle affiche pour Trocoin.</li>
            </ol>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrCodeDataUrl} alt="QR code à scanner dans votre application d'authentification" width={180} height={180} style={{ borderRadius: 8, border: "1px solid var(--line-soft)" }} />
              <div className="small" style={{ flex: "1 1 200px", minWidth: 0 }}>
                <p style={{ marginTop: 0 }}>Impossible de scanner ? Saisissez cette clé dans l&apos;application :</p>
                <code data-testid="two-factor-secret" style={{ display: "block", overflowWrap: "anywhere", padding: 8, background: "var(--bg)", borderRadius: 6 }}>{setup.secret}</code>
              </div>
            </div>
            {error && <div className="alert alert-error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="enable-code">Code de l&apos;application</label>
              <input id="enable-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123 456" />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" disabled={busy || code.trim().replace(/\s/g, "").length !== 6}>{busy ? "Vérification…" : "Activer"}</button>
              <button type="button" className="btn btn-ghost" onClick={closeSetup}>Annuler</button>
            </div>
          </form>
        )}
        {recoveryCodes && (
          <div>
            <div className="alert alert-success" role="status">La double authentification est activée.</div>
            <p className="small">
              Notez ces codes et gardez-les en lieu sûr. Si vous perdez votre téléphone, chaque code vous permet de vous connecter <strong>une seule fois</strong>. Ils ne seront plus affichés.
            </p>
            <ul data-testid="recovery-codes" style={{ columns: 2, listStyle: "none", padding: 12, margin: "0 0 12px", background: "var(--bg)", borderRadius: 8, fontFamily: "ui-monospace, monospace", fontSize: "0.95rem" }}>
              {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={copyCodes}>Copier les codes</button>
              <button type="button" className="btn btn-primary" onClick={closeSetup}>J&apos;ai noté mes codes</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title="Désactiver la double authentification">
        <form onSubmit={submitDisable}>
          <p className="small muted" style={{ marginTop: 0 }}>Par sécurité, confirmez avec votre mot de passe et un code de l&apos;application (ou un code de récupération).</p>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="disable-password">Mot de passe</label>
            <PasswordInput id="disable-password" value={disable.password} onChange={(v) => setDisable({ ...disable, password: v })} autoComplete="current-password" />
          </div>
          <div className="field">
            <label htmlFor="disable-code">Code de l&apos;application ou de récupération</label>
            <input id="disable-code" className="input" value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} inputMode="numeric" autoComplete="one-time-code" maxLength={20} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-danger" disabled={busy || disable.password.length === 0 || disable.code.trim().length < 6}>{busy ? "Vérification…" : "Désactiver"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setDisableOpen(false)}>Annuler</button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
