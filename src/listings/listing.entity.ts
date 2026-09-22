import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DATE_TYPE } from '../config/db';

export type ListingStatus =
  | 'brouillon'
  | 'en_attente'
  | 'en_ligne'
  | 'vendue'
  | 'refusee'
  | 'expiree'
  | 'desactivee'
  /** Vente terminée : invisible pour les membres, consultable par l'administration (AUDIT §63). */
  | 'archivee';

export const LISTING_STATUSES: ListingStatus[] = [
  'brouillon', 'en_attente', 'en_ligne', 'vendue', 'refusee', 'expiree', 'desactivee', 'archivee',
];

export type PriceType = 'fixe' | 'negociable' | 'gratuit' | 'echange' | 'sur_demande';
export const PRICE_TYPES: PriceType[] = ['fixe', 'negociable', 'gratuit', 'echange', 'sur_demande'];

export type ListingCondition = 'neuf' | 'tres_bon_etat' | 'bon_etat' | 'etat_satisfaisant' | 'pour_pieces';
export const CONDITIONS: ListingCondition[] = ['neuf', 'tres_bon_etat', 'bon_etat', 'etat_satisfaisant', 'pour_pieces'];

// AUDIT §54 : plus de durée de vie. Une annonce reste en ligne jusqu'à ce que le vendeur la retire ou la marque
// vendue, ou qu'un admin la retire. Le statut « expiree » et la colonne `expiresAt` ne subsistent que pour
// l'historique (anciennes lignes) : plus rien ne les alimente.

@Entity('listings')
@Index(['userId', 'externalRef'], { unique: true, where: '"externalRef" IS NOT NULL' })
export class Listing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Propriétaire (vendeur affiché). Pour une boutique multi-utilisateurs : le compte pro. */
  @Index()
  @Column()
  userId: string;

  /** Compte ayant réellement créé/modifié l'annonce (membre de boutique) ; null = propriétaire. */
  @Column({ nullable: true })
  createdBy?: string;

  @Index()
  @Column()
  categoryId: number;

  /** Famille (catégorie racine) : permet de filtrer "Véhicules" sans jointure. */
  @Index()
  @Column({ nullable: true })
  rootCategoryId?: number;

  @Column({ length: 150 })
  title: string;

  @Column('text')
  description: string;

  @Column({ type: 'float', nullable: true })
  price?: number;

  @Column({ type: 'varchar', default: 'fixe' })
  priceType: PriceType;

  @Column({ type: 'varchar', nullable: true })
  condition?: ListingCondition;

  @Index()
  @Column({ type: 'varchar', default: 'en_ligne' })
  status: ListingStatus;

  /** Motif de mise en attente (pré-modération) ou de refus (admin). */
  @Column({ type: 'text', nullable: true })
  moderationReason?: string;

  // Champs dynamiques par catégorie, validés contre category-schemas.ts.
  @Column({ type: 'simple-json', nullable: true })
  attributes?: Record<string, string | number | boolean>;

  @Column({ nullable: true })
  city?: string;

  @Index()
  @Column({ nullable: true })
  postalCode?: string;

  @Column({ type: 'float', nullable: true })
  latitude?: number;

  @Column({ type: 'float', nullable: true })
  longitude?: number;

  /** Le vendeur accepte d'expédier (Colissimo / Mondial Relay). */
  @Column({ default: false })
  deliveryAvailable: boolean;

  /** Colis déclaré au dépôt (facultatif) : poids en grammes et dimensions en cm, pour la cotation des étiquettes. */
  @Column({ type: 'integer', nullable: true })
  weightGrams?: number | null;

  @Column({ type: 'integer', nullable: true })
  lengthCm?: number | null;

  @Column({ type: 'integer', nullable: true })
  widthCm?: number | null;

  @Column({ type: 'integer', nullable: true })
  heightCm?: number | null;

  @Column({ default: 0 })
  viewsCount: number;

  /** Clics sur « Voir le numéro » (statistique du propriétaire, jamais publique). */
  @Column({ default: 0 })
  phoneClicksCount: number;

  // ----- Mise en avant (gratuite tant que la monétisation est désactivée) -----
  /** Remontée en tête des résultats jusqu'à cette date. */
  @Index()
  @Column({ type: DATE_TYPE, nullable: true })
  boostedUntil?: Date;

  /** Macaron « Urgent » jusqu'à cette date. */
  @Column({ type: DATE_TYPE, nullable: true })
  urgentUntil?: Date;

  /** Référence externe (import de catalogue), unique par vendeur. */
  @Column({ nullable: true })
  externalRef?: string;

  @Column({ type: DATE_TYPE, nullable: true })
  publishedAt?: Date;

  /** Date d'archivage (AUDIT §63) ; l'effacement réel intervient après RetentionService.ARCHIVE_DAYS. */
  @Column({ type: DATE_TYPE, nullable: true })
  archivedAt?: Date | null;

  @Index()
  @Column({ type: DATE_TYPE, nullable: true })
  expiresAt?: Date;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;

  @UpdateDateColumn({ type: DATE_TYPE })
  updatedAt: Date;
}
