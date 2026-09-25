import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { DATE_TYPE } from '../config/db';

/**
 * AUDIT §74 : évènements webhook déjà traités. Le prestataire livre « au moins une fois » : un même évènement peut
 * arriver plusieurs fois (relance, délai réseau). L'identifiant est réclamé AVANT le traitement (clé primaire : deux
 * livraisons simultanées ne passent pas toutes deux), libéré si le traitement échoue (le prestataire relance), et purgé
 * après 30 jours (la fenêtre de relance réelle est de quelques jours).
 */
@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryColumn({ length: 120 })
  id: string;

  @Column({ length: 80 })
  type: string;

  @Index()
  @CreateDateColumn({ type: DATE_TYPE })
  receivedAt: Date;
}
