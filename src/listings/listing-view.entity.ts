import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/** Historique de consultation par utilisateur connecté (une ligne par couple, date mise à jour). */
@Entity('listing_views')
export class ListingView {
  @PrimaryColumn()
  userId: string;

  @PrimaryColumn()
  listingId: string;

  @Index()
  @Column({ type: DATE_TYPE })
  viewedAt: Date;
}
