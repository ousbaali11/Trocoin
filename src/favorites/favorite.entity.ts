import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('favorites')
export class Favorite {
  @PrimaryColumn()
  userId: string;

  @PrimaryColumn()
  listingId: string;

  @CreateDateColumn()
  createdAt: Date;
}
