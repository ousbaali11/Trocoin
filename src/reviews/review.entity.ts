import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DATE_TYPE } from '../config/db';

@Entity('reviews')
@Index('UQ_reviews_transaction_reviewer', ['transactionId', 'reviewerId'], { unique: true }) // AUDIT §73 : un avis par membre et par vente
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
