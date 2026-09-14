import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { Notification, NotificationType } from './notification.entity';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

/**
 * Fournisseur de diffusion externe (push / SMS / e-mail). Même schéma que
 * pour le SMS et le paiement : interface + mock + implémentation réelle à
 * brancher (Firebase Cloud Messaging pour le push, le fournisseur SMS pour
 * les évènements critiques).
 */
export interface INotificationProvider {
  push(user: User, payload: NotificationPayload): Promise<void>;
  sms(user: User, text: string): Promise<void>;
}

class MockNotificationProvider implements INotificationProvider {
  private readonly logger = new Logger('Notifications(mock)');
  async push(user: User, payload: NotificationPayload) {
    this.logger.log(`PUSH -> ${user.id} [${payload.type}] ${payload.title} — ${payload.body ?? ''}`);
  }
  async sms(user: User, text: string) {
    this.logger.log(`SMS -> ${user.phoneNumber} : ${text}`);
  }
}

/** NOTIFICATION_PROVIDER=none : notifications in-app uniquement (table notifications), ni push ni SMS. Autorisé en production. */
class NoopNotificationProvider implements INotificationProvider {
  async push(): Promise<void> {}
  async sms(): Promise<void> {}
}

class UnconfiguredNotificationProvider implements INotificationProvider {
  constructor(private name: string) {}
  async push(): Promise<void> {
    throw new Error(`Fournisseur de notifications "${this.name}" non implémenté (src/notifications/notifications.service.ts).`);
  }
  async sms(): Promise<void> {
    throw new Error(`Fournisseur de notifications "${this.name}" non implémenté.`);
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  private readonly provider: INotificationProvider;

  constructor(
    @InjectRepository(Notification) private notificationsRepo: Repository<Notification>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    config: ConfigService,
  ) {
    const name = config.get<string>('NOTIFICATION_PROVIDER') || 'mock';
    this.provider =
      name === 'mock' ? new MockNotificationProvider() : name === 'none' ? new NoopNotificationProvider() : new UnconfiguredNotificationProvider(name);
  }

  /**
   * Enregistre la notification in-app (toujours) et la diffuse selon les
   * préférences de l'utilisateur. Ne fait jamais échouer l'action métier
   * appelante : une erreur de diffusion est journalisée, pas propagée.
   */
  async notify(userId: string, payload: NotificationPayload): Promise<Notification | null> {
    try {
      const user = await this.usersRepo.findOne({ where: { id: userId } });
      if (!user || user.deletedAt) return null;
      const saved = await this.notificationsRepo.save(this.notificationsRepo.create({ userId, ...payload }));
      // Préférences granulaires (famille × canal) : l'in-app est toujours enregistré ci-dessus.
      const prefs = UsersService.prefsOf(user)[payload.type];
      if (prefs.push) await this.provider.push(user, payload).catch((e) => this.logger.warn(`push: ${e.message}`));
      if (prefs.sms) {
        await this.provider.sms(user, `${payload.title} — ${payload.body ?? ''}`).catch((e) => this.logger.warn(`sms: ${e.message}`));
      }
      // prefs.email : canal enregistré, diffusion branchée avec le fournisseur d'e-mail (différé par choix).
      return saved;
    } catch (err) {
      this.logger.error(`Notification impossible pour ${userId}: ${(err as Error).message}`);
      return null;
    }
  }

  listMine(userId: string, limit = 50) {
    return this.notificationsRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit });
  }

  unreadCount(userId: string) {
    return this.notificationsRepo.count({ where: { userId, readAt: IsNull() } });
  }

  async markAllRead(userId: string) {
    await this.notificationsRepo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
    return { ok: true };
  }

  async markRead(userId: string, id: string) {
    await this.notificationsRepo.update({ id, userId }, { readAt: new Date() });
    return { ok: true };
  }
}
