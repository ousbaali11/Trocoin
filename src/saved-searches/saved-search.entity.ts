import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

export interface SavedSearchQuery {
  q?: string;
  category?: string;
  city?: string;
  postal_code?: string;
  price_min?: number;
  price_max?: number;
  condition?: string[];
  delivery?: boolean;
  seller_type?: 'particulier' | 'professionnel';
  /** « Suivre ce vendeur » : alerte sur les nouvelles annonces d'un vendeur donné */
  seller?: string;
  lat?: number;
  lng?: number;
  radius?: number;
}

@Entity('saved_searches')
export class SavedSearch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'simple-json' })
  query: SavedSearchQuery;

  @Column({ default: true })
  notifyPush: boolean;

  @Column({ default: false })
  notifySms: boolean;

  /** Dernière annonce déjà signalée : on ne notifie que les plus récentes. */
  @Column({ type: DATE_TYPE, nullable: true })
  lastCheckedAt?: Date;

  @Column({ default: 0 })
  matchesNotified: number;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
