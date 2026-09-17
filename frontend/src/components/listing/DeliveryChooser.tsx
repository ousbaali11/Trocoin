"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatEuros, PICKUP_TYPE_LABELS } from "@/lib/format";
import type { CarrierPickupOptions, PickupPoint } from "@/lib/types";

export type Carrier = "colissimo" | "mondial_relay";
/** Où l'acheteur reçoit le colis : chez lui, dans un relais commerçant, ou dans un bureau de poste / une consigne automatique. */
export type ReceiveAt = "domicile" | "relais" | "bureau_consigne";
export interface DeliveryChoice {
  receiveAt: ReceiveAt | null;
  point: PickupPoint | null;
  /** Vrai quand le choix permet de payer : mode choisi, prix connu, point choisi pour un retrait. */
  complete: boolean;
  /** Frais de livraison de l'option choisie, en centimes (AUDIT §59) : ajoutés au total payé par l'acheteur. */
  shippingCents: number | null;
  pointsUnavailable: boolean;
}

const EMPTY: DeliveryChoice = { receiveAt: null, point: null, complete: false, shippingCents: null, pointsUnavailable: false };

/**
 * Choix du lieu de réception pour un envoi (AUDIT §57) : domicile, point relais, bureau de poste ou consigne
 * automatique — uniquement ce que le transporteur propose réellement autour de l'adresse saisie, avec les points
 * réels renvoyés par le prestataire d'étiquettes (GET /shipping/pickup-options), jamais une liste figée.
 */
