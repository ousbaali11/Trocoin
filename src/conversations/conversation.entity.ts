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

  @CreateDateColumn()
  createdAt: Date;
}
