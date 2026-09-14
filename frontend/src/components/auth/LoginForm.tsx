"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PasswordInput } from "@/components/ui/PasswordInput";

function safeNext(raw: string | null): string {
  // Uniquement des chemins internes (pas d'open redirect)
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/compte";
  return raw;
}

/** Connexion par e-mail ou nom d'utilisateur + mot de passe. */
export function LoginForm() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>("/auth/login", { method: "POST", body: { identifier: identifier.trim(), password }, token: null });
      await login(res.accessToken, res.refreshToken);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

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
          <label htmlFor="identifier">E-mail ou nom d&apos;utilisateur</label>
          <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required autoFocus />
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
      <hr className="divider" />
      <p className="small muted" style={{ margin: 0 }}>
        Compte créé par SMS avant l&apos;inscription par formulaire ? <Link href={`/connexion/sms?next=${encodeURIComponent(next)}`}>Connexion par code SMS</Link>.
      </p>
    </div>
  );
}
