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

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  listingId: string;

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

  @Column({ nullable: true })
  deliveryTrackingNumber?: string;

  /**
   * Adresse de livraison saisie par l'acheteur au paiement (envoi par transporteur). Visible du
   * vendeur seul, transmise au prestataire d'étiquettes, jamais publique. Absente sur les ventes
   * antérieures à la phase 2 des étiquettes : elles suivent le parcours manuel (numéro de suivi saisi).
   */
  @Column({ type: JSON_TYPE, nullable: true })
  shippingAddress?: DeliveryAddress | null;

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

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;

  @UpdateDateColumn({ type: DATE_TYPE })
  updatedAt: Date;
}
