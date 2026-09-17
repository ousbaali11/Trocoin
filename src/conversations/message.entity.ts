import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE, JSON_TYPE } from '../config/db';

export type MessageType = 'text' | 'image' | 'offer' | 'system';
/**
 * Étapes d'une vente inscrites dans la conversation (AUDIT §57) : messages automatiques, jamais écrits par une
 * personne, affichés à part. Le texte montré dépend du rôle du lecteur : il est composé par le site à partir de
 * l'évènement ; `content` en garde une version neutre (aperçu de la boîte de réception, clients anciens).
 */
export type SystemEvent =
  | 'achat_confirme'
  | 'disponibilite_confirmee'
  | 'etiquette_generee'
  | 'expedie'
  | 'pret_pour_remise'
  | 'reception_confirmee'
  | 'remise_validee'
  | 'reception_presumee'
  | 'vente_annulee'
  | 'litige_ouvert'
  | 'litige_resolu';
export type OfferStatus = 'en_attente' | 'acceptee' | 'refusee' | 'retiree';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  conversationId: string;

  @Column()
  senderId: string;

  @Column({ type: 'varchar', default: 'text' })
  type: MessageType;

  @Column({ type: 'text', nullable: true })
  content?: string;

  /** Photo envoyée dans la conversation (/uploads/…), vérifiée par signature. */
  @Column({ nullable: true })
  attachmentUrl?: string;

  /** Proposition de prix (type = 'offer'). */
  @Column({ type: 'float', nullable: true })
  offerAmount?: number;

  @Column({ type: 'varchar', nullable: true })
  offerStatus?: OfferStatus;

  /** Message automatique (type = 'system') : étape de la vente, vente concernée, données d'affichage (suivi…). `senderId` porte l'auteur de l'action. */
  @Column({ type: 'varchar', nullable: true })
  systemEvent?: SystemEvent;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  transactionId?: string;

  @Column({ type: JSON_TYPE, nullable: true })
  meta?: Record<string, string | number | null> | null;

  @Column({ type: DATE_TYPE, nullable: true })
  readAt?: Date;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
