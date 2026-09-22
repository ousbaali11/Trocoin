"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { DELIVERY_LABELS, formatDateTime, formatEuros } from "@/lib/format";
import type { DeliveryAddress } from "@/lib/types";
import { statusPill } from "@/components/admin/AdminPager";

interface Party { id: string; displayName: string; phoneNumber: string; email?: string | null; accountType: string; suspended: boolean; deleted: boolean; ratingAvg: number; ratingCount: number }
const PROVIDER_STATE: Record<string, string> = { autorisee: "autorisé, non encaissé", encaissee: "encaissé par Trocoin", annulee: "autorisation annulée ou expirée", remboursee: "remboursé", en_attente: "non payé", inconnue: "inconnu" };

interface AdminTxDetail {
  id: string;
  buyerId: string;
  sellerId: string;
  paymentIssue?: string | null;
  paymentIssueAt?: string | null;
  provider?: { state: "autorisee" | "encaissee" | "annulee" | "remboursee" | "en_attente" | "inconnue"; detail?: string };
  status: string;
  amount: number;
  commission: number;
  buyerFee: number;
  deliveryMethod: "main_propre" | "colissimo" | "mondial_relay";
  deliveryTrackingNumber?: string | null;
  shippingAddress?: DeliveryAddress | null;
  hasHandoverCode: boolean;
  disputeReason?: string | null;
  disputeOpenedBy?: string | null;
  resolutionNote?: string | null;
  autoResolution?: string | null;
  createdAt: string;
  paidAt?: string | null;
  captureBefore?: string | null;
  autoConfirmAt?: string | null;
  disputeAllowedUntil?: string | null;
  shippedAt?: string | null;
  confirmedAt?: string | null;
  resolvedAt?: string | null;
  escrowModel?: "destination" | "platform";
  paymentMethod?: string | null;
  capturedAt?: string | null;
  shipBy?: string | null;
  transferredAt?: string | null;
  buyer: Party | null;
  seller: Party | null;
  listing: { id: string; title: string; price?: number | null; status: string } | null;
  listingTitle?: string | null;
  shipment: { status: string; carrier: string; mode: string; trackingNumber?: string | null; trackingUrl?: string | null; priceCents?: number | null; createdAt: string } | null;
  audit: Array<{ id: string; action: string; adminId: string; details?: Record<string, unknown>; createdAt: string }>;
  /** Décisions possibles maintenant, calculées par l'API (mêmes règles que le service de paiement) */
  decisions: Array<"rembourser" | "liberer" | "annuler">;
}

const AUTO_LABEL: Record<string, string> = { reception_presumee: "réception présumée", capture_echeance: "capture avant expiration de l'autorisation", annulation_echeance: "annulation à l'échéance" };

/**
 * Fiche détaillée d'une transaction (audit admin, étape 2) : parties, annonce, remise et adresse de
 * livraison, expédition, échéances du séquestre, journal lié, et les décisions admin — arbitrage d'un
 * litige ou décision forcée (fraude, conflit) : rembourser, libérer, annuler ; suspension du compte.
 */
