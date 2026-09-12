import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATE_TYPE } from '../config/db';

export type AccountType = 'particulier' | 'professionnel' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  phoneNumber: string; // format canonique +33[67]XXXXXXXX

  @Column({ default: false })
  phoneVerified: boolean;

  @Column({ nullable: true, unique: true })
  email?: string;

  @Column()
  displayName: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Index()
  @Column({ type: 'varchar', default: 'particulier' })
  accountType: AccountType;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  postalCode?: string;

  @Column({ type: 'float', nullable: true })
  latitude?: number;

  @Column({ type: 'float', nullable: true })
  longitude?: number;

  // ----- Vitrine professionnelle -----
  @Column({ nullable: true })
  shopName?: string;

  @Column({ type: 'text', nullable: true })
  shopDescription?: string;

  @Column({ nullable: true })
  shopLogoUrl?: string;

  @Column({ nullable: true })
  shopAddress?: string;

  @Column({ nullable: true })
  shopHours?: string;

  @Column({ nullable: true })
  shopWebsite?: string;

  @Column({ nullable: true })
  siret?: string;

  // ----- Paiement (Stripe Connect Express) -----
  @Column({ nullable: true })
  stripeAccountId?: string;

  @Column({ default: false })
  stripeOnboardingComplete: boolean;

  // ----- Réputation -----
  @Column({ type: 'float', default: 0 })
  ratingAvg: number;

  @Column({ default: 0 })
  ratingCount: number;

  @Column({ default: false })
  identityVerified: boolean;

  // ----- Préférences de notification (alertes de recherche, messages) -----
  @Column({ default: true })
  notifyPush: boolean;

  @Column({ default: false })
  notifySms: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: DATE_TYPE, nullable: true })
  suspendedAt?: Date;

  @Column({ type: 'text', nullable: true })
  suspensionReason?: string;

  // Suppression RGPD : le compte est anonymisé et désactivé, la ligne est
  // conservée pour l'intégrité des transactions/avis (obligations légales).
  @Column({ type: DATE_TYPE, nullable: true })
  deletedAt?: Date;
}
