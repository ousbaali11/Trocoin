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
type Part = "points" | "prices";

/**
 * Mémoire des options déjà lues (AUDIT §61), partagée par toute la page : la fiche annonce les précharge dès qu'elle
 * connaît le code postal de l'acheteur, si bien qu'à l'ouverture de la fenêtre de paiement — et à chaque changement de
 * transporteur, les deux étant lus ensemble — les choix, les prix et les points sont déjà là, sans attente.
 * Deux moitiés indépendantes (points, prix) : chacune s'affiche dès qu'elle arrive.
 */
const TTL_MS = 5 * 60_000;
interface Entry { at: number; promise: Promise<PickupOptionsResult>; value?: PickupOptionsResult }
const memo = new Map<string, Entry>();
const keyOf = (listingId: string, postalCode: string, city: string, part: Part) => `${part}|${listingId}|${postalCode}|${city.trim().toLowerCase()}`;
const validPostalCode = (v: string) => /^\d{5}$/.test(v);

function loadPart(listingId: string, postalCode: string, city: string, part: Part): Promise<PickupOptionsResult> {
  const key = keyOf(listingId, postalCode, city, part);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const qs = `listingId=${listingId}&postalCode=${postalCode}${city.trim() ? `&city=${encodeURIComponent(city.trim())}` : ""}&part=${part}`;
  const entry: Entry = { at: Date.now(), promise: api<PickupOptionsResult>(`/shipping/pickup-options?${qs}`) };
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
function peek(listingId: string, postalCode: string, city: string, part: Part): PickupOptionsResult | null {
  const hit = memo.get(keyOf(listingId, postalCode, city, part));
  return hit && hit.value && Date.now() - hit.at < TTL_MS ? hit.value : null;
}
/** Préchargement depuis la fiche annonce : les deux moitiés, pour les deux transporteurs. */
export function loadPickupOptions(listingId: string, postalCode: string, city: string): Promise<[PickupOptionsResult, PickupOptionsResult]> {
  return Promise.all([loadPart(listingId, postalCode, city, "points"), loadPart(listingId, postalCode, city, "prices")]);
}
/** Tarif changé côté serveur (409 au paiement) : tout est relu. */
export function clearPickupOptions() {
  memo.clear();
}

/** Une moitié (points ou prix) pour l'adresse courante : reprise de mémoire, sinon lue — sans effacer l'affichage tant que le code postal ne change pas. */
function usePart(listingId: string, postalCode: string, city: string, part: Part, ready: boolean) {
  const [data, setData] = useState<PickupOptionsResult | null>(() => (ready ? peek(listingId, postalCode, city, part) : null));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const shownFor = useRef<string | null>(null); // code postal des données affichées
  useEffect(() => {
    if (!ready) {
      setData(null);
      setLoading(false);
      shownFor.current = null;
      return;
    }
    const known = peek(listingId, postalCode, city, part);
    if (known) {
      setData(known);
      setFailed(false);
      setLoading(false);
      shownFor.current = postalCode;
      return;
    }
    // Nouveau code postal : ce qui est affiché ne vaut plus, la lecture part aussitôt. Même code postal (la ville se
    // précise) : on garde l'affichage et on relit 500 ms après la dernière frappe.
    const sameArea = shownFor.current === postalCode;
    if (!sameArea) setData(null);
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(
      () => {
        loadPart(listingId, postalCode, city, part)
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
  }, [listingId, postalCode, city, part, ready]);
  return { data, loading, failed };
}

/**
 * Choix du lieu de réception pour un envoi (AUDIT §57) : domicile, point relais, bureau de poste ou consigne
 * automatique — uniquement ce que le transporteur propose réellement autour de l'adresse saisie, avec les points
 * réels renvoyés par le prestataire d'étiquettes (GET /shipping/pickup-options), jamais une liste figée.
 *
 * Sans attente (AUDIT §61) : les trois choix sont affichés d'emblée et se cochent tout de suite ; la recherche part au
 * cinquième chiffre du code postal (plus de délai de 500 ms, plus besoin de la ville) ; la liste des points et les prix
 * arrivent chacun de leur côté ; les résultats déjà lus sont repris de mémoire, et une relecture (ville précisée
 * ensuite) se fait sans rien effacer de ce qui est affiché.
 */
export function DeliveryChooser({ listingId, carrier, postalCode, city, onChange }: { listingId: string; carrier: Carrier; postalCode: string; city: string; onChange: (c: DeliveryChoice) => void }) {
  const ready = validPostalCode(postalCode);
  const pts = usePart(listingId, postalCode, city, "points", ready);
  const prc = usePart(listingId, postalCode, city, "prices", ready);
  const [receiveAt, setReceiveAt] = useState<ReceiveAt | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const notify = useRef(onChange);
  useEffect(() => {
    notify.current = onChange;
  }, [onChange]);

  // Prix et disponibilité (cotation) ; sans cotation, pas de prix ferme à faire payer : l'envoi n'est pas proposé pour l'instant
  const prices = useMemo(() => {
    const found = prc.data?.carriers.find((o) => o.carrier === carrier);
    if (!found && prc.failed) return { carrier, label: "", domicile: false, pointRelais: false, points: [] as PickupPoint[], pointsUnavailable: true };
    return found ?? null;
  }, [prc.data, prc.failed, carrier]);
  const pointsData = useMemo(() => pts.data?.carriers.find((o) => o.carrier === carrier) ?? null, [pts.data, carrier]);
  const points = useMemo(() => pointsData?.points ?? [], [pointsData]);
  const relais = useMemo(() => points.filter((p) => p.type === "relais"), [points]);
  const others = useMemo(() => points.filter((p) => p.type !== "relais"), [points]);
  const hasBureau = others.some((p) => p.type === "bureau_poste");
  const hasConsigne = others.some((p) => p.type === "consigne");
  const unavailable = !!prices?.pointsUnavailable;
  const pricesKnown = !!prices;
  const pointsKnown = !!pointsData || pts.failed;
  // Retrait proposé par le transporteur ici : coté (prix) ET au moins un point ; tant qu'une moitié manque, on suppose que oui
  const pickupOffered = (!pricesKnown || !!prices?.pointRelais) && (!pointsKnown || points.length > 0);
  const relaisOffered = pickupOffered && (!pointsKnown || relais.length > 0);
  const othersOffered = pickupOffered && (!pointsKnown || others.length > 0);
  const homeOffered = !pricesKnown || !!prices?.domicile;

  // Transporteur, adresse ou relecture : le choix précédent est gardé tant qu'il reste proposé (un point choisi ne
  // saute plus quand la liste est simplement relue)
  useEffect(() => {
    setReceiveAt((prev) => {
      if (prev === "domicile" && homeOffered) return prev;
      if (prev === "relais" && relaisOffered) return prev;
      if (prev === "bureau_consigne" && othersOffered) return prev;
      return null;
    });
    setPointId((prev) => (prev && points.some((p) => p.id === prev) ? prev : null));
  }, [homeOffered, relaisOffered, othersOffered, points]);

  const shown = receiveAt === "relais" ? relais : receiveAt === "bureau_consigne" ? others : [];
  const point = shown.find((p) => p.id === pointId) ?? null;
  useEffect(() => {
    if (!prices || !receiveAt) return notify.current(EMPTY);
    const cents = (receiveAt === "domicile" ? prices.domicilePriceCents : prices.pickupPriceCents) ?? null;
    notify.current({ receiveAt, point, complete: cents !== null && (receiveAt === "domicile" || !!point), shippingCents: cents, pointsUnavailable: unavailable });
  }, [prices, receiveAt, point, unavailable]);

  const reason = prc.data?.unavailableReason || pts.data?.unavailableReason;
  if (reason) return <p className="alert alert-info" style={{ margin: "0 0 12px" }} data-testid="delivery-unavailable">{reason}</p>;

  const price = (cents?: number) => (typeof cents === "number" ? <strong> — {formatEuros(cents / 100)}</strong> : !pricesKnown && ready ? <span className="skeleton" aria-hidden="true" style={{ display: "inline-block", width: 46, height: 12, marginLeft: 8, verticalAlign: "middle" }} /> : null);
  const otherLabel = pointsKnown && points.length > 0
    ? hasBureau && hasConsigne ? "En bureau de poste ou consigne automatique (locker)" : hasBureau ? "En bureau de poste" : "En consigne automatique (locker)"
    : carrier === "colissimo" ? "En bureau de poste ou consigne automatique (locker)" : "En consigne automatique (locker)";
  const nothing = pricesKnown && pointsKnown && !homeOffered && !relaisOffered && !othersOffered;
  const wantsPoint = receiveAt === "relais" || receiveAt === "bureau_consigne";
  const count = (n: number) => (pointsKnown ? ` (${n} à proximité)` : "");

  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 12px" }} data-testid="delivery-options" aria-busy={pts.loading || prc.loading}>
      <legend className="label">Où souhaitez-vous recevoir le colis ?</legend>
      {nothing && <p className="alert alert-error" style={{ margin: 0 }} data-testid="carrier-unavailable">{unavailable ? "Le tarif de ce transporteur est momentanément indisponible." : "Ce transporteur ne dessert pas cette adresse."} Choisissez l&apos;autre transporteur ou la remise en main propre.</p>}
      {homeOffered && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "domicile"} onChange={() => setReceiveAt("domicile")} /> <span>À domicile, à l&apos;adresse ci-dessus{price(prices?.domicilePriceCents)}</span></label>
      )}
      {relaisOffered && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "relais"} onChange={() => setReceiveAt("relais")} /> <span>En point relais{count(relais.length)}{price(prices?.pickupPriceCents)}</span></label>
      )}
      {othersOffered && (
        <label className="checkbox"><input type="radio" name="receive-at" checked={receiveAt === "bureau_consigne"} onChange={() => setReceiveAt("bureau_consigne")} /> <span>{otherLabel}{count(others.length)}{price(prices?.pickupPriceCents)}</span></label>
      )}
      <p className="small muted" style={{ margin: "6px 0 0" }} data-testid={ready ? undefined : "delivery-options-wait"}>
        {ready ? "Tarif du transporteur pour le colis déclaré par le vendeur, ajouté à votre paiement. Le vendeur reçoit le bon d'envoi ; vous recevez le numéro de suivi." : "Indiquez votre code postal : les prix et les points proches de chez vous s'affichent aussitôt."}
      </p>
      {wantsPoint && !pointsKnown && ready && (
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
