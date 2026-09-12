import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

export type SubscriptionStatus = 'active' | 'cancelled' | 'expired';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  planId: string;

  @Column({ type: 'varchar', default: 'active' })
  status: SubscriptionStatus;

  /** Fournisseur ayant encaissé (mock / stripe / paypal) et sa référence. */
  @Column({ nullable: true })
  provider?: string;

  @Column({ nullable: true })
  providerRef?: string;

  @Column({ type: DATE_TYPE })
  startedAt: Date;

  @Column({ type: DATE_TYPE, nullable: true })
  endsAt?: Date;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
