import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/**
 * Jeton de rafraîchissement, stocké HACHÉ (sha256). Rotation à chaque usage :
 * l'ancien est marqué remplacé ; une réutilisation d'un jeton déjà tourné
 * révoque toute la famille (détection de vol).
 */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  /** Identifiant de famille (une connexion = une famille). */
  @Index()
  @Column()
  familyId: string;

  @Column({ type: DATE_TYPE })
  expiresAt: Date;

  @Column({ type: DATE_TYPE, nullable: true })
  revokedAt?: Date;

  @Column({ nullable: true })
  replacedById?: string;

  @Column({ nullable: true })
  userAgent?: string;

  @Column({ nullable: true })
  ip?: string;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
