import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/**
 * Jeton de réinitialisation de mot de passe : valeur aléatoire envoyée par
 * e-mail, seul son hash SHA-256 est stocké. Usage unique, valable 1 heure.
 */
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Column({ type: DATE_TYPE })
  expiresAt: Date;

  @Column({ type: DATE_TYPE, nullable: true })
  usedAt?: Date;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
