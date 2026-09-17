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

  /**
   * Photo verrouillée (AUDIT §54, anti-fraude) : elle faisait partie de l'annonce au moment de sa publication. Le
   * vendeur ne peut plus la retirer, la remplacer ni la déplacer ; seul un admin peut la retirer. Nul : photo d'un
   * brouillon, ou photo ajoutée après la publication (retirable, toujours placée après les photos verrouillées).
   */
  @Column({ type: DATE_TYPE, nullable: true })
  lockedAt?: Date | null;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
