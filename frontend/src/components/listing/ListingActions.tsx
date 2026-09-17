"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { formatEuros, formatPhone, formatPrice } from "@/lib/format";
import type { ListingDetail, Quote } from "@/lib/types";
import { FavoriteButton } from "@/components/ui/FavoriteButton";
import { Modal } from "@/components/ui/Modal";
import { ShareMenu } from "@/components/ui/ShareMenu";
import { DeliveryChooser, type DeliveryChoice } from "./DeliveryChooser";
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
  // Téléphone pour le livreur (AUDIT §55) : prérempli avec celui du compte, le transporteur l'exige pour l'étiquette
  useEffect(() => {
    if (user?.phoneNumber) setAddress((a) => (a.phone ? a : { ...a, phone: formatPhone(user.phoneNumber!) }));
  }, [user?.phoneNumber]);
  const setAddr = (k: keyof typeof address, v: string) => setAddress((a) => ({ ...a, [k]: v }));
  // Lieu de réception (AUDIT §57) : domicile, point relais, bureau de poste ou consigne — selon ce que le transporteur propose pour l'adresse
  const [choice, setChoice] = useState<DeliveryChoice>({ receiveAt: null, point: null, complete: false, shippingCents: null, pointsUnavailable: false });
  // Frais de livraison (AUDIT §59) : tarif réel de l'option choisie, ajouté au total que l'acheteur paie
  const [optionsNonce, setOptionsNonce] = useState(0);
  const addressOk = delivery === "main_propre" || (choice.complete && address.name.trim().length >= 2 && address.line1.trim().length >= 3 && /^\d{5}$/.test(address.postalCode) && address.city.trim().length >= 1);
  const [busy, setBusy] = useState(false);
  const shippingEuros = delivery !== "main_propre" && choice.shippingCents !== null ? choice.shippingCents / 100 : 0;
  const payTotal = Math.round(((quote?.buyerTotal ?? 0) + shippingEuros) * 100) / 100;
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
  // Barre d'action du téléphone (AUDIT §60) : sur petit écran, « Contacter » et « Acheter » se trouvaient à quatre écrans
  // de défilement, sous la description et la carte. Une barre fixe les garde sous le pouce ; elle s'efface dès que le
  // vrai bloc d'actions est à l'écran (pas de doublon) et pendant les fenêtres de contact et de paiement.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardInView, setCardInView] = useState(true);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCardInView(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [isOwner]);

  // Devis relu quand le membre est connu : s'il a une proposition de prix acceptée par le vendeur, le devis est au prix négocié
  useEffect(() => {
    if (!active) return;
    api<Quote>(`/transactions/quote?listingId=${listing.id}`).then(setQuote).catch(() => setQuote(null));
  }, [listing.id, active, user?.id]);
  // Arrivée depuis la conversation (« Payer 15,00 € ») : la fenêtre de paiement s'ouvre directement
  useEffect(() => {
    if (!user || !quote?.eligible || isOwner || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("acheter") !== "1") return;
    setBuyOpen(true);
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, quote?.eligible]);
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
      const res = await api<{ transaction: { id: string }; checkoutUrl?: string }>("/transactions", { method: "POST", body: { listingId: listing.id, deliveryMethod: delivery, expectedTotal: payTotal, ...(delivery !== "main_propre" ? { deliveryMode: choice.receiveAt === "domicile" ? "domicile" : "point_relais", ...(choice.point ? { pickupPoint: { id: choice.point.id, name: choice.point.name, line1: choice.point.line1, postalCode: choice.point.postalCode, city: choice.point.city, type: choice.point.type } } : {}), shippingAddress: { name: address.name.trim(), line1: address.line1.trim(), line2: address.line2.trim() || undefined, postalCode: address.postalCode, city: address.city.trim(), phone: address.phone.trim() || undefined } } : {}) } });
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
      // Le nouveau devis du serveur compte la livraison dans son total : ici le total hors livraison, la livraison est relue à part
      if (fresh) {
        const freshShipping = (fresh as { shippingFee?: number }).shippingFee ?? 0;
        setQuote((q) => (q ? { ...q, ...fresh, buyerTotal: Math.round(((fresh.buyerTotal ?? q.buyerTotal ?? 0) - freshShipping) * 100) / 100 } : q));
        setOptionsNonce((n) => n + 1);
      }
      toast(err.message, fresh ? "info" : "error");
    } finally {
      setBusy(false);
    }
  };

  if (isOwner) {
    return (
      <div className="card stack">
        <strong>C&apos;est votre annonce</strong>
        {listing.status === "vendue" && <span className="pill pill-dark" style={{ alignSelf: "flex-start" }}>Vendu</span>}
        <Link href={`/compte/annonces/${listing.id}/modifier`} className="btn btn-primary btn-block">Modifier l&apos;annonce</Link>
        <Link href="/compte/annonces" className="btn btn-outline btn-block">Gérer mes annonces</Link>
        <ShareMenu title={listing.title} text="Regarde cette annonce sur Trocoin" compact />
      </div>
    );
  }

  return (
    <div className="card stack" ref={cardRef}>
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
              {quote.offer && <p className="small" style={{ margin: "-4px 0 0", textAlign: "center", color: "var(--accent-dark)", fontWeight: 600 }} data-testid="negotiated-price">Prix négocié avec le vendeur : {formatEuros(quote.offer.amount)} au lieu de {formatEuros(quote.listPrice)}</p>}
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
        <p className="muted" style={{ margin: 0 }} data-testid="listing-unavailable">{listing.status === "vendue" ? "Article vendu : il n'est plus disponible à l'achat." : "Cette annonce n'est plus disponible."}</p>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <FavoriteButton listingId={listing.id} />
        <ShareMenu title={listing.title} text="Regarde cette annonce sur Trocoin" compact />
        <ReportListingButton listingId={listing.id} />
      </div>

      {active && (
        <div className="listing-bar" data-testid="listing-bar" data-hidden={cardInView || contactOpen || buyOpen ? "true" : "false"}>
          <div className="listing-bar-price">
            <strong>{quote?.offer ? formatEuros(quote.offer.amount) : formatPrice(listing.price, listing.priceType)}</strong>
            {quote?.offer && <span>prix négocié</span>}
          </div>
          <button type="button" className="btn btn-outline" onClick={() => (user ? setContactOpen(true) : requireAuth(`/annonces/${listing.id}`))}>Message</button>
          {quote?.eligible && <button type="button" className="btn btn-primary" onClick={() => (user ? setBuyOpen(true) : requireAuth(`/annonces/${listing.id}`))}>Acheter</button>}
        </div>
      )}

      <Modal open={contactOpen} onClose={() => setContactOpen(false)} title="Écrire au vendeur">
        <div className="field">
          <label htmlFor="msg">Votre message</label>
          <textarea id="msg" className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} style={{ minHeight: 100 }} />
          <div className="row">
            {["Quel est votre dernier prix ?", "Où se situe le retrait ?", "Acceptez-vous un envoi ?"].map((q) => (
              <button key={q} type="button" className="pill pill-phrase" onClick={() => setMessage(q)}>{q}</button>
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
                  <label className="checkbox"><input type="radio" name="delivery" checked={delivery === "colissimo"} onChange={() => setDelivery("colissimo")} /> Envoi par Colissimo</label>
                  <label className="checkbox"><input type="radio" name="delivery" checked={delivery === "mondial_relay"} onChange={() => setDelivery("mondial_relay")} /> Envoi par Mondial Relay</label>
                </>
              )}
            </div>
            {delivery !== "main_propre" && (
              <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 12px" }} data-testid="delivery-address">
                <legend className="label">Votre adresse</legend>
                <p className="small muted" style={{ margin: "0 0 8px" }}>Vue par le vendeur seul pour préparer l&apos;envoi et l&apos;étiquette ; jamais affichée publiquement. Elle sert aussi à trouver les points de retrait proches de chez vous.</p>
                <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}><label htmlFor="addr-name">Nom et prénom</label><input id="addr-name" className="input" autoComplete="name" value={address.name} onChange={(e) => setAddr("name", e.target.value)} /></div>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}><label htmlFor="addr-line1">Adresse</label><input id="addr-line1" className="input" autoComplete="address-line1" placeholder="N° et rue" value={address.line1} onChange={(e) => setAddr("line1", e.target.value)} /></div>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}><label htmlFor="addr-line2">Complément (facultatif)</label><input id="addr-line2" className="input" autoComplete="address-line2" placeholder="Bâtiment, étage, digicode" value={address.line2} onChange={(e) => setAddr("line2", e.target.value)} /></div>
                  <div className="field" style={{ marginBottom: 0 }}><label htmlFor="addr-cp">Code postal</label><input id="addr-cp" className="input" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={address.postalCode} onChange={(e) => setAddr("postalCode", e.target.value.replace(/\D/g, ""))} /></div>
                  <div className="field" style={{ marginBottom: 0 }}><label htmlFor="addr-city">Ville</label><input id="addr-city" className="input" autoComplete="address-level2" value={address.city} onChange={(e) => setAddr("city", e.target.value)} /></div>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}><label htmlFor="addr-phone">Téléphone (pour le livreur)</label><input id="addr-phone" className="input" type="tel" autoComplete="tel" value={address.phone} onChange={(e) => setAddr("phone", e.target.value)} /></div>
                </div>
              </fieldset>
            )}
            {delivery !== "main_propre" && <DeliveryChooser key={optionsNonce} listingId={listing.id} carrier={delivery} postalCode={address.postalCode} city={address.city} onChange={setChoice} />}
            <table className="table" style={{ marginBottom: 16 }}>
              <tbody>
                <tr data-testid="quote-price"><td>{quote.offer ? "Prix négocié" : "Prix de l'article"}</td><td style={{ textAlign: "right" }}>{formatEuros(quote.price)}</td></tr>
                <tr data-testid="quote-fee"><td>Frais de protection acheteur</td><td style={{ textAlign: "right" }}>{formatEuros(quote.buyerFee)}</td></tr>
                {delivery !== "main_propre" && <tr data-testid="quote-shipping"><td>Frais de livraison{delivery === "colissimo" ? " Colissimo" : " Mondial Relay"}</td><td style={{ textAlign: "right" }}>{choice.shippingCents !== null ? formatEuros(shippingEuros) : "à choisir"}</td></tr>}
                <tr data-testid="quote-total"><td><strong>Total à payer</strong></td><td style={{ textAlign: "right" }}><strong>{formatEuros(payTotal)}</strong></td></tr>
              </tbody>
            </table>
            {delivery !== "main_propre" && <p className="small muted">La livraison est payée avec votre achat : le vendeur n&apos;avance rien, il reçoit un bon d&apos;envoi prêt à coller et vous recevez le numéro de suivi.</p>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => setBuyOpen(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={buy} disabled={busy || !addressOk}>{busy ? "Paiement…" : `Payer ${formatEuros(payTotal)}`}</button>
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
