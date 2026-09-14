"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PasswordInput } from "@/components/ui/PasswordInput";

type AccountType = "particulier" | "professionnel";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/compte";
  return raw;
}

/** Clé de contrôle SIRET (Luhn) : même algorithme que l'API, pour un retour immédiat. */
function isValidSiret(s: string): boolean {
  if (!/^\d{14}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(s[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Inscription particulier / professionnel. Le compte est créé immédiatement,
 * sans SMS (phase de test) : le téléphone est enregistré « non vérifié ».
 */
export function RegisterForm() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [type, setType] = useState<AccountType>(params.get("type") === "professionnel" ? "professionnel" : "particulier");
  const [f, setF] = useState({ firstName: "", lastName: "", username: "", email: "", phoneNumber: "", password: "", passwordConfirmation: "", companyName: "", siret: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const siretDigits = f.siret.replace(/\s/g, "");
  const siretState = type === "professionnel" && siretDigits.length === 14 ? (isValidSiret(siretDigits) ? "ok" : "ko") : null;
  const pwMismatch = f.passwordConfirmation.length > 0 && f.password !== f.passwordConfirmation;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (f.password !== f.passwordConfirmation) return setError("Les deux mots de passe ne correspondent pas.");
    if (type === "professionnel" && siretState === "ko") return setError("SIRET invalide (clé de contrôle incorrecte).");
    setBusy(true);
    try {
      const body: Record<string, string> = {
        accountType: type,
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim(),
        username: f.username.trim(),
        email: f.email.trim(),
        phoneNumber: f.phoneNumber.trim(),
        password: f.password,
        passwordConfirmation: f.passwordConfirmation,
      };
      if (type === "professionnel") {
        body.companyName = f.companyName.trim();
        body.siret = siretDigits;
      }
      const res = await api<{ accessToken: string; refreshToken: string }>("/auth/register", { method: "POST", body, token: null });
      await login(res.accessToken, res.refreshToken);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Inscription impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <p className="eyebrow">Inscription</p>
      <h1 style={{ fontSize: "1.8rem" }}>Créer un compte</h1>
      <p className="muted">Un seul compte par numéro de mobile français (06 ou 07). Déjà inscrit ? <Link href={`/connexion?next=${encodeURIComponent(next)}`}>Se connecter</Link></p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="row" role="tablist" aria-label="Type de compte" style={{ gap: 8, marginBottom: 18 }}>
        <button type="button" role="tab" aria-selected={type === "particulier"} className={`btn ${type === "particulier" ? "btn-primary" : "btn-outline"}`} onClick={() => setType("particulier")}>Particulier</button>
        <button type="button" role="tab" aria-selected={type === "professionnel"} className={`btn ${type === "professionnel" ? "btn-primary" : "btn-outline"}`} onClick={() => setType("professionnel")}>Professionnel</button>
      </div>

      <form onSubmit={submit} noValidate>
        {type === "professionnel" && (
          <fieldset style={{ border: "1px solid var(--line-soft)", borderRadius: "var(--radius)", padding: 16, marginBottom: 16 }}>
            <legend className="label" style={{ padding: "0 6px" }}>Entreprise</legend>
            <div className="field">
              <label htmlFor="companyName">Raison sociale</label>
              <input id="companyName" className="input" value={f.companyName} onChange={(e) => set("companyName", e.target.value)} maxLength={120} required autoComplete="organization" />
            </div>
            <div className="field">
              <label htmlFor="siret">Numéro SIRET (14 chiffres)</label>
              <input id="siret" className="input" inputMode="numeric" value={f.siret} onChange={(e) => set("siret", e.target.value.replace(/[^\d\s]/g, ""))} maxLength={17} required placeholder="732 829 320 00074" />
              {siretState === "ok" && <span className="hint" style={{ color: "var(--accent-dark)" }}>✓ Clé de contrôle valide</span>}
              {siretState === "ko" && <span className="hint" style={{ color: "var(--brick)" }}>Clé de contrôle incorrecte : vérifiez le numéro.</span>}
            </div>
          </fieldset>
        )}

        <div className="form-row">
          <div className="field">
            <label htmlFor="firstName">{type === "professionnel" ? "Prénom du responsable" : "Prénom"}</label>
            <input id="firstName" className="input" value={f.firstName} onChange={(e) => set("firstName", e.target.value)} maxLength={60} required autoComplete="given-name" />
          </div>
          <div className="field">
            <label htmlFor="lastName">{type === "professionnel" ? "Nom du responsable" : "Nom"}</label>
            <input id="lastName" className="input" value={f.lastName} onChange={(e) => set("lastName", e.target.value)} maxLength={60} required autoComplete="family-name" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="username">Nom d&apos;utilisateur</label>
          <input id="username" className="input" value={f.username} onChange={(e) => set("username", e.target.value.replace(/\s/g, ""))} maxLength={30} required autoComplete="username" placeholder="ex. camille_d" />
          <span className="hint">3 à 30 caractères : lettres, chiffres, point, tiret, underscore. Sert aussi à se connecter.</span>
        </div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={120} required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="phone">Numéro de mobile</label>
          <input id="phone" className="input" type="tel" inputMode="tel" value={f.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value)} required autoComplete="tel" placeholder="06 12 34 56 78" />
          <span className="hint">Mobile français uniquement (06 ou 07). Aucun SMS n&apos;est envoyé pendant la phase de test.</span>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <PasswordInput id="password" value={f.password} onChange={(v) => set("password", v)} minLength={8} autoComplete="new-password" />
            <span className="hint">8 caractères minimum.</span>
          </div>
          <div className="field">
            <label htmlFor="passwordConfirmation">Confirmer le mot de passe</label>
            <PasswordInput id="passwordConfirmation" value={f.passwordConfirmation} onChange={(v) => set("passwordConfirmation", v)} autoComplete="new-password" invalid={pwMismatch} />
            {pwMismatch && <span className="hint" style={{ color: "var(--brick)" }}>Les deux mots de passe ne correspondent pas.</span>}
          </div>
        </div>

        <button className="btn btn-primary btn-block btn-lg" disabled={busy || pwMismatch || (type === "professionnel" && siretState !== "ok")}>
          {busy ? "Création…" : type === "professionnel" ? "Créer mon compte professionnel" : "Créer mon compte"}
        </button>
      </form>
      <hr className="divider" />
      <p className="small muted" style={{ margin: 0 }}>
        En créant un compte, vous acceptez les <Link href="/cgu">conditions d&apos;utilisation</Link> et la <Link href="/confidentialite">politique de confidentialité</Link>.
      </p>
    </div>
  );
}
