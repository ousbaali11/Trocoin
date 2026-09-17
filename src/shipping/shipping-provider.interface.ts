/**
 * Étiquettes transporteur : fournisseur interchangeable, sur le modèle d'IEmailProvider et
 * d'IPaymentProvider (docs/etiquettes-transporteur.md).
 *
 *   SHIPPING_PROVIDER=mock  : étiquette PDF et numéro de suivi simulés (dev, tests) — interdit en production.
 *   SHIPPING_PROVIDER=none  : aucune étiquette possible → 503 explicite (production tant qu'aucun compte
 *                             prestataire n'est ouvert ; le vendeur saisit son numéro de suivi à la main).
 *   SHIPPING_PROVIDER=boxtal : BoxtalShippingProvider (v1 cotation + v3 étiquettes), sandbox ou production selon BOXTAL_ENV.
 */

/** Transporteurs proposés aux particuliers en France (les deux plus utilisés). */
export type ShippingCarrier = 'colissimo' | 'mondial_relay';
/** Envoi à domicile ou dépôt / retrait en point relais. */
export type ShippingMode = 'domicile' | 'point_relais';

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2, « FR » par défaut. */
  country: string;
  phone?: string;
  email?: string;
}

export interface Parcel {
  weightGrams: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface QuoteInput {
  carrier: ShippingCarrier;
  parcel: Parcel;
  fromPostalCode: string;
  toPostalCode: string;
  /** Communes (facultatives) : affinent la cotation chez le prestataire. */
  fromCity?: string;
  toCity?: string;
}

export interface ShippingRate {
  carrier: ShippingCarrier;
  mode: ShippingMode;
  /** Prix TTC en centimes, tel que facturé au vendeur. */
  priceCents: number;
  /** Délai indicatif en jours ouvrés. */
  deliveryDays: number;
  /** Code de l'offre chez le prestataire (Boxtal : SHIPPING_OFFER_CODE) ; « simulation » en mode mock. */
  offerCode: string;
  label: string;
}

/** Nature d'un point de retrait : relais commerçant, bureau de poste, consigne automatique (locker). */
export type PickupPointType = 'relais' | 'bureau_poste' | 'consigne';

/**
 * Classe un point de retrait d'après ce que le réseau du transporteur en dit : le type fourni par le prestataire
 * quand il existe, sinon le nom commercial du point (« LOCKER … », « CONSIGNE … », « BUREAU DE POSTE … », « LA POSTE … »),
 * tel que les transporteurs le publient. Sans indice, c'est un relais commerçant.
 */
export function classifyPickupPoint(name: string, providerType?: string): PickupPointType {
  const s = `${providerType || ''} ${name || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/locker|consigne|pickup[ _-]?station|automate|casier|\bapm\b|parcel[ _-]?station/.test(s)) return 'consigne';
  if (/bureau de poste|la poste|\bbp\b|post[ _-]?office|\bposte\b|agence postale|\bbdp\b/.test(s)) return 'bureau_poste';
  return 'relais';
}

export interface RelayPoint {
  id: string;
  name: string;
  /** Relais commerçant, bureau de poste ou consigne automatique. */
  type: PickupPointType;
  line1: string;
  postalCode: string;
  city: string;
  /** Horaires résumés, tels que renvoyés par le prestataire. */
  hours?: string;
  distanceMeters?: number;
}

export interface CreateLabelInput {
  carrier: ShippingCarrier;
  mode: ShippingMode;
  offerCode: string;
  parcel: Parcel;
  sender: ShippingAddress;
  recipient: ShippingAddress;
  relayPointId?: string;
  /** Référence interne (identifiant de la transaction) reprise sur l'étiquette. */
  reference: string;
  /** Description courte du contenu (titre de l'annonce), exigée par les transporteurs. */
  contentDescription: string;
  /** Valeur déclarée en centimes (assurance / douane). */
  declaredValueCents: number;
}

export interface LabelResult {
  trackingNumber: string;
  trackingUrl: string;
  /** Étiquette prête à imprimer (format 10 × 15 cm chez tous les prestataires visés). */
  labelPdf: Buffer;
  /** Identifiant de l'expédition chez le prestataire. */
  providerRef: string;
  priceCents: number;
}

export type TrackingState = 'etiquette_creee' | 'pris_en_charge' | 'en_transit' | 'disponible_en_relais' | 'livre' | 'incident';

export interface TrackingEvent {
  at: string;
  label: string;
  location?: string;
}

export interface TrackingInfo {
  state: TrackingState;
  events: TrackingEvent[];
}

/** Erreur du prestataire, rendue à l'appelant sans bloquer le reste de la transaction. */
export class ShippingProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: 'adresse_invalide' | 'transporteur_indisponible' | 'etiquette_impossible' | 'non_configure' | 'reseau',
    public readonly reason: string,
  ) {
    // Message lu par le vendeur : pas de nom de prestataire ni de détail technique (AUDIT §55), ils restent dans `provider` et le journal
    super(`Étiquette non générée : ${reason}`);
  }
}

export interface IShippingProvider {
  readonly name: string;
  /** Tarifs disponibles pour un colis, un transporteur et deux codes postaux. */
  quote(input: QuoteInput): Promise<ShippingRate[]>;
  /** Points relais proches d'un code postal (obligatoire pour le mode point_relais) ; la commune affine la recherche. */
  searchRelayPoints(carrier: ShippingCarrier, postalCode: string, city?: string): Promise<RelayPoint[]>;
  /** Achat de l'étiquette : numéro de suivi + PDF. */
  createLabel(input: CreateLabelInput): Promise<LabelResult>;
  /** Suivi d'un envoi (la référence prestataire permet le suivi par commande quand le numéro transporteur tarde). */
  track(carrier: ShippingCarrier, trackingNumber: string, providerRef?: string): Promise<TrackingInfo>;
  /** Annulation d'une commande chez le prestataire (facultatif). */
  cancel?(providerRef: string): Promise<boolean>;
}
