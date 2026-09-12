import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DATE_TYPE } from '../config/db';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  transactionId: string;

  @Column()
  reviewerId: string;

  @Column()
  reviewedId: string;

  @Column('int')
  rating: number; // 1 à 5

  @Column({ type: 'text', nullable: true })
  comment?: string;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
