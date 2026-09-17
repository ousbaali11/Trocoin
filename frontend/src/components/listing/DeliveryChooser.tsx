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

interface PickupOptionsResult {
  carriers: CarrierPickupOptions[];
  unavailableReason?: string;
}

/**
 * Mémoire des options déjà lues (AUDIT §61), partagée par toute la page : la fiche annonce les précharge dès qu'elle
 * connaît le code postal de l'acheteur, si bien qu'à l'ouverture de la fenêtre de paiement — et à chaque changement de
 * transporteur, les deux étant lus ensemble — les choix, les prix et les points sont déjà là, sans attente.
 */
const TTL_MS = 5 * 60_000;
const memo = new Map<string, { at: number; promise: Promise<PickupOptionsResult>; value?: PickupOptionsResult }>();
const keyOf = (listingId: string, postalCode: string, city: string) => `${listingId}|${postalCode}|${city.trim().toLowerCase()}`;
const validPostalCode = (v: string) => /^\d{5}$/.test(v);

export function loadPickupOptions(listingId: string, postalCode: string, city: string): Promise<PickupOptionsResult> {
  const key = keyOf(listingId, postalCode, city);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const qs = `listingId=${listingId}&postalCode=${postalCode}${city.trim() ? `&city=${encodeURIComponent(city.trim())}` : ""}`;
  const entry: { at: number; promise: Promise<PickupOptionsResult>; value?: PickupOptionsResult } = { at: Date.now(), promise: api<PickupOptionsResult>(`/shipping/pickup-options?${qs}`) };
  memo.set(key, entry);
  entry.promise.then(
    (value) => {
      entry.value = value;
    },
    () => {
      if (memo.get(key) === entry) memo.delete(key);
    },
  );
  return entry.promise;
}
function peekPickupOptions(listingId: string, postalCode: string, city: string): PickupOptionsResult | null {
  const hit = memo.get(keyOf(listingId, postalCode, city));
  return hit && hit.value && Date.now() - hit.at < TTL_MS ? hit.value : null;
}
/** Tarif changé côté serveur (409 au paiement) : tout est relu. */
export function clearPickupOptions() {
  memo.clear();
}

/**
 * Choix du lieu de réception pour un envoi (AUDIT §57) : domicile, point relais, bureau de poste ou consigne
 * automatique — uniquement ce que le transporteur propose réellement autour de l'adresse saisie, avec les points
 * réels renvoyés par le prestataire d'étiquettes (GET /shipping/pickup-options), jamais une liste figée.
 *
 * Sans attente (AUDIT §61) : les trois choix sont affichés d'emblée et se cochent tout de suite ; la recherche part au
 * cinquième chiffre du code postal (plus de délai de 500 ms, plus besoin de la ville), les résultats déjà lus sont
 * repris de mémoire, et une relecture (ville précisée ensuite) se fait sans rien effacer de ce qui est affiché.
 */
