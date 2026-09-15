"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { TwoFactorStep } from "./TwoFactorStep";

function safeNext(raw: string | null): string {
  // Uniquement des chemins internes (pas d'open redirect)
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/compte";
  return raw;
}

export function OtpLoginForm() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [normalized, setNormalized] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [devHint, setDevHint] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ phoneNumber: string }>("/auth/register/phone", { method: "POST", body: { phoneNumber: phone }, token: null });
      setNormalized(res.phoneNumber);
      setStep("code");
      setCooldown(60);
      setTimeout(() => codeRef.current?.focus(), 50);
      // Raccourci de développement : l'API ne répond ici qu'en mode SMS mock hors production.
      try {
        const dev = await api<{ code: string }>(`/dev/last-otp/${encodeURIComponent(res.phoneNumber)}`, { token: null });
        setDevHint(dev.code);
      } catch {
        setDevHint(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer le code.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ accessToken: string; refreshToken: string } | { twoFactorRequired: true; challengeToken: string }>("/auth/otp/verify", { method: "POST", body: { phoneNumber: normalized, code }, token: null });
      if ("twoFactorRequired" in res) {
        // Double authentification activée sur ce compte : code de l'application avant la session
        setChallenge(res.challengeToken);
        return;
      }
      await login(res.accessToken, res.refreshToken);
      router.replace(next);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Code invalide.";
      setError(msg);
      if (err instanceof ApiError && err.status === 429) setStep("phone");
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <div className="panel">
        <p className="eyebrow">Connexion par code SMS</p>
        <h1 style={{ fontSize: "1.8rem" }}>Double authentification</h1>
        <TwoFactorStep challengeToken={challenge} onSuccess={async (t) => { await login(t.accessToken, t.refreshToken); router.replace(next); }} onCancel={() => setChallenge(null)} />
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="eyebrow">Connexion par code SMS</p>
      <h1 style={{ fontSize: "1.8rem" }}>{step === "phone" ? "Votre numéro de mobile" : "Saisissez le code reçu"}</h1>
      <p className="muted">
        {step === "phone"
          ? "Réservé aux comptes créés par SMS avant l'inscription par formulaire. Un code vous est envoyé par SMS."
          : `Code à 6 chiffres envoyé au ${normalized.replace(/^\+33/, "0").replace(/(\d{2})(?=\d)/g, "$1 ")}. Valable 5 minutes.`}
      </p>
      {next !== "/compte" && step === "phone" && (
        <div className="alert alert-info">Connectez-vous pour continuer votre action. Vous y serez ramené automatiquement.</div>
      )}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {step === "phone" ? (
        <form onSubmit={requestCode}>
          <div className="field">
            <label htmlFor="phone">Numéro de mobile</label>
            <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="06 12 34 56 78" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus />
            <span className="hint">Les numéros étrangers ne sont pas acceptés sur Trocoin.</span>
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy || phone.replace(/\D/g, "").length < 10}>
            {busy ? "Envoi…" : "Recevoir mon code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <div className="field">
            <label htmlFor="code">Code de vérification</label>
            <input
              id="code"
              ref={codeRef}
              className="input"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              style={{ fontSize: "1.6rem", letterSpacing: "0.4em", textAlign: "center", fontFamily: "var(--font-display)" }}
              required
            />
            {devHint && (
              <span className="hint">
                Mode développement : code <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCode(devHint)}>{devHint}</button>
              </span>
            )}
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy || code.length !== 6}>
            {busy ? "Vérification…" : "Me connecter"}
          </button>
          <div className="row spread" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep("phone"); setCode(""); setError(null); }}>
              Changer de numéro
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={cooldown > 0 || busy} onClick={() => requestCode()}>
              {cooldown > 0 ? `Renvoyer dans ${cooldown} s` : "Renvoyer le code"}
            </button>
          </div>
        </form>
      )}
      <hr className="divider" />
      <p className="small muted" style={{ margin: 0 }}>
        En continuant, vous acceptez les <Link href="/cgu">conditions d&apos;utilisation</Link> et la <Link href="/confidentialite">politique de confidentialité</Link>.
      </p>
    </div>
  );
}
