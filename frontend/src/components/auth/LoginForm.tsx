"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { TwoFactorStep } from "./TwoFactorStep";

function safeNext(raw: string | null): string {
  if (!raw) return "/compte";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/compte";
  return raw;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MOBILE_PATTERN = /^(\+33|0033|33|0)\s*[67](\s*\d){8}$/;

/** Message d'aide avant l'envoi : format d'e-mail ou de mobile manifestement faux, sinon null. */
export function identifierProblem(raw: string): string | null {
  const v = raw.trim();
  if (v.includes("@") && !EMAIL_PATTERN.test(v)) return "Cette adresse e-mail n'est pas complète (exemple : prenom@exemple.fr).";
  if (/^[+\d\s.()-]+$/.test(v) && v.replace(/\D/g, "").length >= 6 && !MOBILE_PATTERN.test(v.replace(/[.()-]/g, ""))) return "Ce numéro n'est pas un mobile français (exemple : 06 12 34 56 78).";
  return null;
}

type LoginResponse = { accessToken: string; refreshToken: string } | { twoFactorRequired: true; challengeToken: string };

export function LoginForm() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const finish = async (tokens: { accessToken: string; refreshToken: string }) => {
    await login(tokens.accessToken, tokens.refreshToken);
    router.replace(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = identifierProblem(identifier);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await api<LoginResponse>("/auth/login", { method: "POST", body: { identifier: identifier.trim(), password }, token: null });
      if ("twoFactorRequired" in res) {
        // Mot de passe accepté : le code de l'application est demandé avant d'ouvrir la session
        setChallenge(res.challengeToken);
        setPassword("");
        return;
      }
      await finish(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <div className="panel">
        <p className="eyebrow">Connexion</p>
        <h1 style={{ fontSize: "1.8rem" }}>Double authentification</h1>
        <TwoFactorStep challengeToken={challenge} onSuccess={finish} onCancel={() => setChallenge(null)} />
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="eyebrow">Connexion</p>
      <h1 style={{ fontSize: "1.8rem" }}>Bon retour sur Trocoin</h1>
      <p className="muted">
        Pas encore de compte ? <Link href={`/inscription?next=${encodeURIComponent(next)}`}>Créer un compte</Link>
      </p>
      {next !== "/compte" && (
        <div className="alert alert-info">Connectez-vous pour continuer votre action. Vous y serez ramené automatiquement.</div>
      )}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="identifier">E-mail, nom d&apos;utilisateur ou mobile</label>
          <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" inputMode="email" required autoFocus aria-invalid={error ? true : undefined} />
        </div>
        <div className="field">
          <div className="row spread" style={{ alignItems: "baseline" }}>
            <label htmlFor="password">Mot de passe</label>
            <Link href="/mot-de-passe-oublie" className="small">Mot de passe oublié ?</Link>
          </div>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <button className="btn btn-primary btn-block btn-lg" disabled={busy || identifier.trim().length < 3 || password.length === 0}>
          {busy ? "Connexion…" : "Me connecter"}
        </button>
      </form>
    </div>
  );
}
