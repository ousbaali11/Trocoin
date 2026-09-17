"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm-context";
import { useToast } from "@/lib/toast-context";
import { deliveryLabel, formatDateTime, formatEuros, TX_STATUS_LABELS } from "@/lib/format";
import type { ConversationSale } from "@/lib/types";

/**
 * Suivi de la vente épinglé en tête de la conversation (AUDIT §57). Les boutons appellent les routes /transactions
 * déjà utilisées par la page « Achats et ventes » : une action faite ici s'y retrouve, et inversement. Les actions
 * en un geste vivent ici (disponibilité, prêt pour la remise, réception) ; ce qui demande un formulaire — étiquette,
 * numéro de suivi, code de remise, litige, avis — reste sur la page de la vente, vers laquelle le panneau renvoie.
 */
export function SalePanel({ sale, onChanged }: { sale: ConversationSale; onChanged: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const seller = sale.role === "vendeur";
  const hand = sale.deliveryMethod === "main_propre";
  const st = TX_STATUS_LABELS[sale.status];
  const href = `/compte/transactions/${sale.id}`;

  const run = async (path: string, ok: string, body?: unknown) => {
    setBusy(true);
    try {
      await api(`/transactions/${sale.id}/${path}`, { method: "POST", body });
      toast(ok, "success");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const open = sale.status === "sequestre" || sale.status === "livree";
  const steps: Array<{ label: string; done: boolean }> = [
    { label: "Payé", done: true },
    { label: "Disponibilité confirmée", done: !!sale.sellerConfirmedAt || !!sale.shippedAt || sale.status === "confirme" },
    { label: hand ? "Prêt pour la remise" : "Expédié", done: !!sale.shippedAt || sale.status === "confirme" },
    { label: hand ? "Remis" : "Reçu", done: sale.status === "confirme" },
  ];

  return (
    <section data-testid="sale-panel" aria-label="Suivi de la vente" style={{ minWidth: 0, maxWidth: "100%", padding: "10px 16px", borderBottom: "1px solid var(--line-soft)", background: "var(--accent-tint)" }}>
      <div className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div className="small" style={{ minWidth: 0 }}>
          <span className={st.pill}>{st.label}</span>{" "}
          <strong>{seller ? "Vente" : "Achat"} · {formatEuros(sale.amount)}</strong>
        </div>
        <Link href={href} className="small" data-testid="sale-details" style={{ whiteSpace: "nowrap", fontWeight: 600 }}>Détails de la vente →</Link>
      </div>
      <div className="small muted" title={deliveryLabel(sale)} style={{ marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{deliveryLabel(sale)}</div>
      {(open || sale.status === "confirme") && (
        <ol data-testid="sale-steps" data-scroll-x className="quick-filters" style={{ listStyle: "none", display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 0", padding: 0 }}>
          {steps.map((s) => (
            <li key={s.label} className="small" data-done={s.done} style={{ position: "relative", flex: "0 0 auto", whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 999, border: "1px solid var(--line)", background: s.done ? "var(--accent)" : "var(--white)", color: s.done ? "#fff" : "var(--ink-muted)", fontSize: ".74rem", fontWeight: 600 }}>
              <span aria-hidden="true">{s.done ? "✓ " : "○ "}</span>{s.label}<span className="sr-only">{s.done ? " : fait" : " : à venir"}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
        {seller && sale.status === "sequestre" && !sale.sellerConfirmedAt && (
          <button className="btn btn-primary btn-sm" disabled={busy} data-testid="sale-confirm-availability" onClick={() => run("confirm-availability", "Disponibilité confirmée : l'acheteur est prévenu.")}>Confirmer que l&apos;article est disponible</button>
        )}
        {seller && sale.status === "sequestre" && hand && (
          <button className="btn btn-outline btn-sm" disabled={busy} data-testid="sale-ready" onClick={() => run("ship", "Acheteur prévenu.", {})}>Je suis prêt pour la remise</button>
        )}
        {seller && sale.status === "sequestre" && !hand && (
          <Link href={href} className={`btn btn-sm ${sale.sellerConfirmedAt ? "btn-primary" : "btn-outline"}`} data-testid="sale-ship">{sale.labelReady ? "Confirmer l'expédition" : "Préparer l'envoi (étiquette, suivi)"}</Link>
        )}
        {seller && sale.status === "livree" && hand && <Link href={href} className="btn btn-primary btn-sm">Saisir le code de remise</Link>}
        {seller && sale.status === "livree" && !hand && <span className="small muted">En attente de la confirmation de réception par l&apos;acheteur{sale.autoConfirmAt ? ` (acquise d'office le ${formatDateTime(sale.autoConfirmAt)})` : ""}.</span>}
        {!seller && sale.status === "sequestre" && <span className="small muted">{sale.sellerConfirmedAt ? (hand ? "Article disponible : convenez du rendez-vous ci-dessous." : "Article disponible : le vendeur prépare l'envoi.") : "En attente du vendeur : il doit confirmer que l'article est disponible."}</span>}
        {!seller && sale.status === "livree" && !hand && (
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            data-testid="sale-confirm-reception"
            onClick={async () => (await confirm({ title: "Confirmer la réception ?", text: "Le paiement sera versé au vendeur. Vérifiez l'article avant de confirmer : cette action est définitive.", confirmLabel: "J'ai bien reçu l'article" })) && run("confirm-delivery", "Réception confirmée, merci !")}
          >
            Confirmer la réception
          </button>
        )}
        {!seller && sale.status === "livree" && hand && <Link href={href} className="btn btn-primary btn-sm">Voir mon code de remise</Link>}
        {sale.trackingUrl && open && (
          <a className="btn btn-outline btn-sm" href={sale.trackingUrl} target="_blank" rel="noopener noreferrer" data-testid="sale-track">Suivre le colis{sale.trackingNumber ? ` (${sale.trackingNumber})` : ""}</a>
        )}
        {!seller && sale.status === "livree" && <Link href={href} className="small" style={{ color: "var(--brick)" }}>Un problème ?</Link>}
        {sale.status === "confirme" && <Link href={href} className="btn btn-outline btn-sm">Laisser un avis</Link>}
      </div>
    </section>
  );
}
