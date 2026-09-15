import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

@Entity('conversations')
@Index(['listingId', 'buyerId'], { unique: true })
export class Conversation {
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

  /** Date du dernier message : tri de la boîte de réception. */
  @Column({ type: DATE_TYPE, nullable: true })
  lastMessageAt?: Date;

  /**
   * « Suppression » par un participant = masquage pour lui seul : la conversation disparaît de
   * sa boîte de réception et de ses compteurs, mais les messages restent pour l'autre
   * participant (et pour la modération / les litiges, comme les autres données de transaction).
   * Elle réapparaît si l'autre participant écrit à nouveau. Rien n'est effacé en base.
   */
  @Column({ type: DATE_TYPE, nullable: true })
  hiddenForBuyerAt?: Date | null;

  @Column({ type: DATE_TYPE, nullable: true })
  hiddenForSellerAt?: Date | null;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
