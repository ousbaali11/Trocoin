"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PICKUP_TYPE_LABELS, formatEuros, formatPhone } from "@/lib/format";

/** Téléphone français à 10 chiffres (fixe ou mobile), écrit avec ou sans espaces, points, +33 ou 0033. */
const isFrenchPhone = (raw?: string | null): boolean => {
  if (!raw) return false;
  let d = raw.replace(/[^0-9+]/g, "");
  if (d.startsWith("0033")) d = `+33${d.slice(4)}`;
  if (d.startsWith("+33")) d = `0${d.slice(3)}`;
  return /^0[1-9][0-9]{8}$/.test(d);
};
import type { DeliveryAddress, RelayPoint, Shipment, ShippingMode, ShippingRate, Transaction } from "@/lib/types";

const CARRIER: Record<string, string> = { colissimo: "Colissimo", mondial_relay: "Mondial Relay" };

/**
 * Côté vendeur, vente payée avec envoi : colis (prérempli depuis l'annonce), mode (domicile / point
 * relais), adresses, tarif calculé, achat de l'étiquette, PDF à imprimer, numéro de suivi. Tout refus
 * du prestataire s'affiche ici et laisse la saisie manuelle du numéro de suivi disponible.
 */
export function ShipmentPanel({ tx, onChanged }: { tx: Transaction; onChanged: () => void }) {
  const { user } = useAuth();
  const [shipment, setShipment] = useState<Shipment | null | undefined>(undefined);
  // Choix de l'acheteur au paiement (AUDIT §57) : mode et point de retrait ne se changent pas ici. Ventes antérieures : le vendeur choisit.
  const buyerChoice = !!tx.deliveryMode;
  const [mode, setMode] = useState<ShippingMode>(tx.deliveryMode ?? (tx.deliveryMethod === "mondial_relay" ? "point_relais" : "domicile"));
  const [weight, setWeight] = useState("1000");
  const [dims, setDims] = useState({ l: "", w: "", h: "" });
  // Colis déclaré au dépôt de l'annonce (le vendeur en est propriétaire : la fiche répond même réservée)
  useEffect(() => {
    api<{ weightGrams?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }>(`/listings/${tx.listingId}`)
      .then((l) => {
        if (l.weightGrams) setWeight(String(l.weightGrams));
        setDims({ l: l.lengthCm ? String(l.lengthCm) : "", w: l.widthCm ? String(l.widthCm) : "", h: l.heightCm ? String(l.heightCm) : "" });
      })
      .catch(() => undefined);
  }, [tx.listingId]);
  const [sender, setSender] = useState<DeliveryAddress>({ name: user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.displayName : "", line1: "", line2: "", postalCode: user?.postalCode ?? "", city: user?.city ?? "", phone: isFrenchPhone(user?.phoneNumber) ? formatPhone(user!.phoneNumber!) : "" });
  const [recipient, setRecipient] = useState<DeliveryAddress>(tx.shippingAddress ?? { name: tx.other?.displayName ?? "", line1: "", line2: "", postalCode: "", city: "", phone: "" });
  const [rates, setRates] = useState<ShippingRate[] | null>(null);
  const [points, setPoints] = useState<RelayPoint[]>([]);
  const [relayPointId, setRelayPointId] = useState(tx.pickupPoint?.id ?? "");
  const [busy, setBusy] = useState<"" | "tarifs" | "etiquette">("");
  const [addressesOpen, setAddressesOpen] = useState(() => !tx.shippingAddress || !(user?.postalCode && user?.city) || !isFrenchPhone(user?.phoneNumber));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setShipment(await api<Shipment>(`/transactions/${tx.id}/shipment`));
    } catch (e) {
      setShipment(e instanceof ApiError && e.status === 404 ? null : null);
    }
  }, [tx.id]);
  useEffect(() => {
    load();
  }, [load]);

  const parcel = () => ({
    weightGrams: Math.max(10, Math.round(Number(weight) || 1000)),
    ...(dims.l ? { lengthCm: Number(dims.l) } : {}),
    ...(dims.w ? { widthCm: Number(dims.w) } : {}),
    ...(dims.h ? { heightCm: Number(dims.h) } : {}),
  });
  // Téléphones (AUDIT §55) : exigés par le transporteur. Celui de l'expéditeur est repris du compte ; celui du
  // destinataire est facultatif ici (à défaut, l'API transmet au transporteur celui de l'acheteur, sans l'afficher).
  const senderPhoneOk = isFrenchPhone(sender.phone);
  const recipientPhoneOk = !recipient.phone?.trim() || isFrenchPhone(recipient.phone);
  const addressesOk = senderPhoneOk && recipientPhoneOk && sender.line1.trim().length >= 3 && /^\d{5}$/.test(sender.postalCode) && sender.city.trim() && recipient.name.trim().length >= 2 && recipient.line1.trim().length >= 3 && /^\d{5}$/.test(recipient.postalCode) && recipient.city.trim();

  const getRates = async () => {
    setBusy("tarifs");
    setError(null);
    try {
      const r = await api<{ rates: ShippingRate[] }>(`/transactions/${tx.id}/shipment/quote`, { method: "POST", body: { parcel: parcel(), fromPostalCode: sender.postalCode, toPostalCode: recipient.postalCode, fromCity: sender.city, toCity: recipient.city } });
      setRates(r.rates);
      if (!r.rates.length) setError("Aucune offre pour ce colis. Vérifiez le poids et les codes postaux, ou saisissez votre numéro de suivi à la main.");
      if (mode === "point_relais" && !tx.pickupPoint) {
        const pts = await api<RelayPoint[]>(`/transactions/${tx.id}/shipment/relay-points?postalCode=${recipient.postalCode}&city=${encodeURIComponent(recipient.city)}`).catch(() => []);
        setPoints(pts);
        if (pts[0] && !relayPointId) setRelayPointId(pts[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const buyLabel = async () => {
    setBusy("etiquette");
    setError(null);
    try {
      await api<Shipment>(`/transactions/${tx.id}/shipment`, { method: "POST", body: { mode, parcel: parcel(), sender: clean(sender), recipient: clean(recipient), ...(mode === "point_relais" ? { relayPointId } : {}) } });
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      await load();
    } finally {
      setBusy("");
    }
  };

  const rate = rates?.find((r) => r.mode === mode);

  if (shipment === undefined) return <div className="skeleton" style={{ height: 80 }} />;

  if (shipment && shipment.status !== "echec") {
    return (
      <div className="panel" style={{ background: "var(--accent-tint)", borderColor: "#c8e5da" }} data-testid="shipment-ready">
        <p className="eyebrow" style={{ margin: 0 }}>Étiquette prête</p>
        <p style={{ margin: "6px 0" }}>
          <strong>{CARRIER[shipment.carrier]}</strong> · {shipment.mode === "domicile" ? "à domicile" : "en point relais"} · {shipment.weightGrams} g{shipment.priceCents ? ` · ${formatEuros(shipment.priceCents / 100)}` : ""}
        </p>
        <p style={{ margin: "6px 0" }}>Numéro de suivi : <strong data-testid="shipment-tracking">{shipment.trackingNumber}</strong>{shipment.trackingUrl && <> · <a href={shipment.trackingUrl} target="_blank" rel="noopener">suivre</a></>}</p>
        <div className="row" style={{ marginTop: 8 }}>
          <a className="btn btn-dark" href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/transactions/${tx.id}/shipment/label.pdf`} onClick={(e) => { e.preventDefault(); downloadLabel(tx.id); }} data-testid="download-label">Télécharger l&apos;étiquette (PDF)</a>
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>Imprimez l&apos;étiquette, collez-la sur le colis, puis déposez-le {shipment.mode === "domicile" ? "en bureau de poste" : "au point relais choisi"} et confirmez l&apos;expédition ci-dessous.</p>
      </div>
    );
  }

  return (
    <div className="panel" data-testid="shipment-panel">
      <p className="eyebrow" style={{ margin: 0 }}>Étiquette d&apos;envoi</p>
      <p className="small muted" style={{ margin: "6px 0 12px" }}>Tarif calculé automatiquement d&apos;après le colis, étiquette PDF à imprimer, numéro de suivi transmis à l&apos;acheteur. Vous pouvez aussi expédier par vos propres moyens et saisir le numéro de suivi plus bas.</p>
      {shipment?.status === "echec" && shipment.error && <div className="alert alert-error" role="alert" data-testid="shipment-error">Dernière tentative refusée : {shipment.error}</div>}
      {!tx.shippingAddress && <div className="alert alert-info">L&apos;acheteur n&apos;a pas laissé d&apos;adresse de livraison (vente antérieure au formulaire d&apos;adresse) : demandez-la lui par messagerie et saisissez-la ci-dessous.</div>}

      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="field" style={{ flex: "1 1 220px", marginBottom: 0 }}>
          <span className="label">Mode d&apos;envoi ({CARRIER[tx.deliveryMethod]})</span>
          {buyerChoice ? (
            <p className="small" style={{ margin: "4px 0 0" }} data-testid="ship-mode-fixed">
              Choisi par l&apos;acheteur : <strong>{mode === "domicile" ? "à domicile" : tx.pickupPoint ? `${PICKUP_TYPE_LABELS[tx.pickupPoint.type].toLowerCase()} « ${tx.pickupPoint.name} » (${tx.pickupPoint.postalCode} ${tx.pickupPoint.city})` : "en point de retrait"}</strong>
            </p>
          ) : (
            <>
              <label className="checkbox"><input type="radio" name="ship-mode" checked={mode === "domicile"} onChange={() => setMode("domicile")} /> À domicile</label>
              <label className="checkbox"><input type="radio" name="ship-mode" checked={mode === "point_relais"} onChange={() => setMode("point_relais")} /> En point relais</label>
            </>
          )}
        </div>
        <div className="field" style={{ flex: "1 1 220px", marginBottom: 0 }}>
          <label htmlFor="ship-weight">Poids du colis (g)</label>
          <input id="ship-weight" className="input" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value.replace(/\D/g, ""))} />
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {(["l", "w", "h"] as const).map((k) => (
              <input key={k} className="input" style={{ width: 82 }} inputMode="numeric" placeholder={k === "l" ? "L cm" : k === "w" ? "l cm" : "H cm"} aria-label={k === "l" ? "Longueur en cm" : k === "w" ? "Largeur en cm" : "Hauteur en cm"} value={dims[k]} onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value.replace(/\D/g, "") }))} />
            ))}
          </div>
        </div>
      </div>

      {/* Déplié d'emblée quand une adresse manque ; l'état suit ensuite le clic seulement (pas la saisie) */}
      <details style={{ marginTop: 12 }} open={addressesOpen} onToggle={(e) => setAddressesOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="small" style={{ cursor: "pointer" }}>Adresses (expéditeur et destinataire)</summary>
        <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 8 }}>
          <AddressFields legend="Expéditeur (vous)" prefix="from" value={sender} onChange={setSender} phoneRequired phoneInvalid={!!sender.phone?.trim() && !senderPhoneOk} />
          <AddressFields legend="Destinataire (acheteur)" prefix="to" value={recipient} onChange={setRecipient} phoneInvalid={!recipientPhoneOk} />
        </div>
      </details>

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-outline" disabled={busy !== "" || !addressesOk} onClick={getRates} data-testid="get-rates">{busy === "tarifs" ? "Calcul…" : "Calculer le tarif"}</button>
      </div>
      {rates && rates.length > 0 && (
        <div style={{ marginTop: 12 }} data-testid="rates">
          {rates.filter((r) => !buyerChoice || r.mode === mode).map((r) => (
            <label key={r.offerCode} className="checkbox">
              <input type="radio" name="ship-rate" checked={mode === r.mode} onChange={() => setMode(r.mode)} /> {r.label} — <strong>{formatEuros(r.priceCents / 100)}</strong> <span className="muted small">· {r.deliveryDays} j ouvrés</span>
            </label>
          ))}
          {mode === "point_relais" && !tx.pickupPoint && points.length > 0 && (
            <div className="field" style={{ marginTop: 8, maxWidth: 480 }}>
              <label htmlFor="ship-point">Point relais</label>
              <select id="ship-point" className="select" value={relayPointId} onChange={(e) => setRelayPointId(e.target.value)}>
                {points.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.line1}, {p.postalCode} {p.city}{p.distanceMeters ? ` (${Math.round(p.distanceMeters / 100) / 10} km)` : ""}</option>)}
              </select>
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-dark" disabled={busy !== "" || !rate || (mode === "point_relais" && !relayPointId)} onClick={buyLabel} data-testid="buy-label">{busy === "etiquette" ? "Étiquette en cours…" : rate ? `Acheter l'étiquette (${formatEuros(rate.priceCents / 100)})` : "Aucune offre pour ce mode"}</button>
          </div>
        </div>
      )}
      {error && <div className="alert alert-error" role="alert" style={{ marginTop: 10 }} data-testid="shipment-error">{error}</div>}
    </div>
  );
}

function clean(a: DeliveryAddress): DeliveryAddress {
  return { name: a.name.trim(), line1: a.line1.trim(), line2: a.line2?.trim() || undefined, postalCode: a.postalCode, city: a.city.trim(), phone: a.phone?.trim() || undefined };
}

async function downloadLabel(txId: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("trocoin_token") : null;
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/transactions/${txId}/shipment/label.pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `etiquette-${txId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function AddressFields({ legend, prefix, value, onChange, phoneRequired, phoneInvalid }: { legend: string; prefix: string; value: DeliveryAddress; onChange: (a: DeliveryAddress) => void; phoneRequired?: boolean; phoneInvalid?: boolean }) {
  const set = (k: keyof DeliveryAddress, v: string) => onChange({ ...value, [k]: v });
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, flex: "1 1 260px" }}>
      <legend className="label">{legend}</legend>
      <div className="field" style={{ marginBottom: 6 }}><label htmlFor={`${prefix}-name`}>Nom</label><input id={`${prefix}-name`} className="input" value={value.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div className="field" style={{ marginBottom: 6 }}><label htmlFor={`${prefix}-line1`}>Adresse</label><input id={`${prefix}-line1`} className="input" placeholder="N° et rue" value={value.line1} onChange={(e) => set("line1", e.target.value)} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ marginBottom: 6, width: 120 }}><label htmlFor={`${prefix}-cp`}>Code postal</label><input id={`${prefix}-cp`} className="input" inputMode="numeric" maxLength={5} value={value.postalCode} onChange={(e) => set("postalCode", e.target.value.replace(/\D/g, ""))} /></div>
        <div className="field" style={{ marginBottom: 6, flex: 1 }}><label htmlFor={`${prefix}-city`}>Ville</label><input id={`${prefix}-city`} className="input" value={value.city} onChange={(e) => set("city", e.target.value)} /></div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor={`${prefix}-phone`}>Téléphone{phoneRequired ? " *" : " (facultatif)"}</label>
        <input id={`${prefix}-phone`} className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="06 12 34 56 78" value={value.phone ?? ""} onChange={(e) => set("phone", e.target.value)} aria-invalid={phoneInvalid ? true : undefined} aria-describedby={`${prefix}-phone-hint`} />
        <span className={phoneInvalid ? "error-text" : "hint"} id={`${prefix}-phone-hint`} data-testid={`${prefix}-phone-hint`}>{phoneInvalid ? "Numéro à 10 chiffres attendu, par exemple 06 12 34 56 78." : phoneRequired ? "Exigé par le transporteur pour générer l'étiquette." : "À défaut, le numéro du compte de l'acheteur est transmis au transporteur (il ne vous est pas affiché)."}</span>
      </div>
    </fieldset>
  );
}
