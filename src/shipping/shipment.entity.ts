import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DATE_TYPE, JSON_TYPE } from '../config/db';
import { ShippingAddress, ShippingCarrier, ShippingMode } from './shipping-provider.interface';

/**
 * Expédition liée à une vente (une par transaction) : colis déclaré par le vendeur, adresses,
 * transporteur et mode, étiquette achetée chez le prestataire, numéro de suivi.
 *
 *  en_creation     : demande envoyée au prestataire
 *  etiquette_prete : étiquette et numéro de suivi disponibles (le vendeur imprime et dépose le colis)
 *  expediee        : le vendeur a confirmé l'envoi (POST /transactions/:id/ship)
 *  livree          : livraison confirmée par le suivi ou par l'acheteur
 *  echec           : le prestataire a refusé (adresse, indisponibilité…) — le vendeur peut réessayer
 *                    ou saisir un numéro de suivi à la main : la transaction n'est jamais bloquée
 */
export type ShipmentStatus = 'en_creation' | 'etiquette_prete' | 'expediee' | 'livree' | 'echec';

@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  transactionId: string;

  @Column()
  listingId: string;

  @Index()
  @Column()
  sellerId: string;

  @Index()
  @Column()
  buyerId: string;

  /** Nom du fournisseur qui a produit l'étiquette (mock, boxtal…). */
  @Column({ type: 'varchar' })
  provider: string;

  @Column({ type: 'varchar' })
  carrier: ShippingCarrier;

  @Column({ type: 'varchar' })
  mode: ShippingMode;

  @Column({ type: 'varchar', default: 'en_creation' })
  status: ShipmentStatus;

  @Column({ type: 'integer' })
  weightGrams: number;

  @Column({ type: 'integer', nullable: true })
  lengthCm?: number;

  @Column({ type: 'integer', nullable: true })
  widthCm?: number;

  @Column({ type: 'integer', nullable: true })
  heightCm?: number;

  @Column({ type: JSON_TYPE })
  sender: ShippingAddress;

  @Column({ type: JSON_TYPE })
  recipient: ShippingAddress;

  @Column({ type: 'varchar', nullable: true })
  relayPointId?: string;

  @Column({ type: 'varchar', nullable: true })
  offerCode?: string;

  @Column({ type: 'integer', nullable: true })
  priceCents?: number;

  @Column({ type: 'varchar', nullable: true })
  trackingNumber?: string;

  @Column({ type: 'varchar', nullable: true })
  trackingUrl?: string;

  /** URL de l'étiquette chez le prestataire (phase 2) ou PDF conservé en base (simulation, quelques Ko). */
  @Column({ type: 'varchar', nullable: true })
  labelUrl?: string;

  @Column({ type: 'text', nullable: true })
  labelPdfBase64?: string;

  @Column({ type: 'varchar', nullable: true })
  providerRef?: string;

  /** Dernière erreur du prestataire (code + raison), lisible par le vendeur. */
  @Column({ type: 'text', nullable: true })
  error?: string;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;

  @UpdateDateColumn({ type: DATE_TYPE })
  updatedAt: Date;
}
