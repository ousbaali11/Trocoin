"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { formatBuyerFeeFormula, formatEuros, formatPercent, formatPhone } from "@/lib/format";
import type { ListingDetail, Quote } from "@/lib/types";
import { FavoriteButton } from "@/components/ui/FavoriteButton";
import { Modal } from "@/components/ui/Modal";
import { ShareMenu } from "@/components/ui/ShareMenu";
import { ReportListingButton } from "./ReportListingButton";

export function ListingActions({ listing }: { listing: ListingDetail }) {
  const { user, requireAuth } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [message, setMessage] = useState("Bonjour, est-ce toujours disponible ?");
  const [buyOpen, setBuyOpen] = useState(false);
  const [delivery, setDelivery] = useState<"main_propre" | "colissimo" | "mondial_relay">("main_propre");
  // Adresse de livraison pour un envoi : vue du vendeur seul, transmise au transporteur, jamais publique
  const [address, setAddress] = useState({ name: "", line1: "", line2: "", postalCode: "", city: "", phone: "" });
  const setAddr = (k: keyof typeof address, v: string) => setAddress((a) => ({ ...a, [k]: v }));
  const addressOk = delivery === "main_propre" || (address.name.trim().length >= 2 && address.line1.trim().length >= 3 && /^\d{5}$/.test(address.postalCode) && address.city.trim().length >= 1);
  const [busy, setBusy] = useState(false);
  // Numéro du vendeur : jamais dans la page, délivré au clic à un membre connecté (et compté pour le vendeur)
  const [phone, setPhone] = useState<string | null>(null);
  const isOwner = user?.id === listing.userId;

  const revealPhone = async () => {
    if (!requireAuth(`/annonces/${listing.id}`)) return;
    setBusy(true);
    try {
      const res = await api<{ phoneNumber: string }>(`/listings/${listing.id}/phone`, { method: "POST" });
      setPhone(res.phoneNumber);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const active = listing.status === "en_ligne";

  useEffect(() => {
    if (!active) return;
    api<Quote>(`/transactions/quote?listingId=${listing.id}`).then(setQuote).catch(() => setQuote(null));
  }, [listing.id, active]);
  useEffect(() => {
    // Retour de la page de paiement Stripe par « Retour » : rien n'a été débité
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("paiement") === "annule") {
      toast("Paiement annulé : rien n'a été débité, l'annonce reste disponible.", "info");
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contact = async () => {
    if (!requireAuth(`/annonces/${listing.id}`)) return;
    setBusy(true);
    try {
      const conv = await api<{ id: string }>("/conversations", { method: "POST", body: { listingId: listing.id, message: message.trim() || undefined } });
      router.push(`/compte/messages/${conv.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const buy = async () => {
    if (!requireAuth(`/annonces/${listing.id}`)) return;
    setBusy(true);
    try {
      const res = await api<{ transaction: { id: string }; checkoutUrl?: string }>("/transactions", { method: "POST", body: { listingId: listing.id, deliveryMethod: delivery, expectedTotal: quote?.buyerTotal, ...(delivery !== "main_propre" ? { shippingAddress: { name: address.name.trim(), line1: address.line1.trim(), line2: address.line2.trim() || undefined, postalCode: address.postalCode, city: address.city.trim(), phone: address.phone.trim() || undefined } } : {}) } });
      if (res.checkoutUrl) {
        // Paiement hébergé : la carte est saisie sur la page sécurisée Stripe, puis retour sur la transaction
        window.location.assign(res.checkoutUrl);
        return;
      }
      toast("Paiement sécurisé enregistré : les fonds sont bloqués jusqu'à votre confirmation.", "success");
      router.push(`/compte/transactions/${res.transaction.id}`);
    } catch (e) {
      // Barème ou prix modifié depuis l'affichage : rien n'a été débité, on montre le nouveau total avant tout paiement
      const err = e as ApiError;
      const fresh = err.status === 409 && (err.details as { code?: string; quote?: Partial<Quote> } | undefined)?.code === "QUOTE_CHANGED" ? (err.details as { quote?: Partial<Quote> }).quote : undefined;
      if (fresh) setQuote((q) => (q ? { ...q, ...fresh } : q));
      toast(err.message, fresh ? "info" : "error");
    } finally {
      setBusy(false);
    }
  };

  if (isOwner) {
    return (
      <div className="card stack">
        <strong>C&apos;est votre annonce</strong>
        <Link href={`/compte/annonces/${listing.id}/modifier`} className="btn btn-primary btn-block">Modifier l&apos;annonce</Link>
        <Link href="/compte/annonces" className="btn btn-outline btn-block">Gérer mes annonces</Link>
        <ShareMenu title={listing.title} text="Regarde cette annonce sur Trocoin" compact />
      </div>
    );
  }

  return (
    <div className="card stack">
      {active ? (
        <>
          <button className="btn btn-primary btn-lg btn-block" onClick={() => (user ? setContactOpen(true) : requireAuth(`/annonces/${listing.id}`))}>
            Contacter le vendeur
          </button>
          {quote?.eligible && (
            <>
              <button className="btn btn-dark btn-block" onClick={() => (user ? setBuyOpen(true) : requireAuth(`/annonces/${listing.id}`))} title="Paiement sécurisé : fonds bloqués jusqu'à la réception">
                Acheter · {formatEuros(quote.buyerTotal)}
              </button>
              <p className="small muted" style={{ margin: "-4px 0 0", textAlign: "center" }} data-testid="buy-breakdown">Paiement sécurisé : {formatEuros(quote.price)} + {formatEuros(quote.buyerFee)} de frais de protection</p>
            </>
          )}
          {quote && !quote.eligible && quote.reason && <p className="small muted" style={{ margin: 0 }}>{quote.reason}</p>}
          {listing.phoneAvailable && (
            phone ? (
              <a href={`tel:${phone}`} className="btn btn-outline btn-block" data-testid="phone-number" aria-label={`Appeler le ${formatPhone(phone)}`}>
                <PhoneIcon /> {formatPhone(phone)}
              </a>
            ) : (
              <button className="btn btn-outline btn-block" onClick={revealPhone} disabled={busy} data-testid="phone-reveal" title="Le numéro n'est communiqué qu'aux membres connectés">
                <PhoneIcon /> Voir le numéro
              </button>
            )
          )}
        </>
      ) : (
        <p className="muted" style={{ margin: 0 }}>Cette annonce n&apos;est plus disponible.</p>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <FavoriteButton listingId={listing.id} />
        <ShareMenu title={listing.title} text="Regarde cette annonce sur Trocoin" compact />
        <ReportListingButton listingId={listing.id} />
      </div>

      <Modal open={contactOpen} onClose={() => setContactOpen(false)} title="Écrire au vendeur">
        <div className="field">
          <label htmlFor="msg">Votre message</label>
          <textarea id="msg" className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} style={{ minHeight: 100 }} />
          <div className="row">
            {["Quel est votre dernier prix ?", "Où se situe le retrait ?", "Acceptez-vous un envoi ?"].map((q) => (
              <button key={q} type="button" className="pill" style={{ cursor: "pointer", border: 0 }} onClick={() => setMessage(q)}>{q}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => setContactOpen(false)}>Annuler</button>
          <button className="btn btn-primary" onClick={contact} disabled={busy}>Envoyer</button>
        </div>
      </Modal>

      <Modal open={buyOpen} onClose={() => setBuyOpen(false)} title="Paiement sécurisé">
        {quote && (
          <>
            <p className="small muted">Votre paiement est bloqué par Trocoin jusqu&apos;à ce que vous confirmiez la réception. En cas de problème, vous êtes remboursé.</p>
            <div className="field">
              <span className="label">Mode de remise</span>
              <label className="checkbox"><input type="radio" name="delivery" checked={delivery === "main_propre"} onChange={() => setDelivery("main_propre")} /> Remise en main propre (code de validation au rendez-vous)</label>
              {listing.deliveryAvailable && (
                <>
                  <label className="checkbox"><input type="radio" name="delivery" checked={delivery === "colissimo"} onChange={() => setDelivery("colissimo")} /> Colissimo à domicile</label>
                  <label className="checkbox"><input type="radio" name="delivery" checked={delivery === "mondial_relay"} onChange={() => setDelivery("mondial_relay")} /> Mondial Relay en point relais</label>
                </>
              )}
            </div>
            {delivery !== "main_propre" && (
              <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 12px" }} data-testid="delivery-address">
                <legend className="label">Adresse de livraison</legend>
                <p className="small muted" style={{ margin: "0 0 8px" }}>Vue par le vendeur seul pour préparer l&apos;envoi et l&apos;étiquette ; jamais affichée publiquement.</p>
                <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}><label htmlFor="addr-name">Nom et prénom</label><input id="addr-name" className="input" autoComplete="name" value={address.name} onChange={(e) => setAddr("name", e.target.value)} /></div>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}><label htmlFor="addr-line1">Adresse</label><input id="addr-line1" className="input" autoComplete="address-line1" placeholder="N° et rue" value={address.line1} onChange={(e) => setAddr("line1", e.target.value)} /></div>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}><label htmlFor="addr-line2">Complément (facultatif)</label><input id="addr-line2" className="input" autoComplete="address-line2" placeholder="Bâtiment, étage, digicode" value={address.line2} onChange={(e) => setAddr("line2", e.target.value)} /></div>
                  <div className="field" style={{ marginBottom: 0 }}><label htmlFor="addr-cp">Code postal</label><input id="addr-cp" className="input" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={address.postalCode} onChange={(e) => setAddr("postalCode", e.target.value.replace(/\D/g, ""))} /></div>
                  <div className="field" style={{ marginBottom: 0 }}><label htmlFor="addr-city">Ville</label><input id="addr-city" className="input" autoComplete="address-level2" value={address.city} onChange={(e) => setAddr("city", e.target.value)} /></div>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}><label htmlFor="addr-phone">Téléphone (facultatif, pour le livreur)</label><input id="addr-phone" className="input" type="tel" autoComplete="tel" value={address.phone} onChange={(e) => setAddr("phone", e.target.value)} /></div>
                </div>
              </fieldset>
            )}
            <table className="table" style={{ marginBottom: 16 }}>
              <tbody>
                <tr data-testid="quote-price"><td>Prix de l&apos;article</td><td style={{ textAlign: "right" }}>{formatEuros(quote.price)}</td></tr>
                <tr data-testid="quote-fee"><td>Frais de protection acheteur{quote.rates && <span className="small muted" style={{ display: "block" }}>{formatBuyerFeeFormula(quote.rates)} : paiement conservé par Trocoin jusqu&apos;à la réception</span>}</td><td style={{ textAlign: "right", verticalAlign: "top" }}>{formatEuros(quote.buyerFee)}</td></tr>
                <tr data-testid="quote-total"><td><strong>Total à payer</strong></td><td style={{ textAlign: "right" }}><strong>{formatEuros(quote.buyerTotal)}</strong></td></tr>
              </tbody>
            </table>
            <p className="small muted">Frais de port à convenir avec le vendeur pour un envoi. Le vendeur perçoit {formatEuros(quote.sellerPayout)} (commission Trocoin{quote.rates ? ` de ${formatPercent(quote.rates.commissionPercent)}` : ""} : {formatEuros(quote.commission)}).</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => setBuyOpen(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={buy} disabled={busy || !addressOk}>{busy ? "Paiement…" : `Payer ${formatEuros(quote.buyerTotal)}`}</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </svg>
  );
}
