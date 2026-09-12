import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Formules professionnelles. Les limites ne s'appliquent QUE si la
 * monétisation est activée (SystemSetting monetization_enabled = true) ;
 * sinon tout le monde bénéficie d'un accès illimité et gratuit.
 */
@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /** Prix mensuel TTC en euros (0 = gratuit). */
  @Column({ type: 'float', default: 0 })
  priceMonthly: number;

  /** Annonces simultanément en ligne incluses (null = illimité). */
  @Column({ type: 'int', nullable: true })
  listingsIncluded?: number | null;

  /** Mises en avant (boost / urgent) incluses par mois (null = illimité). */
  @Column({ type: 'int', nullable: true })
  boostsIncluded?: number | null;

  @Column({ default: false })
  advancedStats: boolean;

  @Column({ default: false })
  verifiedBadge: boolean;

  @Column({ default: false })
  customShop: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
