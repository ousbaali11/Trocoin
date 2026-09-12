import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/**
 * Journal d'audit : qui a fait quoi, quand, sur quelle ressource.
 * Écrit pour chaque action admin qui modifie une donnée. Jamais modifié
 * ni supprimé par l'application.
 */
@Entity('admin_audit_log')
export class AdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  adminId: string;

  @Index()
  @Column()
  action: string; // ex : user.suspend, listing.reject, report.resolve, transaction.resolve

  @Column()
  targetType: string; // user | listing | report | transaction

  @Index()
  @Column()
  targetId: string;

  /** Détail sérialisé (champs modifiés, motif) — jamais de données sensibles brutes. */
  @Column({ type: 'simple-json', nullable: true })
  details?: Record<string, unknown>;

  @Column({ nullable: true })
  ip?: string;

  @CreateDateColumn({ type: DATE_TYPE })
  createdAt: Date;
}