export function DeliveryChooser({ listingId, carrier, postalCode, city, onChange }: { listingId: string; carrier: Carrier; postalCode: string; city: string; onChange: (c: DeliveryChoice) => void }) {
  const [options, setOptions] = useState<CarrierPickupOptions[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [receiveAt, setReceiveAt] = useState<ReceiveAt | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const notify = useRef(onChange);
  useEffect(() => {
    notify.current = onChange;
  }, [onChange]);

  const ready = /^\d{5}$/.test(postalCode) && city.trim().length >= 1;
  // Recherche 500 ms après la dernière frappe dans le code postal ou la ville
  useEffect(() => {
    if (!ready) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ carriers: CarrierPickupOptions[]; unavailableReason?: string }>(`/shipping/pickup-options?listingId=${listingId}&postalCode=${postalCode}&city=${encodeURIComponent(city.trim())}`);
        if (cancelled) return;
        setOptions(res.carriers);
        setReason(res.unavailableReason ?? null);
        setFailed(false);
      } catch {
        if (cancelled) return;
        setOptions(null);
        setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [listingId, postalCode, city, ready]);

  const current = useMemo(() => {
    const found = options?.find((o) => o.carrier === carrier);
    // Sans cotation (service injoignable), pas de prix ferme à faire payer : l'envoi n'est pas proposé pour l'instant
    if (!found && failed) return { carrier, label: "", domicile: false, pointRelais: false, points: [] as PickupPoint[], pointsUnavailable: true };
    return found ?? null;
  }, [options, carrier, failed]);
  const relais = useMemo(() => (current?.points ?? []).filter((p) => p.type === "relais"), [current]);
  const others = useMemo(() => (current?.points ?? []).filter((p) => p.type !== "relais"), [current]);
  const hasBureau = others.some((p) => p.type === "bureau_poste");
  const hasConsigne = others.some((p) => p.type === "consigne");
  const unavailable = !!current?.pointsUnavailable;

  // Changement de transporteur ou d'adresse : le choix précédent ne vaut plus s'il n'est plus proposé
  useEffect(() => {
    setPointId(null);
    setReceiveAt((prev) => {
      if (!current) return null;
      if (prev === "domicile" && current.domicile) return prev;
      if (prev === "relais" && relais.length > 0) return prev;
      if (prev === "bureau_consigne" && others.length > 0) return prev;
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const shown = receiveAt === "relais" ? relais : receiveAt === "bureau_consigne" ? others : [];
  const point = shown.find((p) => p.id === pointId) ?? null;
  useEffect(() => {
    if (!current || !receiveAt) return notify.current(EMPTY);
    const cents = (receiveAt === "domicile" ? current.domicilePriceCents : current.pickupPriceCents) ?? null;
    notify.current({ receiveAt, point, complete: cents !== null && (receiveAt === "domicile" || !!point), shippingCents: cents, pointsUnavailable: unavailable });
  }, [current, receiveAt, point, unavailable]);

  if (!ready) return <p className="small muted" style={{ margin: "0 0 12px" }} data-testid="delivery-options-wait">Indiquez votre code postal et votre ville : les options de réception proposées par le transporteur s&apos;afficheront ici.</p>;
  if (loading && !current) return <p className="small muted" role="status" style={{ margin: "0 0 12px" }} data-testid="delivery-options-loading">Recherche des options de réception autour de {postalCode}…</p>;
  if (reason) return <p className="alert alert-info" style={{ margin: "0 0 12px" }} data-testid="delivery-unavailable">{reason}</p>;
  if (!current) return null;
  const homePrice = typeof current.domicilePriceCents === "number" ? ` — ${formatEuros(current.domicilePriceCents / 100)}` : "";
  const pickupPrice = typeof current.pickupPriceCents === "number" ? ` — ${formatEuros(current.pickupPriceCents / 100)}` : "";

  const otherLabel = hasBureau && hasConsigne ? "En bureau de poste ou consigne automatique (locker)" : hasBureau ? "En bureau de poste" : "En consigne automatique (locker)";
  const nothing = !current.domicile && relais.length === 0 && others.length === 0;

  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 12px" }} data-testid="delivery-options" aria-busy={loading}>
      <legend className="label">Où souhaitez-vous recevoir le colis ?</legend>
      {nothing && <p className="alert alert-error" style={{ margin: 0 }} data-testid="carrier-unavailable">{unavailable ? "Le tarif de ce transporteur est momentanément indisponible." : "Ce transporteur ne dessert pas cette adresse."} Choisissez l&apos;autre transporteur ou la remise en main propre.</p>}
      {current.domicile && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "domicile"} onChange={() => setReceiveAt("domicile")} /> À domicile, à l&apos;adresse ci-dessus<strong>{homePrice}</strong></label>
      )}
      {relais.length > 0 && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "relais"} onChange={() => setReceiveAt("relais")} /> En point relais ({relais.length} à proximité)<strong>{pickupPrice}</strong></label>
      )}
      {others.length > 0 && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "bureau_consigne"} onChange={() => setReceiveAt("bureau_consigne")} /> {otherLabel} ({others.length} à proximité)<strong>{pickupPrice}</strong></label>
      )}
      <p className="small muted" style={{ margin: "6px 0 0" }}>Tarif du transporteur pour le colis déclaré par le vendeur, ajouté à votre paiement. Le vendeur reçoit le bon d&apos;envoi ; vous recevez le numéro de suivi.</p>
      {shown.length > 0 && (
        <div role="radiogroup" aria-label="Points de retrait proposés par le transporteur" data-testid="pickup-points" style={{ marginTop: 8, maxHeight: 230, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10 }}>
          {shown.map((p, i) => (
            <label key={p.id} data-testid="pickup-point" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px", borderTop: i ? "1px solid var(--line-soft)" : 0, cursor: "pointer", background: pointId === p.id ? "var(--accent-tint)" : undefined }}>
              <input type="radio" name="pickup-point" checked={pointId === p.id} onChange={() => setPointId(p.id)} style={{ marginTop: 3 }} />
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: ".92rem" }}>{p.name}</strong>
                <span className="small muted" style={{ display: "block" }}>
                  <span className="pill" style={{ marginRight: 6 }}>{PICKUP_TYPE_LABELS[p.type]}</span>
                  {[p.line1, `${p.postalCode} ${p.city}`].filter(Boolean).join(", ")}
                  {typeof p.distanceMeters === "number" ? ` · ${p.distanceMeters < 1000 ? `${Math.round(p.distanceMeters / 10) * 10} m` : `${(p.distanceMeters / 1000).toFixed(1).replace(".", ",")} km`}` : ""}
                </span>
                {p.hours && <span className="small muted" style={{ display: "block" }}>{p.hours}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
