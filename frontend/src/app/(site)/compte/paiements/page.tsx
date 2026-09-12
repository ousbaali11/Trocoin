"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

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

  const loadStatus = useCallback(
    () => api<StripeStatus>("/users/me/stripe-status").then((s) => { setStatus(s); refresh(); }).catch(() => null),
    [refresh],
  );

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (params.get("stripe") === "retour") toast("Merci ! Nous vérifions l'état de votre compte de versement.", "info");
  }, [params, toast]);

  const start = async () => {
    setBusy(true);
    try {
      const res = await api<{ url: string; mode: string }>("/users/me/stripe-onboarding-link", { method: "POST" });
      window.location.href = res.url;
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Paiements</h1>
      <section className="panel">
        <h3>Recevoir mes paiements</h3>
        <p className="muted">Pour encaisser les ventes réalisées avec le paiement sécurisé, configurez votre compte de versement auprès de notre prestataire de paiement (Stripe). Vos coordonnées bancaires ne transitent jamais par Trocoin.</p>
        {status === null ? <div className="skeleton" style={{ height: 40, width: 260 }} /> : status.onboardingComplete ? (
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
        {status?.mode === "mock" && <p className="small muted" style={{ marginTop: 12 }}>Environnement de démonstration : le parcours Stripe est simulé (aucune clé configurée).</p>}
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        <h3>Comment sont calculés les frais ?</h3>
        <ul className="small">
          <li>Acheteur : frais de protection de 5 % + 0,50 € (plafonnés à 15 €), affichés avant paiement.</li>
          <li>Vendeur : commission de 8 % retenue sur le versement.</li>
          <li>Aucun frais sur les remises en main propre payées hors plateforme — mais aucune protection non plus.</li>
        </ul>
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
