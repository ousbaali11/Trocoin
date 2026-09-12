import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

export type ReportStatus = 'ouvert' | 'traite' | 'rejete';

export const REPORT_REASONS = [
  'arnaque',
  'contrefacon',
  'objet_interdit',
  'mauvaise_categorie',
  'doublon',
  'annonce_mensongere',
  'contenu_offensant',
  'coordonnees_dans_annonce',
  'harcelement',
  'autre',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  reporterId: string;

  @Index()
  @Column({ nullable: true })
  listingId?: string;

  @Index()
  @Column({ nullable: true })
  reportedUserId?: string;

  @Column({ nullable: true })
  conversationId?: string;

  @Column({ type: 'varchar' })
  reason: ReportReason;

  @Column({ type: 'text', nullable: true })
  details?: string;

  @Index()
  @Column({ type: 'varchar', default: 'ouvert' })
  status: ReportStatus;

  @Column({ nullable: true })
  handledBy?: string;

  @Column({ type: 'text', nullable: true })
  resolutionNote?: string;

  @Column({ type: DATE_TYPE, nullable: true })
  handledAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
