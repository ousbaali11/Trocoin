"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import type { Plan } from "@/lib/types";

interface SettingsPayload {
  settings: Record<string, unknown>;
  plans: Plan[];
}

export default function AdminSettingsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [form, setForm] = useState({ free_listings_per_30_days: "20", boost_price_eur: "2.99", urgent_price_eur: "1.99" });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<SettingsPayload>("/admin/settings").then((d) => {
    setData(d);
    setPlans(d.plans);
    setForm({ free_listings_per_30_days: String(d.settings.free_listings_per_30_days ?? 20), boost_price_eur: String(d.settings.boost_price_eur ?? 2.99), urgent_price_eur: String(d.settings.urgent_price_eur ?? 1.99) });
  }).catch((e) => toast(e.message, "error")), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await api("/admin/settings", { method: "PATCH", body });
      toast(ok, "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const savePlan = async (p: Plan) => {
    setBusy(true);
    try {
      await api(`/admin/plans/${p.id}`, { method: "PATCH", body: { name: p.name, description: p.description, priceMonthly: p.priceMonthly, listingsIncluded: p.listingsIncluded ?? null, boostsIncluded: p.boostsIncluded ?? null, advancedStats: p.advancedStats, verifiedBadge: p.verifiedBadge, customShop: p.customShop, active: p.active, sortOrder: p.sortOrder } });
      toast(`Formule ${p.name} enregistrée.`, "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const setPlan = (id: string, patchP: Partial<Plan>) => setPlans((ps) => ps.map((p) => (p.id === id ? { ...p, ...patchP } : p)));

  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  const enabled = data.settings.monetization_enabled === true;

  return (
    <div>
      <div className="a-head"><div><h1>Monétisation et formules</h1><p>Interrupteur global. Tant qu&apos;il est désactivé, aucune limite ni aucun paiement ne s&apos;applique à personne (particuliers et professionnels).</p></div></div>

      <section className="a-panel" style={{ marginBottom: 16, borderColor: enabled ? "var(--a-warn)" : "var(--a-ok)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 className="h3" style={{ margin: "0 0 4px" }}>Monétisation : <span className={`a-pill ${enabled ? "warn" : "ok"}`}>{enabled ? "ACTIVÉE" : "DÉSACTIVÉE (site gratuit)"}</span></h2>
            <p className="mono" style={{ margin: 0 }}>{enabled ? "Quotas d'annonces, formules et mises en avant payantes en vigueur." : "Annonces illimitées, mises en avant gratuites, formules sans effet."}</p>
          </div>
          <button className={`a-btn ${enabled ? "" : "danger"}`} disabled={busy} onClick={async () => (await confirm({ title: enabled ? "Désactiver la monétisation ?" : "Activer la monétisation ?", text: enabled ? "Tout redevient gratuit et illimité pour tous les comptes." : "Les quotas et les prix s'appliqueront immédiatement à tous les comptes.", confirmLabel: enabled ? "Désactiver" : "Activer", danger: !enabled })) && patch({ monetization_enabled: !enabled }, enabled ? "Monétisation désactivée : le site est gratuit." : "Monétisation activée.")}>
            {enabled ? "Désactiver (repasser en gratuit)" : "Activer la monétisation"}
          </button>
        </div>
      </section>

      <div className="a-two">
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Paramètres (appliqués seulement si activée)</h2>
          <label className="mono">Annonces gratuites / 30 jours (compte sans formule)<input className="a-input" type="number" value={form.free_listings_per_30_days} onChange={(e) => setForm({ ...form, free_listings_per_30_days: e.target.value })} /></label>
          <label className="mono" style={{ display: "block", marginTop: 8 }}>Prix d&apos;une mise en avant (€)<input className="a-input" type="number" step="0.01" value={form.boost_price_eur} onChange={(e) => setForm({ ...form, boost_price_eur: e.target.value })} /></label>
          <label className="mono" style={{ display: "block", marginTop: 8 }}>Prix du macaron Urgent (€)<input className="a-input" type="number" step="0.01" value={form.urgent_price_eur} onChange={(e) => setForm({ ...form, urgent_price_eur: e.target.value })} /></label>
          <button className="a-btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={() => patch({ free_listings_per_30_days: Number(form.free_listings_per_30_days), boost_price_eur: Number(form.boost_price_eur), urgent_price_eur: Number(form.urgent_price_eur) }, "Paramètres enregistrés.")}>Enregistrer</button>
        </section>
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Fournisseur de paiement</h2>
          <p className="mono">Configuré par la variable d&apos;environnement <code>PAYMENT_PROVIDER</code> (mock · stripe · paypal). Actuellement les prélèvements réels ne sont pas branchés : les souscriptions sont enregistrées sans paiement.</p>
        </section>
      </div>

      <h2 className="h3" style={{ margin: "20px 0 10px" }}>Formules</h2>
      <div className="a-panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="a-table">
          <thead><tr><th>Nom</th><th>Prix / mois</th><th>Annonces (vide = illimité)</th><th>Mises en avant / mois</th><th>Stats</th><th>Badge</th><th>Vitrine</th><th>Active</th><th>Ordre</th><th><span className="sr-only">Enregistrer</span></th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td><input className="a-input" aria-label={`Nom de la formule ${p.name}`} value={p.name} onChange={(e) => setPlan(p.id, { name: e.target.value })} /><input className="a-input" aria-label={`Description de la formule ${p.name}`} style={{ marginTop: 4 }} value={p.description ?? ""} placeholder="Description" onChange={(e) => setPlan(p.id, { description: e.target.value })} /></td>
                <td><input className="a-input" aria-label={`Prix mensuel de la formule ${p.name}`} type="number" step="0.01" style={{ width: 90 }} value={p.priceMonthly} onChange={(e) => setPlan(p.id, { priceMonthly: Number(e.target.value) })} /></td>
                <td><input className="a-input" aria-label={`Annonces incluses dans la formule ${p.name} (vide = illimité)`} type="number" style={{ width: 90 }} value={p.listingsIncluded ?? ""} onChange={(e) => setPlan(p.id, { listingsIncluded: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                <td><input className="a-input" aria-label={`Mises en avant par mois de la formule ${p.name}`} type="number" style={{ width: 90 }} value={p.boostsIncluded ?? ""} onChange={(e) => setPlan(p.id, { boostsIncluded: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                <td><input type="checkbox" aria-label={`Statistiques avancées pour ${p.name}`} checked={p.advancedStats} onChange={(e) => setPlan(p.id, { advancedStats: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`Badge vérifié pour ${p.name}`} checked={p.verifiedBadge} onChange={(e) => setPlan(p.id, { verifiedBadge: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`Vitrine personnalisée pour ${p.name}`} checked={p.customShop} onChange={(e) => setPlan(p.id, { customShop: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`Formule ${p.name} active`} checked={p.active} onChange={(e) => setPlan(p.id, { active: e.target.checked })} /></td>
                <td><input className="a-input" aria-label={`Ordre d'affichage de la formule ${p.name}`} type="number" style={{ width: 60 }} value={p.sortOrder} onChange={(e) => setPlan(p.id, { sortOrder: Number(e.target.value) })} /></td>
                <td><button className="a-btn primary" disabled={busy} onClick={() => savePlan(p)} aria-label={`Enregistrer la formule ${p.name}`}>Enregistrer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
