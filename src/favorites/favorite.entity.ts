import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

@Entity('favorites')
export class Favorite {
  @PrimaryColumn()
  userId: string;

  @PrimaryColumn()
  listingId: string;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
