import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

@Entity('phone_verifications')
export class PhoneVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  phoneNumber: string;

  @Column()
  codeHash: string;

  @Column({ type: DATE_TYPE })
  expiresAt: Date;

  @Column({ default: 0 })
  attempts: number;

  @Column({ type: DATE_TYPE, nullable: true })
  verifiedAt?: Date;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
