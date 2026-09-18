"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { LoadError } from "@/components/ui/LoadError";


interface StripeStatus {
  connected: boolean;
  onboardingComplete: boolean;
  mode: string;
}

function PaiementsInner() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const params = useSearchParams();
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Refus du prestataire de paiement : le message reste à l'écran (un toast disparaît avant d'être lu)
  const [startError, setStartError] = useState<{ message: string; reason?: string } | null>(null);


  const loadStatus = useCallback(
    () => { setFailed(false); return api<StripeStatus>("/users/me/stripe-status").then((s) => { setStatus(s); refresh(); }).catch(() => setFailed(true)); },
    [refresh],
  );

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);
  // Retour arrière depuis Stripe : la page sort du cache du navigateur avec « Redirection… » figé — on la réarme
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

  const start = async () => {
    setBusy(true);
    setStartError(null);
    try {
      const res = await api<{ url: string; mode: string }>("/users/me/stripe-onboarding-link", { method: "POST" });
      window.location.href = res.url;
    } catch (e) {
      const reason = e instanceof ApiError ? (e.details as { reason?: string } | undefined)?.reason : undefined;
      setStartError({ message: (e as Error).message, reason });
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Paiements</h1>
      <section className="panel">
        <h2 className="h3">Recevoir mes paiements</h2>
        <p className="muted">Pour encaisser les ventes réalisées avec le paiement sécurisé, configurez votre compte de versement auprès de notre prestataire de paiement. Vos coordonnées bancaires ne transitent jamais par Trocoin.</p>
        {status === null ? (failed ? <LoadError message="Impossible de lire l'état de votre compte de versement." onRetry={loadStatus} /> : <div className="skeleton" style={{ height: 40, width: 260 }} />) : status.onboardingComplete ? (
          <div className="alert alert-success" style={{ margin: 0 }}>Compte de versement actif : vos ventes vous sont versées automatiquement après confirmation de réception.</div>
        ) : status.connected ? (
          <div className="stack">
            <div className="alert alert-info" style={{ margin: 0 }}>Configuration commencée mais non terminée. Reprenez-la pour activer les versements.</div>
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={start}>Reprendre la configuration</button>
              <button className="btn btn-outline" onClick={loadStatus}>Actualiser l&apos;état</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={start}>{busy ? "Redirection…" : "Configurer mon compte de versement"}</button>
        )}
        {startError && (
          <div className="alert alert-error" role="alert" data-testid="payout-setup-error" style={{ margin: "12px 0 0" }}>
            {startError.message}
            {startError.reason && <span className="small" style={{ display: "block", marginTop: 6, opacity: 0.85 }}>Détail technique (mode test) : {startError.reason}</span>}
          </div>
        )}
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