export default function AdminTransactionPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tx, setTx] = useState<AdminTxDetail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<AdminTxDetail>(`/admin/transactions/${id}`).then((t) => { setTx(t); setError(null); }).catch((e) => setError((e as Error).message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (decision: "rembourser" | "liberer" | "annuler") => {
    if (note.trim().length < 5) return toast("Une note d'au moins 5 caractères est requise (transmise aux deux parties, conservée dans le journal).", "error");
    const labels = { rembourser: "Rembourser intégralement l'acheteur ?", liberer: "Libérer les fonds au vendeur ?", annuler: "Annuler la vente et rembourser l'acheteur ?" };
    if (!(await confirm({ title: labels[decision], text: "La décision et votre note seront transmises aux deux parties et inscrites au journal d'audit. Elle est définitive.", confirmLabel: decision === "liberer" ? "Libérer les fonds" : decision === "annuler" ? "Annuler la vente" : "Rembourser", danger: decision !== "liberer" }))) return;
    setBusy(true);
    try {
      await api(`/admin/transactions/${id}/resolve`, { method: "POST", body: { decision, note: note.trim() } });
      toast("Décision appliquée.", "success");
      setNote("");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (error && !tx) return <div><Link href="/admin/litiges" className="mono">← Transactions et litiges</Link><div className="a-alert danger" style={{ marginTop: 12 }}>{error} <button type="button" className="a-btn" onClick={load}>Réessayer</button></div></div>;
  if (!tx) return <div className="skeleton" style={{ height: 300 }} />;
  const s = statusPill(tx.status);
  const open = ["sequestre", "livree", "litige"].includes(tx.status);
  const can = (d: "rembourser" | "liberer" | "annuler") => tx.decisions.includes(d);
  const party = (p: Party | null, role: string) => (
    <dl className="a-kv">
      <dt>{role}</dt>
      <dd>
        {p ? (
          <>
            <Link href={`/admin/utilisateurs/${p.id}`} style={{ textDecoration: "underline" }}>{p.displayName}</Link> {p.suspended && <span className="a-pill danger">Suspendu</span>} {p.deleted && <span className="a-pill">Supprimé</span>}
            <br /><span className="mono">{p.phoneNumber}{p.email ? ` · ${p.email}` : ""}</span>
            <br /><span className="small">{p.accountType} · {p.ratingCount > 0 ? `${p.ratingAvg}/5 (${p.ratingCount} avis)` : "aucun avis"}</span>
          </>
        ) : <span className="a-pill">Compte supprimé</span>}
      </dd>
    </dl>
  );

  return (
    <div>
      <Link href="/admin/litiges" className="mono">← Transactions et litiges</Link>
      <div className="a-head" style={{ marginTop: 8 }}>
        <div>
          <h1>Transaction <span className={`a-pill ${s.cls}`}>{s.label}</span></h1>
          <p className="mono">{tx.id} · {formatEuros(tx.amount)} (frais acheteur {formatEuros(tx.buyerFee)}, commission {formatEuros(tx.commission)}) · créée {formatDateTime(tx.createdAt)}</p>
        </div>
      </div>
      {error && <div className="a-alert danger">{error} <button type="button" className="a-btn" onClick={load}>Réessayer</button></div>}
      {tx.provider && tx.provider.state !== "inconnue" && (
        <div className={`a-alert${tx.provider.state === "annulee" ? " danger" : ""}`} data-testid="provider-state">
          Paiement chez le prestataire : <strong>{PROVIDER_STATE[tx.provider.state]}</strong>{tx.provider.detail ? ` (${tx.provider.detail})` : ""}.
          {tx.provider.state === "annulee" && " L'argent n'a jamais été encaissé et ne peut plus l'être : seule l'annulation de la vente est possible (l'acheteur n'est pas débité)."}
        </div>
      )}
      {tx.disputeReason && <div className="a-alert danger">Litige ouvert par {tx.disputeOpenedBy === tx.buyerId ? "l'acheteur" : "le vendeur"} : « {tx.disputeReason} »</div>}
      {tx.paymentIssue && (
        <div className="a-alert danger" data-testid="payment-issue">
          <strong>Paiement à traiter par l'administration</strong> (signalé le {tx.paymentIssueAt ? formatDateTime(tx.paymentIssueAt) : "—"}, la tâche automatique ne réessaie plus) : {tx.paymentIssue}
          <div style={{ marginTop: 8 }}><button type="button" className="a-btn" disabled={busy} onClick={async () => { setBusy(true); try { setTx(await api<AdminTxDetail>(`/admin/transactions/${id}/retry-payment`, { method: "POST" })); toast("Signalement levé : la tâche automatique réessaiera.", "success"); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); } }}>Réessayer automatiquement</button></div>
        </div>
      )}
      {tx.resolutionNote && <div className="a-alert">Décision : {tx.resolutionNote}{tx.autoResolution && ` (automatique : ${AUTO_LABEL[tx.autoResolution] ?? tx.autoResolution})`}</div>}

      <div className="a-two">
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Parties et annonce</h2>
          {party(tx.buyer, "Acheteur")}
          {party(tx.seller, "Vendeur")}
          <dl className="a-kv">
            <dt>Annonce</dt><dd>{tx.listing ? <><Link href={`/admin/annonces/${tx.listing.id}`} style={{ textDecoration: "underline" }}>{tx.listing.title}</Link> <span className="mono">({tx.listing.status})</span></> : `${tx.listingTitle ?? "Annonce"} (supprimée, trace comptable conservée)`}</dd>
            <dt>Remise</dt><dd>{DELIVERY_LABELS[tx.deliveryMethod]}{tx.deliveryMethod === "main_propre" && (tx.hasHandoverCode ? " · code de remise détenu par l'acheteur (jamais affiché ici)" : "")}{tx.deliveryTrackingNumber && ` · suivi ${tx.deliveryTrackingNumber}`}</dd>
            {tx.shippingAddress && <><dt>Adresse de livraison</dt><dd>{tx.shippingAddress.name}, {tx.shippingAddress.line1}{tx.shippingAddress.line2 ? `, ${tx.shippingAddress.line2}` : ""}, {tx.shippingAddress.postalCode} {tx.shippingAddress.city}{tx.shippingAddress.phone ? ` · ${tx.shippingAddress.phone}` : ""}</dd></>}
            {tx.shipment && <><dt>Étiquette</dt><dd>{tx.shipment.carrier} · {tx.shipment.mode} · {tx.shipment.status}{tx.shipment.trackingNumber && ` · ${tx.shipment.trackingNumber}`}{tx.shipment.priceCents != null && ` · ${formatEuros(tx.shipment.priceCents / 100)}`}{tx.shipment.trackingUrl && <> · <a href={tx.shipment.trackingUrl} target="_blank" rel="noreferrer">suivi ↗</a></>}</dd></>}
          </dl>
          <h2 className="h3">Chronologie et échéances</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Modèle de séquestre : {tx.escrowModel === "destination" ? "ancien (capture à la confirmation, fonds versés directement au vendeur)" : "solde de la plateforme (encaissé par Trocoin, virement au vendeur à la confirmation)"}</li>
            {tx.paidAt && <li>Autorisation{tx.paymentMethod ? ` (${tx.paymentMethod === "card" ? "carte" : tx.paymentMethod === "paypal" ? "PayPal" : tx.paymentMethod})` : ""} : {formatDateTime(tx.paidAt)}</li>}
            {tx.escrowModel !== "destination" && (tx.capturedAt ? <li data-testid="admin-captured-at">Encaissé sur le solde de Trocoin : {formatDateTime(tx.capturedAt)}</li> : open && <li>Pas encore encaissé (capture sous 24 h, ou dès l&apos;expédition / la remise / un litige)</li>)}
            {tx.shippedAt && <li>Expédiée / prête : {formatDateTime(tx.shippedAt)}</li>}
            {tx.autoConfirmAt && tx.status === "livree" && <li>Réception présumée le {formatDateTime(tx.autoConfirmAt)}</li>}
            {tx.escrowModel !== "destination" && tx.shipBy && (tx.status === "sequestre" || (tx.status === "livree" && tx.deliveryMethod === "main_propre")) && <li data-testid="admin-ship-by">Expédition / remise attendue avant le {formatDateTime(tx.shipBy)} (sinon annulation et remboursement automatiques)</li>}
            {tx.escrowModel === "destination" && tx.captureBefore && open && <li>Date limite de capture de l&apos;autorisation : {formatDateTime(tx.captureBefore)} (action automatique la veille)</li>}
            {tx.confirmedAt && <li>Confirmée{tx.escrowModel === "destination" ? " / capturée" : ""} : {formatDateTime(tx.confirmedAt)}</li>}
            {tx.escrowModel !== "destination" && tx.status === "confirme" && (tx.transferredAt ? <li data-testid="admin-transferred-at">Virement au vendeur : {formatDateTime(tx.transferredAt)}</li> : <li className="a-pill danger" style={{ display: "inline-block" }}>Virement au vendeur en attente (compte de versement absent) — retenté automatiquement</li>)}
            {tx.disputeAllowedUntil && tx.status === "confirme" && <li>Litige encore possible pour l&apos;acheteur jusqu&apos;au {formatDateTime(tx.disputeAllowedUntil)}</li>}
            {tx.resolvedAt && <li>Résolue : {formatDateTime(tx.resolvedAt)}</li>}
          </ul>
        </section>

        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Décision</h2>
          {tx.decisions.length > 0 ? (
            <>
              <p className="small" style={{ margin: "0 0 8px", color: "var(--a-muted)" }}>
                {tx.status === "litige" ? "Arbitrage du litige." : "Décision forcée hors litige (fraude, conflit, vendeur ou acheteur injoignable) : réservée aux cas avérés, journalisée comme telle."}
              </p>
              <textarea className="a-textarea" aria-label="Note de décision (transmise aux deux parties)" placeholder="Note de décision (transmise aux deux parties, conservée dans le journal)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="decision-note" maxLength={1000} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {can("rembourser") && <button className="a-btn danger" disabled={busy} onClick={() => decide("rembourser")} data-testid="decide-refund">Rembourser l&apos;acheteur</button>}
                {can("annuler") && <button className="a-btn" disabled={busy} onClick={() => decide("annuler")} data-testid="decide-cancel">Annuler la vente</button>}
                {can("liberer") && <button className="a-btn ok" disabled={busy} onClick={() => decide("liberer")} data-testid="decide-release">Libérer au vendeur</button>}
              </div>
            </>
          ) : (
            <p className="small" style={{ margin: 0, color: "var(--a-muted)" }}>Aucune décision possible sur une transaction « {s.label} ».</p>
          )}
          <h2 className="h3">Comptes</h2>
          <p className="small" style={{ margin: 0 }}>
            Suspendre (réversible) ou supprimer définitivement un compte se fait depuis sa fiche :{" "}
            {tx.buyer && <Link href={`/admin/utilisateurs/${tx.buyer.id}`} style={{ textDecoration: "underline" }}>acheteur</Link>}
            {tx.buyer && tx.seller && " · "}
            {tx.seller && <Link href={`/admin/utilisateurs/${tx.seller.id}`} style={{ textDecoration: "underline" }}>vendeur</Link>}.
          </p>
          <h2 className="h3">Journal d&apos;audit lié</h2>
          {tx.audit.length === 0 ? (
            <p className="small mono" style={{ margin: 0 }}>Aucune action admin sur cette transaction.</p>
          ) : (
            <ul className="small mono" style={{ margin: 0, paddingLeft: 18 }} data-testid="tx-audit">
              {tx.audit.map((e) => <li key={e.id}>{formatDateTime(e.createdAt)} · {e.action} · admin {e.adminId.slice(0, 8)}{e.details && "note" in e.details ? ` · « ${String(e.details.note)} »` : ""}</li>)}
            </ul>
          )}
          <p className="small" style={{ margin: "8px 0 0" }}><Link href={`/admin/journal?target=${tx.id}`} style={{ textDecoration: "underline" }}>Voir dans le journal</Link></p>
        </section>
      </div>
    </div>
  );
}
