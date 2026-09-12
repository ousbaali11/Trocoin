import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/**
 * Réglages globaux modifiables depuis le back-office sans redéploiement.
 * Clé/valeur JSON. Exemple : monetization_enabled = false (défaut).
 */
@Entity('system_settings')
export class SystemSetting {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'simple-json' })
  value: unknown;

  @Column({ nullable: true })
  updatedBy?: string;

  @UpdateDateColumn({ type: DATE_TYPE })
  updatedAt: Date;
}
