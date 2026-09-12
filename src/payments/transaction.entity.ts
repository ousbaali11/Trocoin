import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

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
