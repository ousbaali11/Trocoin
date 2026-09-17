import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DATE_TYPE, JSON_TYPE } from '../config/db';

/** Adresse postale complète de l'acheteur pour un envoi. */
export interface DeliveryAddress {
  name: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  phone?: string;
}

/** Envoi à domicile ou retrait dans un point choisi par l'acheteur (AUDIT §57). */
export type DeliveryMode = 'domicile' | 'point_relais';
/** Nature d'un point de retrait, telle que le réseau du transporteur la donne (relais commerçant, bureau de poste, consigne automatique). */
export type PickupPointType = 'relais' | 'bureau_poste' | 'consigne';
/** Point de retrait choisi par l'acheteur parmi les points réels renvoyés par le prestataire d'étiquettes. */
export interface ChosenPickupPoint {
  id: string;
  name: string;
  line1: string;
  postalCode: string;
  city: string;
  type: PickupPointType;
}

/**
 * Cycle de vie :
 *  sequestre  : fonds bloqués (autorisation), vendeur doit expédier / remettre
 *  livree     : vendeur a déclaré l'envoi (n° de suivi) ou la remise
 *  confirme   : acheteur a confirmé la réception -> capture, fonds libérés
 *  litige     : l'une des parties a ouvert un litige -> arbitrage admin
 *  rembourse  : remboursement (admin ou annulation avant envoi)
 *  annulee    : annulée avant expédition par le vendeur (refus) ou l'acheteur
 */
export type TransactionStatus =
  | 'en_attente'
  | 'sequestre'
  | 'livree'
  | 'confirme'
  | 'litige'
  | 'rembourse'
  | 'annulee';

export type DeliveryMethod = 'main_propre' | 'colissimo' | 'mondial_relay';

/**
 * Modèle de séquestre (AUDIT §39) :
 *  destination : ancien modèle « destination charge » — capture manuelle à la confirmation, les fonds
 *                partent directement chez le vendeur à la capture ; conservé pour les ventes créées avant
 *                la bascule, qui se terminent avec l'ancienne logique.
 *  platform    : « paiements et transferts distincts » — capture rapide sur le solde de Trocoin (qui
 *                n'expire pas), transfert au vendeur seulement à la confirmation (réception, code de
 *                remise, décision admin, réception présumée) ; remboursement depuis le solde de Trocoin.
 */