export function DeliveryChooser({ listingId, carrier, postalCode, city, onChange }: { listingId: string; carrier: Carrier; postalCode: string; city: string; onChange: (c: DeliveryChoice) => void }) {
  const ready = validPostalCode(postalCode);
  const [data, setData] = useState<PickupOptionsResult | null>(() => (ready ? peekPickupOptions(listingId, postalCode, city) : null));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [receiveAt, setReceiveAt] = useState<ReceiveAt | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const notify = useRef(onChange);
  useEffect(() => {
    notify.current = onChange;
  }, [onChange]);

  const shownFor = useRef<string | null>(null); // code postal des options affichées
  useEffect(() => {
    if (!ready) {
      setData(null);
      setLoading(false);
      shownFor.current = null;
      return;
    }
    const known = peekPickupOptions(listingId, postalCode, city);
    if (known) {
      setData(known);
      setFailed(false);
      setLoading(false);
      shownFor.current = postalCode;
      return;
    }
    // Nouveau code postal : ce qui est affiché ne vaut plus, la recherche part aussitôt. Même code postal (la ville se
    // précise) : on garde l'affichage et on relit 500 ms après la dernière frappe.
    const sameArea = shownFor.current === postalCode;
    if (!sameArea) setData(null);
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(
      () => {
        loadPickupOptions(listingId, postalCode, city)
          .then((res) => {
            if (cancelled) return;
            setData(res);
            setFailed(false);
            shownFor.current = postalCode;
          })
          .catch(() => {
            if (cancelled) return;
            if (!sameArea) setData(null);
            setFailed(!sameArea);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      sameArea ? 500 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [listingId, postalCode, city, ready]);

  const current = useMemo(() => {
    const found = data?.carriers.find((o) => o.carrier === carrier);
    // Sans cotation (service injoignable), pas de prix ferme à faire payer : l'envoi n'est pas proposé pour l'instant
    if (!found && failed) return { carrier, label: "", domicile: false, pointRelais: false, points: [] as PickupPoint[], pointsUnavailable: true };
    return found ?? null;
  }, [data, carrier, failed]);
  const relais = useMemo(() => (current?.points ?? []).filter((p) => p.type === "relais"), [current]);
  const others = useMemo(() => (current?.points ?? []).filter((p) => p.type !== "relais"), [current]);
  const hasBureau = others.some((p) => p.type === "bureau_poste");
  const hasConsigne = others.some((p) => p.type === "consigne");
  const unavailable = !!current?.pointsUnavailable;

  // Transporteur, adresse ou relecture : le choix précédent est gardé tant qu'il reste proposé (un point choisi ne
  // saute plus quand la liste est simplement relue)
  useEffect(() => {
    if (!current) {
      setPointId(null);
      return;
    }
    setReceiveAt((prev) => {
      if (prev === "domicile" && current.domicile) return prev;
      if (prev === "relais" && relais.length > 0) return prev;
      if (prev === "bureau_consigne" && others.length > 0) return prev;
      return null;
    });
    setPointId((prev) => (prev && current.points.some((p) => p.id === prev) ? prev : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const shown = receiveAt === "relais" ? relais : receiveAt === "bureau_consigne" ? others : [];
  const point = shown.find((p) => p.id === pointId) ?? null;
  useEffect(() => {
    if (!current || !receiveAt) return notify.current(EMPTY);
    const cents = (receiveAt === "domicile" ? current.domicilePriceCents : current.pickupPriceCents) ?? null;
    notify.current({ receiveAt, point, complete: cents !== null && (receiveAt === "domicile" || !!point), shippingCents: cents, pointsUnavailable: unavailable });
  }, [current, receiveAt, point, unavailable]);

  if (data?.unavailableReason) return <p className="alert alert-info" style={{ margin: "0 0 12px" }} data-testid="delivery-unavailable">{data.unavailableReason}</p>;

  // Tant que la réponse du transporteur n'est pas là, les trois choix sont proposés ; ensuite, seulement ce qu'il propose ici
  const known = !!current;
  const pending = !known;
  const price = (cents?: number) => (typeof cents === "number" ? <strong> — {formatEuros(cents / 100)}</strong> : pending && ready ? <span className="skeleton" aria-hidden="true" style={{ display: "inline-block", width: 46, height: 12, marginLeft: 8, verticalAlign: "middle" }} /> : null);
  const otherLabel = known
    ? hasBureau && hasConsigne ? "En bureau de poste ou consigne automatique (locker)" : hasBureau ? "En bureau de poste" : "En consigne automatique (locker)"
    : carrier === "colissimo" ? "En bureau de poste ou consigne automatique (locker)" : "En consigne automatique (locker)";
  const nothing = !!current && !current.domicile && relais.length === 0 && others.length === 0;
  const wantsPoint = receiveAt === "relais" || receiveAt === "bureau_consigne";

  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 12px" }} data-testid="delivery-options" aria-busy={loading}>
      <legend className="label">Où souhaitez-vous recevoir le colis ?</legend>
      {nothing && <p className="alert alert-error" style={{ margin: 0 }} data-testid="carrier-unavailable">{unavailable ? "Le tarif de ce transporteur est momentanément indisponible." : "Ce transporteur ne dessert pas cette adresse."} Choisissez l&apos;autre transporteur ou la remise en main propre.</p>}
      {(pending || current?.domicile) && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "domicile"} onChange={() => setReceiveAt("domicile")} /> <span>À domicile, à l&apos;adresse ci-dessus{price(current?.domicilePriceCents)}</span></label>
      )}
      {(pending || relais.length > 0) && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "relais"} onChange={() => setReceiveAt("relais")} /> <span>En point relais{known ? ` (${relais.length} à proximité)` : ""}{price(current?.pickupPriceCents)}</span></label>
      )}
      {(pending || others.length > 0) && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "bureau_consigne"} onChange={() => setReceiveAt("bureau_consigne")} /> <span>{otherLabel}{known ? ` (${others.length} à proximité)` : ""}{price(current?.pickupPriceCents)}</span></label>
      )}
      <p className="small muted" style={{ margin: "6px 0 0" }} data-testid={ready ? undefined : "delivery-options-wait"}>
        {ready ? "Tarif du transporteur pour le colis déclaré par le vendeur, ajouté à votre paiement. Le vendeur reçoit le bon d'envoi ; vous recevez le numéro de suivi." : "Indiquez votre code postal : les prix et les points proches de chez vous s'affichent aussitôt."}
      </p>
      {wantsPoint && pending && ready && (
        <div role="status" aria-label="Recherche des points proches" data-testid="pickup-points-loading" style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 10 }}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 34 }} />)}
        </div>
      )}
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
