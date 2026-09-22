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

  /**
   * Numéro affiché sur les annonces (bouton « Voir le numéro », visiteurs connectés) : réglable
   * au dépôt et dans les paramètres. Le numéro lui-même reste celui du compte, unique et réutilisé
   * pour toutes les annonces ; il n'est jamais inscrit dans le HTML public ni dans les cartes.
   */
  @Column({ default: true })
  phonePublic: boolean;

  @Column({ nullable: true, unique: true })
  email?: string;

  /** Adresse e-mail confirmée par le lien reçu à l'inscription (ou renvoyé depuis les paramètres). */
  @Column({ default: false })
  emailVerified: boolean;

  @Column({ type: DATE_TYPE, nullable: true })
  emailVerifiedAt?: Date;

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

  // ----- Double authentification (TOTP, application d'authentification) -----
  /** Second facteur exigé à la connexion (activé depuis les paramètres, facultatif). */
  @Column({ default: false })
  twoFactorEnabled: boolean;

  @Column({ type: DATE_TYPE, nullable: true })
  twoFactorEnabledAt?: Date | null;

  /** Secret TOTP en base32 (en attente tant que twoFactorEnabled est faux). Jamais sérialisé. */
  @Column({ type: 'text', nullable: true, select: false })
  totpSecret?: string | null;

  /** Codes de récupération restants : JSON des hash SHA-256 (chaque code ne sert qu'une fois). */
  @Column({ type: 'text', nullable: true, select: false })
  totpRecoveryCodes?: string | null;

  /** Dernier pas de temps TOTP accepté : un même code ne peut pas être rejoué. */
  @Column({ type: 'integer', nullable: true, select: false })
  totpLastStep?: number | null;

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

  /** Compte de versement (AUDIT §63) : « formulaire » (nom + IBAN saisis sur Trocoin) ou « guide » (parcours du prestataire). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  payoutAccountKind?: 'formulaire' | 'guide' | null;

  /** Quatre derniers caractères de l'IBAN transmis au prestataire (seule trace conservée). */
  @Column({ type: 'varchar', length: 4, nullable: true })
  payoutIbanLast4?: string | null;

  /** Pièces ou informations encore demandées par le prestataire (JSON, codes techniques). */
  @Column({ type: 'text', nullable: true })
  payoutRequirements?: string | null;

  /** Dernier évènement `account.updated` reçu du prestataire pour ce compte (AUDIT §66) : preuve que le webhook « comptes connectés » fonctionne. */
  @Column({ type: DATE_TYPE, nullable: true })
  payoutWebhookAt?: Date | null;

  // ----- Réputation -----
  @Column({ type: 'float', default: 0 })
  ratingAvg: number;

  @Column({ default: 0 })
  ratingCount: number;

  @Column({ default: false })
  identityVerified: boolean;

  /** Compte de démonstration (contenu de lancement, AUDIT §46) : indicateur interne, visible et modifiable par l'admin seulement. */
  @Column({ default: false })
  isDemoAccount: boolean;

  /** Le vendeur ne propose pas le paiement sécurisé sur ses annonces (remise en main propre uniquement) ; réglable par lui-même. */
  @Column({ default: false })
  securePaymentDisabled: boolean;

  // ----- Préférences de notification (alertes de recherche, messages) -----
  @Column({ default: true })
  notifyPush: boolean;

  @Column({ default: false })
  notifySms: boolean;

  /** Préférences granulaires (famille × canal), JSON sérialisé ; null = défauts. Voir notifications/notification-prefs.ts. */
  @Column({ type: 'text', nullable: true })
  notificationPrefs?: string | null;

  /** Dernières localisations utilisées (recherche ou dépôt), JSON sérialisé, 5 au plus, la plus récente en premier. */
  @Column({ type: 'text', nullable: true })
  recentLocations?: string | null;

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
