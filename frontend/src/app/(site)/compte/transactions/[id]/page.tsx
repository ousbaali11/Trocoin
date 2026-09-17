"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { deliveryLabel, formatDateTime, formatEuros, formatPercent, PICKUP_TYPE_LABELS, TX_STATUS_LABELS } from "@/lib/format";
import type { Review, Transaction } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { ShipmentPanel } from "@/components/transactions/ShipmentPanel";
import { ShipmentStatus } from "@/components/transactions/ShipmentStatus";

export default function TransactionPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tx, setTx] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState("");
  const [code, setCode] = useState("");
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [myReview, setMyReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  // Retour de la page de paiement (AUDIT §57) : « retour » après un paiement, « annule » après un abandon ou un refus.
  // Lu une fois dans l'adresse, puis retiré pour qu'un rechargement ne rejoue pas le bandeau.
  const [paymentReturn, setPaymentReturn] = useState<"retour" | "annule" | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("paiement");
    if (p === "retour" || p === "annule") {
      setPaymentReturn(p);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const t = await api<Transaction>(`/transactions/${id}`);
      setTx(t);
      const given = await api<Review[]>("/users/me/reviews-given");
      setMyReview(given.find((r) => r.transactionId === id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  // Paiement hébergé en cours : la page se met à jour seule dès que Stripe a autorisé le montant
  const pending = tx?.status === "en_attente";
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, "success");
      await load();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="alert alert-error">{error} <Link href="/compte/transactions">Retour</Link></div>;
  if (!tx) return <div className="skeleton" style={{ height: 320 }} />;
  const st = TX_STATUS_LABELS[tx.status];
  const buyer = tx.role === "acheteur";
  const q = tx.quote;
  // Résultat affiché à l'acheteur qui revient du paiement : réussi, en cours de vérification, ou non abouti
  const unpaidClosed = ["rembourse", "annulee"].includes(tx.status) && !tx.paidAt;
  const paymentResult: "succes" | "verification" | "echec" | null = !buyer || !paymentReturn ? null : tx.status === "en_attente" ? (paymentReturn === "retour" ? "verification" : "echec") : unpaidClosed ? "echec" : "succes";

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Link href="/compte/transactions" className="small">← Achats et ventes</Link>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="eyebrow">{buyer ? "Achat" : "Vente"} · {deliveryLabel(tx)}</p>
          <h1 style={{ fontSize: "1.6rem" }}>{tx.listing?.title ?? (tx.listingTitle ? `${tx.listingTitle} (annonce supprimée)` : "Annonce supprimée")}</h1>
          <span className={st.pill}>{st.label}</span> <span className="small muted">{st.help}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {tx.conversationId && <Link href={`/compte/messages/${tx.conversationId}`} className="btn btn-outline btn-sm" data-testid="open-conversation">Conversation et suivi</Link>}
          {tx.listing && <Link href={`/annonces/${tx.listing.id}`} className="btn btn-outline btn-sm">Voir l&apos;annonce</Link>}
        </div>
      </div>

      {paymentResult === "succes" && (
        <div className="alert alert-success" role="status" data-testid="payment-result" data-result="succes">
          <strong>Paiement réussi.</strong> {formatEuros(tx.amount + tx.buyerFee + (tx.shippingFee ?? 0))} payés : Trocoin conserve votre paiement et ne le verse au vendeur qu&apos;une fois la réception confirmée.
          <br />Et maintenant ? Le vendeur confirme que l&apos;article est disponible, puis {tx.deliveryMethod === "main_propre" ? "vous convenez du rendez-vous" : "expédie le colis"}. Chaque étape vous est annoncée dans la conversation.
          {tx.conversationId && (
            <div style={{ marginTop: 10 }}><Link className="btn btn-primary btn-sm" href={`/compte/messages/${tx.conversationId}`}>Ouvrir la conversation</Link></div>
          )}
        </div>
      )}
      {paymentResult === "verification" && (
        <div className="alert alert-info" role="status" data-testid="payment-result" data-result="verification">
          <strong>Paiement en cours de vérification…</strong> Votre banque confirme l&apos;opération ; cette page se met à jour toute seule, inutile de payer une seconde fois.
        </div>
      )}
      {paymentResult === "echec" && (
        <div className="alert alert-error" role="alert" data-testid="payment-result" data-result="echec">
          <strong>Paiement non abouti : rien n&apos;a été débité.</strong>
          {tx.status === "en_attente" ? (
            <>
              {" "}L&apos;article vous reste réservé quelques minutes. Si votre carte a été refusée : vérifiez son plafond et la validation demandée par votre banque (application ou SMS), ou essayez un autre moyen de paiement.
              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                {tx.checkoutUrl && <a className="btn btn-primary btn-sm" href={tx.checkoutUrl} data-testid="resume-payment">Reprendre le paiement</a>}
                <button className="btn btn-outline btn-sm" disabled={busy} data-testid="abandon-payment" onClick={() => run(() => api(`/transactions/${tx.id}/abandon`, { method: "POST" }), "Achat abandonné : rien n'a été débité.")}>Abandonner cet achat</button>
              </div>
            </>
          ) : (
            <>
              {" "}Cet achat est clos. L&apos;annonce reste disponible si vous souhaitez réessayer.
              {tx.listing && <div style={{ marginTop: 10 }}><Link className="btn btn-primary btn-sm" href={`/annonces/${tx.listing.id}`}>Retour à l&apos;annonce</Link></div>}
            </>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="tx-cols">
        <section className="panel">
          <h2 className="h3">Récapitulatif</h2>
          <table className="table">
            <tbody>
              <tr><td>Prix de l&apos;article</td><td style={{ textAlign: "right" }}>{formatEuros(tx.amount)}</td></tr>
              {buyer ? (
                <>
                  <tr><td>Frais de protection acheteur</td><td style={{ textAlign: "right" }}>{formatEuros(tx.buyerFee)}</td></tr>
                  {(tx.shippingFee ?? 0) > 0 && <tr data-testid="recap-shipping"><td>Frais de livraison</td><td style={{ textAlign: "right" }}>{formatEuros(tx.shippingFee)}</td></tr>}
                  <tr><td><strong>{tx.status === "en_attente" || unpaidClosed ? "Total à payer" : "Total payé"}</strong></td><td style={{ textAlign: "right" }}><strong>{formatEuros(tx.amount + tx.buyerFee + (tx.shippingFee ?? 0))}</strong></td></tr>
                </>
              ) : (
                <>
                  <tr><td>Commission Trocoin ({formatPercent(tx.rates?.commissionPercent ?? (tx.amount > 0 ? Math.round((tx.commission / tx.amount) * 1000) / 10 : 0))})</td><td style={{ textAlign: "right" }}>− {formatEuros(tx.commission)}</td></tr>
                  <tr><td><strong>Montant versé</strong></td><td style={{ textAlign: "right" }}><strong>{formatEuros(q?.sellerPayout ?? tx.amount - tx.commission)}</strong></td></tr>
                </>
              )}
            </tbody>
          </table>
          {!buyer && (tx.shippingFee ?? 0) > 0 && <p className="small muted" style={{ margin: "8px 0 0" }} data-testid="recap-shipping-seller">Livraison payée par l&apos;acheteur : {formatEuros(tx.shippingFee)} — elle règle le bon d&apos;envoi, vous n&apos;avancez rien.</p>}
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            {buyer ? "Vendeur" : "Acheteur"} : {tx.other?.displayName}
            {tx.other && !tx.other.deleted && <> · <Link href={`/vendeurs/${tx.other.id}`}>profil</Link></>}
          </p>
        </section>

        <section className="panel">
          <h2 className="h3">Chronologie</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>{tx.status === "en_attente" || unpaidClosed ? "Achat commencé, paiement non finalisé" : `Paiement sécurisé${tx.paymentMethod === "paypal" ? " via PayPal" : tx.paymentMethod === "card" ? " par carte" : ""}`} : {formatDateTime(tx.createdAt)}</li>
            {tx.sellerConfirmedAt && <li data-testid="seller-confirmed-at">Disponibilité confirmée par le vendeur : {formatDateTime(tx.sellerConfirmedAt)}</li>}
            {tx.shippedAt && <li>{tx.deliveryMethod === "main_propre" ? "Vendeur prêt pour la remise" : `Expédié${tx.deliveryTrackingNumber ? ` (suivi ${tx.deliveryTrackingNumber})` : ""}`} : {formatDateTime(tx.shippedAt)}</li>}
            {tx.confirmedAt && <li>Réception confirmée : {formatDateTime(tx.confirmedAt)}</li>}
            {tx.disputeReason && <li>Litige : « {tx.disputeReason} »</li>}
            {tx.resolutionNote && <li>Décision : {tx.resolutionNote}</li>}
            {tx.escrowModel !== "destination" && ["sequestre", "livree", "litige", "confirme"].includes(tx.status) && (
              tx.capturedAt
                ? <li data-testid="captured-at">Paiement encaissé par Trocoin le {formatDateTime(tx.capturedAt)}{tx.status !== "confirme" && " — conservé par Trocoin jusqu'à la confirmation de la réception, puis versé au vendeur"}</li>
                : <li data-testid="capture-pending">Paiement autorisé : Trocoin l&apos;encaisse sous 24 h et le conserve jusqu&apos;à la confirmation de la réception</li>
            )}
            {tx.escrowModel !== "destination" && tx.shipBy && (tx.status === "sequestre" || (tx.status === "livree" && tx.deliveryMethod === "main_propre")) && (
              <li data-testid="ship-by">{tx.deliveryMethod === "main_propre" ? "Remise à confirmer (code saisi par le vendeur)" : "Expédition à faire"} avant le {formatDateTime(tx.shipBy)} : passé cette date, la vente est annulée et l&apos;acheteur intégralement remboursé</li>
            )}
            {tx.status === "confirme" && tx.escrowModel !== "destination" && (
              tx.transferredAt
                ? <li data-testid="transferred-at">Fonds versés au vendeur le {formatDateTime(tx.transferredAt)}</li>
                : <li data-testid="transfer-pending">{buyer ? "Fonds en cours de versement au vendeur" : "Versement en attente : configurez votre compte de paiement dans Mes paiements pour recevoir les fonds"}</li>
            )}
            {tx.status === "livree" && tx.autoConfirmAt && tx.deliveryMethod !== "main_propre" && (
              <li data-testid="auto-confirm-at">Réception considérée acquise le {formatDateTime(tx.autoConfirmAt)} sans confirmation ni litige d&apos;ici là</li>
            )}
            {tx.escrowModel === "destination" && ["sequestre", "litige"].includes(tx.status) && tx.captureBefore && (
              <li data-testid="capture-before">Échéance de l&apos;autorisation bancaire : {formatDateTime(tx.captureBefore)} — {tx.status === "litige" ? "les fonds seront encaissés avant cette date et bloqués jusqu'à la décision du médiateur" : tx.deliveryMethod === "main_propre" ? "sans remise confirmée la veille, la vente est annulée et l'acheteur remboursé" : "sans expédition la veille, la vente est annulée et l'acheteur remboursé"}</li>
            )}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h2 className="h3">Que faire maintenant ?</h2>
        {tx.deliveryMethod !== "main_propre" && ["sequestre", "livree", "confirme", "litige"].includes(tx.status) && (buyer || tx.status !== "sequestre") && (
          <ShipmentStatus transactionId={tx.id} manualTracking={tx.deliveryTrackingNumber} />
        )}
        {tx.status === "en_attente" && (
          <div className="alert" data-testid="pending-payment" role="status">
            <strong>Paiement en attente.</strong>{" "}
            {buyer ? "Terminez le paiement sur la page sécurisée Stripe : cette page se mettra à jour automatiquement. Trocoin conserve le paiement et ne le verse au vendeur qu'une fois la réception confirmée." : "L'acheteur n'a pas encore finalisé son paiement."}
            {buyer && tx.checkoutUrl && (
              <div style={{ marginTop: 10 }}>
                <a className="btn btn-primary" href={tx.checkoutUrl}>Reprendre le paiement</a>
                {!paymentResult && <button className="btn btn-ghost" style={{ marginLeft: 8 }} disabled={busy} onClick={() => run(() => api(`/transactions/${tx.id}/abandon`, { method: "POST" }), "Achat abandonné : rien n'a été débité.")}>Abandonner cet achat</button>}
              </div>
            )}
          </div>
        )}
        {tx.status === "sequestre" && !buyer && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>Les fonds de l&apos;acheteur sont bloqués. {tx.deliveryMethod === "main_propre" ? "Convenez d'un rendez-vous par messagerie, puis confirmez que vous êtes prêt." : (tx.shippingQuote ? "Confirmez la disponibilité, générez le bon d'envoi, déposez le colis, puis confirmez l'expédition." : "Expédiez l'article et renseignez le numéro de suivi.")}</p>
            {tx.sellerConfirmedAt ? (
              <p className="small" style={{ margin: 0, color: "var(--accent-dark)" }} data-testid="availability-confirmed">✓ Vous avez confirmé la disponibilité de l&apos;article le {formatDateTime(tx.sellerConfirmedAt)}.</p>
            ) : (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-outline" disabled={busy} data-testid="confirm-availability" onClick={() => run(() => api(`/transactions/${tx.id}/confirm-availability`, { method: "POST" }), "Disponibilité confirmée : l'acheteur est prévenu.")}>Confirmer que l&apos;article est disponible</button>
                <span className="small muted">Rassure l&apos;acheteur en attendant {tx.deliveryMethod === "main_propre" ? "le rendez-vous" : "l'envoi"}.</span>
              </div>
            )}
            {tx.deliveryMethod !== "main_propre" && tx.deliveryMode && (
              <p className="small" style={{ margin: 0 }} data-testid="buyer-delivery-choice">
                Réception choisie par l&apos;acheteur : <strong>{tx.deliveryMode === "domicile" ? "à domicile" : tx.pickupPoint ? `${PICKUP_TYPE_LABELS[tx.pickupPoint.type].toLowerCase()} « ${tx.pickupPoint.name} », ${tx.pickupPoint.line1}, ${tx.pickupPoint.postalCode} ${tx.pickupPoint.city}` : "en point de retrait (à choisir près de son adresse)"}</strong>
              </p>
            )}
            {tx.deliveryMethod !== "main_propre" && <ShipmentPanel tx={tx} onChanged={load} />}
            {/* Livraison payée par l'acheteur (AUDIT §59) : le numéro vient du bon d'envoi ; la saisie à la main n'est qu'un secours */}
            {tx.deliveryMethod !== "main_propre" && (tx.shippingQuote && !tx.deliveryTrackingNumber ? (
              <details data-testid="manual-tracking">
                <summary className="small" style={{ cursor: "pointer" }}>Le bon d&apos;envoi ne peut pas être généré ? Saisir un numéro de suivi à la main</summary>
                <p className="small muted" style={{ margin: "6px 0" }}>À n&apos;utiliser qu&apos;en dernier recours : la livraison payée par l&apos;acheteur couvre le bon d&apos;envoi Trocoin, pas un envoi réglé par vos soins.</p>
              <div className="field" style={{ maxWidth: 360 }}>
                <label htmlFor="tracking">Numéro de suivi{tx.deliveryTrackingNumber ? " (rempli par le bon d'envoi)" : ""}</label>
                <input id="tracking" className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Ex. 6A12345678901" />
              </div>
              </details>
            ) : (
              <div className="field" style={{ maxWidth: 360 }}>
                <label htmlFor="tracking">Numéro de suivi{tx.deliveryTrackingNumber ? " (rempli par le bon d'envoi)" : ""}</label>
                <input id="tracking" className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Ex. 6A12345678901" />
              </div>
            ))}
            <div className="row">
              <button className="btn btn-primary" disabled={busy || (tx.deliveryMethod !== "main_propre" && (tracking.trim() || tx.deliveryTrackingNumber || "").length < 4)} onClick={() => run(() => api(`/transactions/${tx.id}/ship`, { method: "POST", body: { trackingNumber: tracking.trim() || undefined } }), tx.deliveryMethod === "main_propre" ? "Acheteur prévenu." : "Expédition enregistrée.")}>
                {tx.deliveryMethod === "main_propre" ? "Je suis prêt pour la remise" : "Confirmer l'expédition"}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={async () => (await confirm({ title: "Annuler la vente ?", text: "L'acheteur sera intégralement remboursé et l'annonce restera en ligne.", confirmLabel: "Annuler la vente", danger: true })) && run(() => api(`/transactions/${tx.id}/cancel`, { method: "POST" }), "Vente annulée, acheteur remboursé.")}>Article indisponible : annuler</button>
            </div>
          </div>
        )}
        {tx.status === "sequestre" && buyer && (
          <div className="stack">
            {tx.sellerConfirmedAt && <p className="small" style={{ margin: 0, color: "var(--accent-dark)" }} data-testid="availability-confirmed">✓ Le vendeur a confirmé que l&apos;article est disponible.</p>}
            <p className="small muted" style={{ margin: 0 }}>Le vendeur doit maintenant {tx.deliveryMethod === "main_propre" ? "organiser la remise avec vous" : "expédier l'article"}. Vous pouvez annuler tant qu&apos;il n&apos;a pas expédié.</p>
            <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={async () => (await confirm({ title: "Annuler mon achat ?", text: "Vous serez intégralement remboursé, frais compris.", confirmLabel: "Annuler l'achat", danger: true })) && run(() => api(`/transactions/${tx.id}/cancel`, { method: "POST" }), "Achat annulé, remboursement en cours.")}>Annuler mon achat</button>
          </div>
        )}
        {tx.status === "livree" && buyer && tx.autoConfirmAt && tx.deliveryMethod !== "main_propre" && (
          <div className="alert alert-info" role="status" data-testid="confirm-deadline" style={{ margin: "12px 0 0" }}>
            <strong>Confirmez la réception ou signalez un problème avant le {formatDateTime(tx.autoConfirmAt)}.</strong> Passé cette date, la réception sera considérée acquise et le vendeur payé ; vous garderez 7 jours pour ouvrir un litige.
          </div>
        )}
        {tx.status === "confirme" && buyer && tx.autoResolution && tx.disputeAllowedUntil && new Date(tx.disputeAllowedUntil).getTime() > Date.now() && (
          <p className="small muted" style={{ margin: "0 0 8px" }} data-testid="post-capture-dispute">
            {tx.autoResolution === "reception_presumee" ? "Réception considérée acquise sans action de votre part." : "Paiement encaissé avant l'expiration de l'autorisation bancaire."} Un problème avec cet achat ? <button className="btn btn-ghost btn-sm" onClick={() => setDisputeOpen(true)}>Ouvrir un litige</button> (possible jusqu&apos;au {formatDateTime(tx.disputeAllowedUntil)}).
          </p>
        )}
        {["sequestre", "livree"].includes(tx.status) && buyer && (
          <div className="stack" style={{ marginTop: 12 }}>
            {tx.deliveryMethod === "main_propre" && tx.handoverCode && (
              <div className="alert alert-info" style={{ margin: 0 }}>
                Votre code de remise : <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", letterSpacing: ".2em" }}>{tx.handoverCode}</strong>
                <br /><span className="small">Donnez-le au vendeur uniquement une fois l&apos;objet en main : il libère le paiement.</span>
              </div>
            )}
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={async () => (await confirm({ title: "Confirmer la réception ?", text: "Le paiement sera versé au vendeur. Vérifiez l'article avant de confirmer : cette action est définitive.", confirmLabel: "J'ai bien reçu l'article" })) && run(() => api(`/transactions/${tx.id}/confirm-delivery`, { method: "POST" }), "Réception confirmée, merci !")}>J&apos;ai bien reçu l&apos;article</button>
              <button className="btn btn-outline" disabled={busy} onClick={() => setDisputeOpen(true)} style={{ color: "var(--brick)" }}>Un problème ? Ouvrir un litige</button>
            </div>
          </div>
        )}
        {["sequestre", "livree"].includes(tx.status) && !buyer && tx.deliveryMethod === "main_propre" && (
          <div className="stack" style={{ marginTop: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>Au rendez-vous, saisissez le code à 6 chiffres que l&apos;acheteur vous communique pour libérer le paiement.</p>
            <div className="row">
              <input className="input" style={{ maxWidth: 180, letterSpacing: ".3em", textAlign: "center" }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" aria-label="Code de remise" />
              <button className="btn btn-primary" disabled={busy || code.length !== 6} onClick={() => run(() => api(`/transactions/${tx.id}/handover`, { method: "POST", body: { code } }), "Remise validée : le paiement vous est versé.")}>Valider la remise</button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setDisputeOpen(true)}>Ouvrir un litige</button>
            </div>
          </div>
        )}
        {tx.status === "livree" && !buyer && tx.deliveryMethod !== "main_propre" && (
          <p className="small muted" style={{ margin: 0 }}>En attente de la confirmation de réception par l&apos;acheteur. <button className="btn btn-ghost btn-sm" onClick={() => setDisputeOpen(true)}>Ouvrir un litige</button></p>
        )}
        {tx.status === "confirme" && (
          <div className="stack">
            <p style={{ margin: 0 }}>Transaction terminée. {myReview ? <>Vous avez laissé un avis ({myReview.rating}/5).</> : <>Partagez votre expérience : votre avis aide la communauté.</>}</p>
            {!myReview && <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => setReviewOpen(true)}>Laisser un avis</button>}
          </div>
        )}
        {tx.status === "litige" && <p className="muted" style={{ margin: 0 }}>Un médiateur Trocoin examine le dossier. Vous serez notifié de la décision. Continuez à échanger avec l&apos;autre partie par messagerie pour trouver un accord.</p>}
        {["rembourse", "annulee"].includes(tx.status) && (
          <p className="muted" style={{ margin: 0 }} data-testid="closed-help">
            {!tx.paidAt
              ? (buyer ? "Paiement non finalisé : rien n'a été débité. L'annonce reste disponible si vous souhaitez racheter." : "Le paiement n'a pas été finalisé par l'acheteur : rien n'a été encaissé, votre annonce reste en ligne.")
              : tx.capturedAt || tx.confirmedAt
                ? (buyer ? "Vous avez été remboursé intégralement (délai bancaire de quelques jours)." : "L'acheteur a été remboursé. Votre annonce est restée marquée « Vendue » : remettez-la en ligne si l'article est toujours à vendre.")
                : (buyer ? "L'autorisation bancaire a été libérée : rien n'a été débité." : "L'autorisation de paiement de l'acheteur a été libérée : rien n'a été débité. Votre annonce est restée marquée « Vendue » : remettez-la en ligne si l'article est toujours à vendre.")}
          </p>
        )}
        {!buyer && ["rembourse", "annulee"].includes(tx.status) && !!tx.paidAt && tx.listing?.status === "vendue" && (
          <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} data-testid="relist" onClick={() => run(() => api(`/listings/${tx.listingId}`, { method: "PATCH", body: { status: "en_ligne" } }), "Annonce remise en ligne.")}>Remettre l&apos;annonce en ligne</button>
        )}
        {tx.status === "confirme" && !tx.listing && <p className="small muted" style={{ margin: "10px 0 0" }} data-testid="listing-removed">L&apos;annonce a été supprimée automatiquement : la vente est terminée.</p>}
      </section>

      <Modal open={disputeOpen} onClose={() => setDisputeOpen(false)} title="Ouvrir un litige">
        <p className="small muted">Décrivez précisément le problème (objet non conforme, non reçu, endommagé…). Les fonds restent bloqués jusqu&apos;à la décision du médiateur.</p>
        <div className="field">
          <label htmlFor="d-reason">Explication (10 caractères minimum)</label>
          <textarea id="d-reason" className="textarea" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} maxLength={2000} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => setDisputeOpen(false)}>Annuler</button>
          <button className="btn btn-danger" disabled={busy || disputeReason.trim().length < 10} onClick={async () => { if (await run(() => api(`/transactions/${tx.id}/dispute`, { method: "POST", body: { reason: disputeReason.trim() } }), "Litige ouvert.")) setDisputeOpen(false); }}>Ouvrir le litige</button>
        </div>
      </Modal>

      <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title={`Votre avis sur ${tx.other?.displayName ?? "ce membre"}`}>
        <div className="field">
          <span className="label">Note</span>
          <div className="row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`btn btn-sm ${rating === n ? "btn-dark" : "btn-outline"}`} onClick={() => setRating(n)} aria-label={`${n} sur 5`}>{n} ★</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="rv-comment">Commentaire (facultatif)</label>
          <textarea id="rv-comment" className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 90 }} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => setReviewOpen(false)}>Annuler</button>
          <button className="btn btn-primary" disabled={busy} onClick={async () => { if (await run(() => api(`/transactions/${tx.id}/review`, { method: "POST", body: { rating, comment: comment.trim() || undefined } }), "Merci pour votre avis !")) setReviewOpen(false); }}>Publier l&apos;avis</button>
        </div>
      </Modal>
      <style>{`@media (max-width: 720px){ .tx-cols{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
