"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { LoadError } from "@/components/ui/LoadError";

interface PayoutStatus {
  connected: boolean;
  onboardingComplete: boolean;
  mode: string;
  kind?: "formulaire" | "guide" | null;
  ibanLast4?: string | null;
  requirements?: string[];
  needsHostedStep?: boolean;
  previousInvalidated?: boolean;
}

interface PayoutForm {
  firstName: string;
  lastName: string;
  dob: string; // AAAA-MM-JJ (champ date)
  line1: string;
  postalCode: string;
  city: string;
  iban: string;
  acceptTerms: boolean;
}

/** Espaces tous les 4 caractères, comme sur un RIB : plus facile à relire. */
const formatIban = (v: string) => v.replace(/[^0-9a-z]/gi, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();

/**
 * Compte de versement en un formulaire (AUDIT §63) : nom, date de naissance, adresse et IBAN, sans quitter Trocoin.
 * Ce sont les informations minimales qu'un prestataire de paiement doit recueillir pour verser un particulier en
 * France ; l'IBAN part une fois au prestataire, Trocoin n'en garde que les quatre derniers caractères.
 */
function PaiementsInner() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const params = useSearchParams();
  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  // Refus du prestataire : le message reste à l'écran (un toast disparaît avant d'être lu)
  const [formError, setFormError] = useState<{ message: string; field?: string; reason?: string } | null>(null);
  const [form, setForm] = useState<PayoutForm>({ firstName: "", lastName: "", dob: "", line1: "", postalCode: "", city: "", iban: "", acceptTerms: false });
  const set = (k: keyof PayoutForm, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Préremplissage depuis le profil : il ne reste en général que la date de naissance, la rue et l'IBAN à saisir
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({ ...f, firstName: f.firstName || user.firstName || "", lastName: f.lastName || user.lastName || "", postalCode: f.postalCode || user.postalCode || "", city: f.city || user.city || "" }));
  }, [user]);

  const loadStatus = useCallback(
    () => { setFailed(false); return api<PayoutStatus>("/users/me/stripe-status").then((s) => { setStatus(s); refresh(); }).catch(() => setFailed(true)); },
    [refresh],
  );
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);
  // Retour arrière depuis la page du prestataire : la page sort du cache du navigateur avec un bouton figé — on la réarme
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setBusy(false);
      loadStatus();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [loadStatus]);
  useEffect(() => {
    if (params.get("stripe") === "retour") toast("Merci ! Nous vérifions l'état de votre compte de versement.", "info");
  }, [params, toast]);

  const ibanOk = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(form.iban.replace(/\s+/g, "").toUpperCase());
  const dobParts = form.dob.split("-").map(Number);
  const dobOk = dobParts.length === 3 && dobParts.every((n) => Number.isInteger(n) && n > 0);
  const canSubmit = form.firstName.trim().length > 0 && form.lastName.trim().length > 0 && dobOk && form.line1.trim().length >= 3 && /^\d{5}$/.test(form.postalCode) && form.city.trim().length > 0 && ibanOk && form.acceptTerms && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    try {
      const s = await api<PayoutStatus>("/users/me/payout-account", {
        method: "POST",
        body: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), dob: { year: dobParts[0], month: dobParts[1], day: dobParts[2] }, address: { line1: form.line1.trim(), postalCode: form.postalCode, city: form.city.trim() }, iban: form.iban.replace(/\s+/g, ""), acceptTerms: true },
      });
      setStatus(s);
      setEditing(false);
      setForm((f) => ({ ...f, iban: "", acceptTerms: false }));
      toast(s.onboardingComplete ? "Compte de versement actif : vos ventes vous seront versées automatiquement." : "Informations transmises : votre compte de versement est en cours de validation.", "success");
      refresh();
    } catch (err) {
      const d = err instanceof ApiError ? (err.details as { field?: string; reason?: string } | undefined) : undefined;
      setFormError({ message: (err as Error).message, field: d?.field, reason: d?.reason });
    } finally {
      setBusy(false);
    }
  };

  /** Parcours guidé du prestataire : comptes professionnels, ou pièce demandée après coup. */
  const startHosted = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await api<{ url: string; mode: string }>("/users/me/stripe-onboarding-link", { method: "POST" });
      window.location.href = res.url;
    } catch (err) {
      const reason = err instanceof ApiError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
      setFormError({ message: (err as Error).message, reason });
      setBusy(false);
    }
  };

  const pro = user?.accountType === "professionnel";
  const showForm = !pro && status !== null && (editing || !status.connected || (!status.onboardingComplete && status.kind !== "guide" && !status.needsHostedStep));
  const errorBox = formError && (
    <div className="alert alert-error" role="alert" data-testid="payout-setup-error" style={{ margin: "12px 0 0" }}>
      {formError.message}

    </div>
  );

  return (
    <div>
      <h1>Paiements</h1>
      <section className="panel">
        <h2 className="h3">Recevoir mes paiements</h2>
        <p className="muted">Pour encaisser les ventes réalisées avec le paiement sécurisé, indiquez une fois où vous verser l&apos;argent. Vos coordonnées bancaires sont transmises à notre prestataire de paiement et ne sont jamais conservées par Trocoin.</p>

        {status === null && (failed ? <LoadError message="Impossible de lire l'état de votre compte de versement." onRetry={loadStatus} /> : <div className="skeleton" style={{ height: 40, width: 260 }} />)}

        {status?.onboardingComplete && !editing && (
          <div className="stack" data-testid="payout-active">
            <div className="alert alert-success" style={{ margin: 0 }}>
              <strong>Compte de versement actif.</strong> Vos ventes vous sont versées automatiquement après confirmation de réception
              {status.ibanLast4 ? <> sur le compte se terminant par <strong>•••• {status.ibanLast4}</strong></> : null}.
            </div>
            {!pro && <div><button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>Changer d&apos;IBAN</button></div>}
          </div>
        )}

        {status?.previousInvalidated && (
          <div className="alert alert-info" role="status" data-testid="payout-reset-notice" style={{ margin: "0 0 12px" }}>
            <strong>Votre configuration précédente n&apos;est plus valable</strong> (elle appartenait à un ancien environnement de notre prestataire). Recommencez-la ci-dessous : cela ne prend qu&apos;une minute.
          </div>
        )}
        {status && !status.onboardingComplete && status.connected && (status.requirements?.length || status.needsHostedStep) ? (
          <div className="alert alert-info" style={{ margin: "0 0 12px" }} data-testid="payout-pending">
            <strong>Compte de versement en cours de validation.</strong>
            {status.requirements && status.requirements.length > 0 && <> Il manque encore : {status.requirements.join(", ")}.</>}
            {status.needsHostedStep && (
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={startHosted}>Compléter la vérification</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={loadStatus}>Actualiser l&apos;état</button>
              </div>
            )}
          </div>
        ) : null}

        {pro && status && !status.onboardingComplete && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>Compte professionnel : la configuration se fait sur la page sécurisée de notre prestataire (raison sociale, représentant légal, IBAN de l&apos;entreprise).</p>
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={startHosted}>{busy ? "Redirection…" : status.connected ? "Reprendre la configuration" : "Configurer mon compte de versement"}</button>
              {status.connected && <button className="btn btn-outline" onClick={loadStatus}>Actualiser l&apos;état</button>}
            </div>
          </div>
        )}

        {showForm && (
          <form onSubmit={submit} className="stack" data-testid="payout-form" noValidate>
            <div className="form-row">
              <div className="field"><label htmlFor="po-first">Prénom</label><input id="po-first" className="input" autoComplete="given-name" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} required /></div>
              <div className="field"><label htmlFor="po-last">Nom</label><input id="po-last" className="input" autoComplete="family-name" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label htmlFor="po-dob">Date de naissance</label><input id="po-dob" className="input" type="date" autoComplete="bday" value={form.dob} onChange={(e) => set("dob", e.target.value)} required /></div>
              <div className="field"><label htmlFor="po-iban">IBAN</label><input id="po-iban" className="input" inputMode="text" autoComplete="off" spellCheck={false} placeholder="FR76 1234 5678 9012 3456 7890 123" value={form.iban} onChange={(e) => set("iban", formatIban(e.target.value))} aria-invalid={form.iban.length > 0 && !ibanOk ? true : undefined} required /></div>
            </div>
            <div className="field"><label htmlFor="po-line1">Adresse</label><input id="po-line1" className="input" autoComplete="address-line1" placeholder="N° et rue" value={form.line1} onChange={(e) => set("line1", e.target.value)} required /></div>
            <div className="form-row">
              <div className="field"><label htmlFor="po-cp">Code postal</label><input id="po-cp" className="input" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={form.postalCode} onChange={(e) => set("postalCode", e.target.value.replace(/\D/g, ""))} required /></div>
              <div className="field"><label htmlFor="po-city">Ville</label><input id="po-city" className="input" autoComplete="address-level2" value={form.city} onChange={(e) => set("city", e.target.value)} required /></div>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={form.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} />
              <span>J&apos;accepte les <a href="https://stripe.com/fr/connect-account/legal/full" target="_blank" rel="noopener noreferrer">conditions du service de versement</a> et je certifie que ce compte bancaire est à mon nom.</span>
            </label>
            {errorBox}
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={!canSubmit} data-testid="payout-submit" style={{ maxWidth: "100%", whiteSpace: "normal" }}>{busy ? "Enregistrement…" : "Enregistrer mon compte"}</button>
              {editing && <button type="button" className="btn btn-outline" onClick={() => { setEditing(false); setFormError(null); }}>Annuler</button>}
            </div>
            <p className="small muted" style={{ margin: 0 }}>Ces informations sont celles qu&apos;exige la réglementation sur les paiements pour verser un particulier. Au-delà d&apos;un certain volume de ventes, une pièce d&apos;identité pourra vous être demandée : vous en serez prévenu ici.</p>
          </form>
        )}
        {!showForm && errorBox}
        {status?.mode === "mock" && <p className="small muted" style={{ marginTop: 12 }}>Environnement de démonstration : le parcours de versement est simulé.</p>}
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        <h2 className="h3">Bon à savoir</h2>
        {user?.accountType === "particulier" && <p className="small muted" style={{ margin: 0 }}>Au-delà de 30 ventes ou 2 000 € par an, la réglementation européenne (DAC7) nous oblige à déclarer vos revenus : nous vous demanderons alors des informations complémentaires.</p>}
      </section>
    </div>
  );
}

export default function PaiementsPage() {
  return (
    <Suspense>
      <PaiementsInner />
    </Suspense>
  );
}
