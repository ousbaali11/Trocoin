"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { formatBuyerFeeFormula, formatDateTime, formatEuros, formatPercent, type FeeRates } from "@/lib/format";

export interface FeesInfo {
  rates: FeeRates;
  defaults: FeeRates;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Même calcul que l'API (computeQuote) : sert seulement à l'aperçu, le serveur reste la référence. */
function preview(price: number, r: FeeRates) {
  const commission = round2((price * r.commissionPercent) / 100);
  const buyerFee = round2(Math.min((price * r.buyerFeePercent) / 100 + r.buyerFeeFixed, r.buyerFeeCap));
  return { buyerTotal: round2(price + buyerFee), sellerPayout: round2(price - commission), kept: round2(commission + buyerFee) };
}
const KEYS: Array<{ key: keyof FeeRates; api: string; label: string; unit: string; step: string; max: number }> = [
  { key: "commissionPercent", api: "commission_percent", label: "Commission vendeur", unit: "%", step: "0.1", max: 30 },
  { key: "buyerFeePercent", api: "buyer_fee_percent", label: "Frais de protection acheteur : pourcentage", unit: "%", step: "0.1", max: 30 },
  { key: "buyerFeeFixed", api: "buyer_fee_fixed_eur", label: "Frais de protection acheteur : montant fixe", unit: "€", step: "0.05", max: 20 },
  { key: "buyerFeeCap", api: "buyer_fee_cap_eur", label: "Plafond des frais de protection", unit: "€", step: "0.5", max: 500 },
];

/**
 * Barème du paiement sécurisé (AUDIT §51) : commission vendeur et frais de protection acheteur, réglables sans
 * redéploiement. La valeur en vigueur est affichée à part des champs de saisie ; l'enregistrement demande une
 * confirmation qui rappelle que seules les nouvelles transactions sont concernées et que le changement est journalisé.
 */
export function FeeSettingsPanel({ fees, onSaved }: { fees: FeesInfo; onSaved: () => Promise<unknown> | void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<keyof FeeRates, string>>({ commissionPercent: "", buyerFeePercent: "", buyerFeeFixed: "", buyerFeeCap: "" });
  useEffect(() => {
    setForm({ commissionPercent: String(fees.rates.commissionPercent), buyerFeePercent: String(fees.rates.buyerFeePercent), buyerFeeFixed: String(fees.rates.buyerFeeFixed), buyerFeeCap: String(fees.rates.buyerFeeCap) });
  }, [fees]);

  const typed: FeeRates = { commissionPercent: Number(form.commissionPercent), buyerFeePercent: Number(form.buyerFeePercent), buyerFeeFixed: Number(form.buyerFeeFixed), buyerFeeCap: Number(form.buyerFeeCap) };
  // Nombre fini entre 0 et la limite, deux décimales au plus (mêmes bornes que l'API)
  const invalid = KEYS.filter((k) => form[k.key].trim() === "" || !Number.isFinite(typed[k.key]) || typed[k.key] < 0 || typed[k.key] > k.max || Math.abs(typed[k.key] * 100 - Math.round(typed[k.key] * 100)) > 1e-6);
  const changes = KEYS.filter((k) => typed[k.key] !== fees.rates[k.key]);
  const active = preview(10, fees.rates);
  const next = preview(10, typed);

  const save = async () => {
    if (invalid.length > 0 || changes.length === 0) return;
    const summary = changes.map((k) => `${k.label} : ${k.unit === "%" ? formatPercent(fees.rates[k.key]) : formatEuros(fees.rates[k.key])} → ${k.unit === "%" ? formatPercent(typed[k.key]) : formatEuros(typed[k.key])}`).join(" · ");
    const ok = await confirm({
      title: "Changer le barème du paiement sécurisé ?",
      text: `${summary}. Le nouveau barème s'applique uniquement aux transactions créées à partir de maintenant : les ventes en cours ou terminées gardent le leur. Le changement est inscrit au journal d'audit avec l'ancienne et la nouvelle valeur.`,
      confirmLabel: "Appliquer aux nouvelles transactions",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api("/admin/settings", { method: "PATCH", body: Object.fromEntries(changes.map((k) => [k.api, typed[k.key]])) });
      toast("Barème enregistré : il s'applique aux nouvelles transactions.", "success");
      await onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="a-panel" style={{ marginBottom: 16 }} aria-labelledby="fees-title" data-testid="fee-settings">
      <h2 className="h3" id="fees-title" style={{ marginTop: 0 }}>Commission et frais du paiement sécurisé</h2>
      <div data-testid="fees-active" style={{ border: "1px solid var(--a-ok)", background: "var(--a-ok-soft)", borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
        <strong>En vigueur actuellement :</strong> commission vendeur <strong>{formatPercent(fees.rates.commissionPercent)}</strong> · frais de protection acheteur <strong>{formatBuyerFeeFormula(fees.rates)}</strong>
        <div className="mono" style={{ marginTop: 4 }}>
          Exemple, article à 10 € : l&apos;acheteur paie {formatEuros(active.buyerTotal)}, le vendeur reçoit {formatEuros(active.sellerPayout)}, Trocoin garde {formatEuros(active.kept)} avant frais du prestataire de paiement.
        </div>
        <div className="mono" style={{ marginTop: 4 }}>
          {fees.lastChangedAt && fees.lastChangedBy ? <>Dernière modification : {formatDateTime(fees.lastChangedAt)} par l&apos;admin {fees.lastChangedBy.slice(0, 8)} · <Link href="/admin/journal">voir le journal d&apos;audit</Link></> : "Valeurs d'origine, jamais modifiées."}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {KEYS.map((k) => (
          <label key={k.key} className="mono" htmlFor={`fee-${k.api}`}>
            {k.label} ({k.unit})
            <input id={`fee-${k.api}`} className="a-input" type="number" min={0} max={k.max} step={k.step} inputMode="decimal" value={form[k.key]} onChange={(e) => setForm({ ...form, [k.key]: e.target.value })} aria-invalid={invalid.includes(k) ? true : undefined} />
          </label>
        ))}
      </div>
      <p className="mono" style={{ margin: "10px 0 0" }} data-testid="fees-preview">
        {invalid.length > 0
          ? `Valeur invalide : ${invalid.map((k) => k.label.toLowerCase()).join(", ")} (nombre entre 0 et la limite, deux décimales au plus).`
          : changes.length === 0
            ? "Aucun changement par rapport au barème en vigueur."
            : `Avec ces valeurs, article à 10 € : l'acheteur paierait ${formatEuros(next.buyerTotal)}, le vendeur recevrait ${formatEuros(next.sellerPayout)}, Trocoin garderait ${formatEuros(next.kept)}.`}
      </p>
      <p className="mono" style={{ margin: "6px 0 0" }}>Un changement ne vaut que pour les nouvelles transactions ; chaque vente garde le barème de son paiement. Il est inscrit au journal d&apos;audit (qui, quand, ancienne et nouvelle valeur).</p>
      <button className="a-btn primary" style={{ marginTop: 10 }} disabled={busy || invalid.length > 0 || changes.length === 0} onClick={save}>Enregistrer le barème</button>
    </section>
  );
}