export type EscrowModel = 'destination' | 'platform';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  listingId: string;

  /** Titre de l'annonce au moment de la vente : conservé avec la trace comptable si l'annonce est effacée (AUDIT §41). */
  @Column({ type: 'varchar', nullable: true })
  listingTitle?: string | null;

  @Index()
  @Column()
  buyerId: string;

  @Index()
  @Column()
  sellerId: string;

  @Column('float')
  amount: number;

  @Column('float')
  commission: number;

  /** Frais de protection acheteur (inclus dans le montant débité). */
  @Column({ type: 'float', default: 0 })
  buyerFee: number;

  @Index()
  @Column({ type: 'varchar', default: 'en_attente' })
  status: TransactionStatus;

  @Column({ type: 'varchar', default: 'main_propre' })
  deliveryMethod: DeliveryMethod;

  @Column({ nullable: true })
  providerPaymentId?: string;

  /** Moyen de paiement utilisé (Stripe : `card`, `paypal`, …) ; null si inconnu. Rien ne suppose une carte (AUDIT §40). */
  @Column({ type: 'varchar', nullable: true })
  paymentMethod?: string | null;

  @Column({ nullable: true })
  deliveryTrackingNumber?: string;

  /**
   * Adresse de livraison saisie par l'acheteur au paiement (envoi par transporteur). Visible du
   * vendeur seul, transmise au prestataire d'étiquettes, jamais publique. Absente sur les ventes
   * antérieures à la phase 2 des étiquettes : elles suivent le parcours manuel (numéro de suivi saisi).
   */
  @Column({ type: JSON_TYPE, nullable: true })
  shippingAddress?: DeliveryAddress | null;

  /**
   * Mode d'envoi choisi par l'acheteur au paiement (AUDIT §57) : domicile ou point de retrait. Nul sur les ventes
   * antérieures (le vendeur choisissait le mode à l'achat de l'étiquette) et pour une remise en main propre.
   */
  @Column({ type: 'varchar', nullable: true })
  deliveryMode?: DeliveryMode | null;

  /** Point de retrait choisi par l'acheteur (relais, bureau de poste ou consigne) : repris tel quel pour l'étiquette. */
  @Column({ type: JSON_TYPE, nullable: true })
  pickupPoint?: ChosenPickupPoint | null;

  /** Le vendeur a confirmé que l'article existe et est prêt à partir (AUDIT §57) ; l'expédition vaut confirmation. */
  @Column({ type: DATE_TYPE, nullable: true })
  sellerConfirmedAt?: Date | null;

  /**
   * Barème appliqué à CETTE vente, figé à sa création (AUDIT §51) : un changement de commission ou de frais par
   * l'admin ne touche jamais une transaction existante. Nul pour les ventes antérieures (barème 8 % / 5 % + 0,50 €).
   */
  @Column({ type: JSON_TYPE, nullable: true })
  feeRates?: { commissionPercent: number; buyerFeePercent: number; buyerFeeFixed: number; buyerFeeCap: number } | null;

  /** Code de remise en main propre (l'acheteur le donne au vendeur au RDV). */
  @Column({ nullable: true })
  handoverCode?: string;

  @Column({ type: 'text', nullable: true })
  disputeReason?: string;

  @Column({ nullable: true })
  disputeOpenedBy?: string;

  @Column({ type: 'text', nullable: true })
  resolutionNote?: string;

  @Column({ type: DATE_TYPE, nullable: true })
  shippedAt?: Date;

  @Column({ type: DATE_TYPE, nullable: true })
  confirmedAt?: Date;

  @Column({ type: DATE_TYPE, nullable: true })
  resolvedAt?: Date;

  // ----- Échéances du séquestre (AUDIT §37) : une autorisation de carte non capturée expire (7 jours
  // en ligne, 5 pour Visa initiée par le marchand, 30 seulement avec une autorisation prolongée). -----
  /** Autorisation obtenue = entrée en séquestre. */
  @Column({ type: DATE_TYPE, nullable: true })
  paidAt?: Date;

  /** Date limite de capture donnée par le fournisseur (Stripe : `capture_before` du paiement) ou estimée prudemment. */
  @Column({ type: DATE_TYPE, nullable: true })
  captureBefore?: Date;

  /** Réception présumée : date à laquelle la réception sera considérée acquise sans action de l'acheteur (annoncée à l'avance). */
  @Column({ type: DATE_TYPE, nullable: true })
  autoConfirmAt?: Date;

  /** Rappels d'échéance déjà envoyés : 0 aucun, 1 rappel, 2 dernier avis (24 h avant l'action automatique). */
  @Column({ default: 0 })
  escrowStage: number;

  /** Action automatique appliquée : reception_presumee, capture_echeance, annulation_echeance. */
  @Column({ nullable: true })
  autoResolution?: string;

  /** Après une capture automatique, l'acheteur peut encore ouvrir un litige jusqu'à cette date. */
  @Column({ type: DATE_TYPE, nullable: true })
  disputeAllowedUntil?: Date;

  // ----- Séquestre sur le solde de la plateforme (AUDIT §39) -----
  /** Modèle de séquestre de cette vente ; les ventes antérieures à la bascule restent en « destination ». */
  @Index()
  @Column({ type: 'varchar', default: 'platform' })
  escrowModel: EscrowModel;

  /** Fonds encaissés sur le solde de Trocoin (modèle platform) : plus aucune expiration possible. */
  @Column({ type: DATE_TYPE, nullable: true })
  capturedAt?: Date;

  /** Modèle platform : le vendeur doit avoir expédié (ou saisi le code de remise) avant cette date, sinon annulation et remboursement. */
  @Column({ type: DATE_TYPE, nullable: true })
  shipBy?: Date;

  /** Virement Stripe (Transfer) du solde de Trocoin vers le compte du vendeur, créé à la confirmation ; remis à null si le virement est annulé (remboursement). */
  @Column({ type: 'varchar', nullable: true })
  transferId?: string | null;

  @Column({ type: DATE_TYPE, nullable: true })
  transferredAt?: Date | null;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;

  @UpdateDateColumn({ type: DATE_TYPE })
  updatedAt: Date;
}
