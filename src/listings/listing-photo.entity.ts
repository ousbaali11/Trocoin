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

  @Column({ default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
