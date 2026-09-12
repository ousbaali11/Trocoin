import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/**
 * CMS minimal : pages légales et d'aide modifiables depuis le back-office
 * (CGU, confidentialité, mentions légales, à propos). Contenu en Markdown
 * simplifié (titres #, listes -, gras **), rendu côté front.
 */
@Entity('legal_pages')
export class LegalPage {
  @PrimaryColumn()
  slug: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ default: true })
  published: boolean;

  @Column({ nullable: true })
  updatedBy?: string;

  @UpdateDateColumn({ type: DATE_TYPE })
  updatedAt: Date;
}
