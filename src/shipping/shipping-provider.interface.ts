/**
 * Étiquettes transporteur : fournisseur interchangeable, sur le modèle d'IEmailProvider et
 * d'IPaymentProvider (docs/etiquettes-transporteur.md).
 *
 *   SHIPPING_PROVIDER=mock  : étiquette PDF et numéro de suivi simulés (dev, tests) — interdit en production.
 *   SHIPPING_PROVIDER=none  : aucune étiquette possible → 503 explicite (production tant qu'aucun compte
 *                             prestataire n'est ouvert ; le vendeur saisit son numéro de suivi à la main).
 *   SHIPPING_PROVIDER=boxtal : phase 2, une fois les clés de test fournies.
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

export interface RelayPoint {
  id: string;
  name: string;
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
    super(`Étiquette non générée (${provider}) : ${reason}`);
  }
}

export interface IShippingProvider {
  readonly name: string;
  /** Tarifs disponibles pour un colis, un transporteur et deux codes postaux. */
  quote(input: QuoteInput): Promise<ShippingRate[]>;
  /** Points relais proches d'un code postal (obligatoire pour le mode point_relais). */
  searchRelayPoints(carrier: ShippingCarrier, postalCode: string): Promise<RelayPoint[]>;
  /** Achat de l'étiquette : numéro de suivi + PDF. */
  createLabel(input: CreateLabelInput): Promise<LabelResult>;
  /** Suivi d'un envoi. */
  track(carrier: ShippingCarrier, trackingNumber: string): Promise<TrackingInfo>;
}
