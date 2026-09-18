"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { LoadError } from "@/components/ui/LoadError";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { formatDate, formatEuros } from "@/lib/format";
import type { Entitlements, Plan } from "@/lib/types";

export default function FormulePage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    api<Plan[]>("/plans").then(setPlans).catch(() => setFailed(true));
    api<Entitlements>("/users/me/entitlements").then(setEnt).catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const choose = async (p: Plan) => {
    setBusy(true);
    try {
      const r = await api<{ charged: number }>(`/users/me/subscription/${p.id}`, { method: "POST" });
      toast(r.charged > 0 ? `Formule ${p.name} activée (${formatEuros(r.charged)} / mois).` : `Formule ${p.name} activée gratuitement.`, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!(await confirm({ title: "Résilier votre formule ?", text: "Vous repasserez sur les conditions du compte sans formule à la fin de la période en cours.", confirmLabel: "Résilier", danger: true }))) return;
    try {
      await api("/users/me/subscription", { method: "DELETE" });
      toast("Formule résiliée.", "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const free = ent ? !ent.monetizationEnabled : false;
  return (
    <div>
      <h1>Formule</h1>
      {failed && <LoadError message="Impossible de charger les formules." onRetry={load} />}
      {!ent ? null : free ? (
        <div className="alert alert-success">
          <strong>Période de lancement : tout est gratuit.</strong> Annonces illimitées, mises en avant incluses, statistiques et vitrine pour tous les comptes, particuliers comme professionnels. Les formules ci-dessous s&apos;appliqueront uniquement quand la monétisation sera activée ; vous serez prévenu à l&apos;avance.
        </div>
      ) : (
        <div className="alert alert-info">
          {ent?.plan ? <>Votre formule actuelle : <strong>{ent.plan.name}</strong>{ent.subscription?.endsAt && ` (jusqu'au ${formatDate(ent.subscription.endsAt)})`}.</> : <>Aucune formule : {ent?.listingsLimit} annonces gratuites par 30 jours, mise en avant à l&apos;unité.</>}
        </div>
      )}
      {plans.length === 0 && !ent && !failed && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }} aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 220 }} />)}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {ent && plans.map((p) => {
          const current = ent?.plan?.id === p.id;
          return (
            <div key={p.id} className="panel" style={{ borderColor: current ? "var(--accent)" : undefined }}>
              <p className="eyebrow">{p.name}</p>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", fontWeight: 700 }}>
                {free ? <span style={{ color: "var(--accent)" }}>Gratuit</span> : p.priceMonthly === 0 ? "Gratuit" : <>{formatEuros(p.priceMonthly)}<span className="small muted"> / mois</span></>}
                {free && p.priceMonthly > 0 && <span className="small muted" style={{ textDecoration: "line-through", marginLeft: 8 }}>{formatEuros(p.priceMonthly)}</span>}
              </div>
              <p className="small muted">{p.description}</p>
              <ul className="small" style={{ paddingLeft: 18 }}>
                <li>{p.listingsIncluded === null || p.listingsIncluded === undefined ? "Annonces illimitées" : `${p.listingsIncluded} annonces en ligne`}</li>
                <li>{p.boostsIncluded === null || p.boostsIncluded === undefined ? "Mises en avant illimitées" : `${p.boostsIncluded} mises en avant / mois`}</li>
                {p.advancedStats && <li>Statistiques avancées</li>}
                {p.verifiedBadge && <li>Badge vérifié</li>}
                {p.customShop && <li>Vitrine personnalisée</li>}
              </ul>
              {current ? (
                <button className="btn btn-outline btn-block" onClick={cancel}>Formule actuelle · résilier</button>
              ) : (
                <button className="btn btn-primary btn-block" disabled={busy || free} onClick={() => choose(p)} title={free ? "Inutile pendant la période gratuite" : undefined}>
                  {free ? "Inclus gratuitement" : "Choisir cette formule"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!free && <p className="small muted" style={{ marginTop: 12 }}>Le prélèvement réel sera branché à l&apos;ouverture de la monétisation ; pour l&apos;instant la souscription est enregistrée sans paiement.</p>}
    </div>
  );
}
