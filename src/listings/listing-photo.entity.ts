import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

@Entity('listing_photos')
export class ListingPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  listingId: string;

  @Column()
  url: string;

  /** Vignette (480 px de large) pour les listes et miniatures ; null pour les photos importées avant sa mise en place. */
  @Column({ type: 'varchar', nullable: true })
  thumbUrl?: string | null;

  @Column({ default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
