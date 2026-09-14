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

  // ----- Identité (inscription par formulaire, phase 5). Nullable : les comptes
  // créés par OTP avant cette phase n'ont pas ces champs. -----
  @Column({ nullable: true })
  firstName?: string;

  @Column({ nullable: true })
  lastName?: string;

  /** Identifiant public unique (connexion possible avec l'e-mail ou l'username). */
  @Column({ nullable: true, unique: true })
  username?: string;

  /** Hash scrypt (src/auth/password.ts). select:false : jamais chargé par défaut, donc jamais sérialisé. */
  @Column({ nullable: true, select: false })
  passwordHash?: string;

  /** Raison sociale (compte professionnel). */
  @Column({ nullable: true })
  companyName?: string;

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

  /** SIRET confirmé actif au registre public des entreprises (recherche-entreprises.api.gouv.fr). */
  @Column({ default: false })
  siretVerified: boolean;

  @Column({ type: DATE_TYPE, nullable: true })
  siretVerifiedAt?: Date;

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

  /** Préférences granulaires (famille × canal), JSON sérialisé ; null = défauts. Voir notifications/notification-prefs.ts. */
  @Column({ type: 'text', nullable: true })
  notificationPrefs?: string | null;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;

  @UpdateDateColumn({ type: DATE_TYPE })
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
