"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { DELIVERY_LABELS, formatDateTime, formatEuros, TX_STATUS_LABELS } from "@/lib/format";
import type { Review, Transaction } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";

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

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Link href="/compte/transactions" className="small">← Achats et ventes</Link>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="eyebrow">{buyer ? "Achat" : "Vente"} · {DELIVERY_LABELS[tx.deliveryMethod]}</p>
          <h1 style={{ fontSize: "1.6rem" }}>{tx.listing?.title ?? "Annonce supprimée"}</h1>
          <span className={st.pill}>{st.label}</span> <span className="small muted">{st.help}</span>
        </div>
        {tx.listing && <Link href={`/annonces/${tx.listing.id}`} className="btn btn-outline btn-sm">Voir l&apos;annonce</Link>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="tx-cols">
        <section className="panel">
          <h3>Récapitulatif</h3>
          <table className="table">
            <tbody>
              <tr><td>Prix de l&apos;article</td><td style={{ textAlign: "right" }}>{formatEuros(tx.amount)}</td></tr>
              {buyer ? (
                <>
                  <tr><td>Frais de protection acheteur</td><td style={{ textAlign: "right" }}>{formatEuros(tx.buyerFee)}</td></tr>
                  <tr><td><strong>Total payé</strong></td><td style={{ textAlign: "right" }}><strong>{formatEuros(tx.amount + tx.buyerFee)}</strong></td></tr>
                </>
              ) : (
                <>
                  <tr><td>Commission Trocoin (8 %)</td><td style={{ textAlign: "right" }}>− {formatEuros(tx.commission)}</td></tr>
                  <tr><td><strong>Montant versé</strong></td><td style={{ textAlign: "right" }}><strong>{formatEuros(q?.sellerPayout ?? tx.amount - tx.commission)}</strong></td></tr>
                </>
              )}
            </tbody>
          </table>
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            {buyer ? "Vendeur" : "Acheteur"} : {tx.other?.displayName}
            {tx.other && !tx.other.deleted && <> · <Link href={`/vendeurs/${tx.other.id}`}>profil</Link></>}
          </p>
        </section>

        <section className="panel">
          <h3>Chronologie</h3>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Paiement sécurisé : {formatDateTime(tx.createdAt)}</li>
            {tx.shippedAt && <li>{tx.deliveryMethod === "main_propre" ? "Vendeur prêt pour la remise" : `Expédié${tx.deliveryTrackingNumber ? ` (suivi ${tx.deliveryTrackingNumber})` : ""}`} : {formatDateTime(tx.shippedAt)}</li>}
            {tx.confirmedAt && <li>Réception confirmée : {formatDateTime(tx.confirmedAt)}</li>}
            {tx.disputeReason && <li>Litige : « {tx.disputeReason} »</li>}
            {tx.resolutionNote && <li>Décision : {tx.resolutionNote}</li>}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h3>Que faire maintenant ?</h3>
        {tx.status === "sequestre" && !buyer && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>Les fonds de l&apos;acheteur sont bloqués. {tx.deliveryMethod === "main_propre" ? "Convenez d'un rendez-vous par messagerie, puis confirmez que vous êtes prêt." : "Expédiez l'article et renseignez le numéro de suivi."}</p>
            {tx.deliveryMethod !== "main_propre" && (
              <div className="field" style={{ maxWidth: 360 }}>
                <label htmlFor="tracking">Numéro de suivi</label>
                <input id="tracking" className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Ex. 6A12345678901" />
              </div>
            )}
            <div className="row">
              <button className="btn btn-primary" disabled={busy || (tx.deliveryMethod !== "main_propre" && tracking.trim().length < 4)} onClick={() => run(() => api(`/transactions/${tx.id}/ship`, { method: "POST", body: { trackingNumber: tracking.trim() || undefined } }), tx.deliveryMethod === "main_propre" ? "Acheteur prévenu." : "Expédition enregistrée.")}>
                {tx.deliveryMethod === "main_propre" ? "Je suis prêt pour la remise" : "Confirmer l'expédition"}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={async () => (await confirm({ title: "Annuler la vente ?", text: "L'acheteur sera intégralement remboursé et l'annonce restera en ligne.", confirmLabel: "Annuler la vente", danger: true })) && run(() => api(`/transactions/${tx.id}/cancel`, { method: "POST" }), "Vente annulée, acheteur remboursé.")}>Article indisponible : annuler</button>
            </div>
          </div>
        )}
        {tx.status === "sequestre" && buyer && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>Le vendeur doit maintenant {tx.deliveryMethod === "main_propre" ? "organiser la remise avec vous" : "expédier l'article"}. Vous pouvez annuler tant qu&apos;il n&apos;a pas expédié.</p>
            <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={async () => (await confirm({ title: "Annuler mon achat ?", text: "Vous serez intégralement remboursé, frais compris.", confirmLabel: "Annuler l'achat", danger: true })) && run(() => api(`/transactions/${tx.id}/cancel`, { method: "POST" }), "Achat annulé, remboursement en cours.")}>Annuler mon achat</button>
          </div>
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
        {["rembourse", "annulee"].includes(tx.status) && <p className="muted" style={{ margin: 0 }}>{buyer ? "Vous avez été remboursé intégralement." : "L'acheteur a été remboursé."}</p>}
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
