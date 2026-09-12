import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

export type MessageType = 'text' | 'image' | 'offer';
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

  @Column({ type: DATE_TYPE, nullable: true })
  readAt?: Date;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
