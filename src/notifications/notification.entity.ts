import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

export type NotificationType = 'message' | 'transaction' | 'alerte_recherche' | 'moderation' | 'systeme';

/** Centre de notifications in-app (cahier des charges §3.12). */
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'varchar' })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  body?: string;

  @Column({ nullable: true })
  link?: string;

  @Column({ type: DATE_TYPE, nullable: true })
  readAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
