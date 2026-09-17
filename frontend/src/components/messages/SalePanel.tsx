"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm-context";
import { useToast } from "@/lib/toast-context";
import { deliveryLabel, formatDateTime, formatEuros, TX_STATUS_LABELS } from "@/lib/format";
import type { ConversationSale } from "@/lib/types";
import { Disclosure } from "@/components/ui/Disclosure";

/**
 * Suivi de la vente épinglé en tête de la conversation (AUDIT §57). Les boutons appellent les routes /transactions
 * déjà utilisées par la page « Achats et ventes » : une action faite ici s'y retrouve, et inversement. Les actions
 * en un geste vivent ici (disponibilité, prêt pour la remise, réception) ; ce qui demande un formulaire — étiquette,
 * numéro de suivi, code de remise, litige, avis — reste sur la page de la vente, vers laquelle le panneau renvoie.
 */
export function SalePanel({ sale, listing, onChanged }: { sale: ConversationSale; listing?: { id: string; status: string } | null; onChanged: () => void }) {
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

  // Vente annulée ou remboursée (AUDIT §58) : l'annonce est restée « vendue » ; le vendeur la remet en ligne s'il a toujours l'article
  const canRelist = seller && ["annulee", "rembourse"].includes(sale.status) && listing?.status === "vendue";
  const relist = async () => {
    if (!listing) return;
    setBusy(true);
    try {
      await api(`/listings/${listing.id}`, { method: "PATCH", body: { status: "en_ligne" } });
      toast("Annonce remise en ligne.", "success");
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
      {/* En-tête repliable (AUDIT §60), replié par défaut : l'état et le montant restent lisibles, le détail se déplie */}
      <Disclosure tone="tint" testId="sale-summary" icon={<span>{seller ? "🏷️" : "🛍️"}</span>} label={<>{seller ? "Vente" : "Achat"} · {formatEuros(sale.amount)}</>} summary={st.label} openLabel="Détails" closeLabel="Réduire">
        <div className="small" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 4px 2px", fontSize: ".8rem" }}>
          <span className="muted" style={{ overflowWrap: "anywhere" }}>{deliveryLabel(sale)}</span>
          <span className="muted">{st.help}</span>
          <Link href={href} data-testid="sale-details" style={{ fontWeight: 700, alignSelf: "flex-start" }}>Détails de la vente →</Link>
        </div>
      </Disclosure>
      {(open || sale.status === "confirme") && (
        <ol data-testid="sale-steps" data-scroll-x className="quick-filters" style={{ listStyle: "none", display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 0", padding: 0 }}>
          {steps.map((s) => (
            <li key={s.label} className="small" data-done={s.done} style={{ position: "relative", flex: "0 0 auto", whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 999, border: "1px solid var(--line)", background: s.done ? "var(--accent)" : "var(--white)", color: s.done ? "#fff" : "var(--ink-muted)", fontSize: ".74rem", fontWeight: 600 }}>
              <span aria-hidden="true">{s.done ? "✓ " : "○ "}</span>{s.label}<span className="sr-only">{s.done ? " : fait" : " : à venir"}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="sale-actions" data-testid="sale-actions">
        {seller && sale.status === "sequestre" && !sale.sellerConfirmedAt && (
          <button className="btn btn-primary btn-sm" disabled={busy} data-testid="sale-confirm-availability" onClick={() => run("confirm-availability", "Disponibilité confirmée : l'acheteur est prévenu.")}>Confirmer que l&apos;article est disponible</button>
        )}
        {seller && sale.status === "sequestre" && hand && (
          <button className="btn btn-outline btn-sm" disabled={busy} data-testid="sale-ready" onClick={() => run("ship", "Acheteur prévenu.", {})}>Je suis prêt pour la remise</button>
        )}
        {seller && sale.status === "sequestre" && !hand && (
          <Link href={href} className={`btn btn-sm ${sale.sellerConfirmedAt ? "btn-primary" : "btn-outline"}`} data-testid="sale-ship">{sale.labelReady ? "Confirmer l'expédition" : sale.shippingPaid ? (sale.sellerConfirmedAt ? "Générer le bon d'envoi (PDF)" : "Bon d'envoi : après la confirmation") : "Préparer l'envoi (étiquette, suivi)"}</Link>
        )}
        {seller && sale.status === "livree" && hand && <Link href={href} className="btn btn-primary btn-sm">Saisir le code de remise</Link>}
        {seller && sale.status === "livree" && !hand && <span className="sale-note">En attente de la confirmation de réception par l&apos;acheteur{sale.autoConfirmAt ? ` (acquise d'office le ${formatDateTime(sale.autoConfirmAt)})` : ""}.</span>}
        {!seller && sale.status === "sequestre" && <span className="sale-note">{sale.sellerConfirmedAt ? (hand ? "Article disponible : convenez du rendez-vous ci-dessous." : "Article disponible : le vendeur prépare l'envoi.") : "En attente du vendeur : il doit confirmer que l'article est disponible."}</span>}
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
        {!seller && sale.status === "livree" && <Link href={href} className="btn btn-ghost btn-sm" style={{ color: "var(--brick)" }}>Un problème ?</Link>}
        {sale.status === "confirme" && <Link href={href} className="btn btn-outline btn-sm">Laisser un avis</Link>}
        {canRelist && (
          <>
            <span className="sale-note">Vente annulée : votre annonce est restée marquée « Vendue ».</span>
            <button className="btn btn-primary btn-sm" disabled={busy} data-testid="sale-relist" onClick={relist}>Remettre l&apos;annonce en ligne</button>
          </>
        )}
      </div>
    </section>
  );
}
