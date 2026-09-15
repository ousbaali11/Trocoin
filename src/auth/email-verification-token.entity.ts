import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/**
 * Jeton de confirmation d'adresse e-mail : valeur aléatoire (32 octets) envoyée par e-mail,
 * seul son hash SHA-256 est stocké. Usage unique, valable 24 heures. Émis à l'inscription et
 * sur demande depuis les paramètres du compte (limité en fréquence).
 */
@Entity('email_verification_tokens')
export class EmailVerificationToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  /** Adresse visée par le jeton : si l'utilisateur change d'adresse, l'ancien lien ne confirme rien. */
  @Column()
  email: string;

  @Column({ type: DATE_TYPE })
  expiresAt: Date;

  @Column({ type: DATE_TYPE, nullable: true })
  usedAt?: Date;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
