import type { NotificationType } from './notification.entity';

/**
 * Préférences de notification granulaires : pour chaque famille d'évènement,
 * l'utilisateur choisit les canaux. La notification in-app est toujours
 * enregistrée (c'est le journal du compte) ; push, SMS et e-mail sont des
 * canaux de diffusion optionnels.
 *
 *  - `push`  : diffusion par le fournisseur de notifications (mock/none en bêta) ;
 *  - `sms`   : réservé aux évènements critiques (transaction, modération) ;
 *  - `email` : préférence enregistrée dès maintenant, envoi effectif seulement
 *              quand un fournisseur d'e-mail sera activé (décision différée).
 */
export type NotificationChannel = 'push' | 'sms' | 'email';
export type NotificationPrefs = Record<NotificationType, Record<NotificationChannel, boolean>>;

export const NOTIFICATION_TYPES: NotificationType[] = ['message', 'transaction', 'alerte_recherche', 'moderation', 'systeme'];
export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['push', 'sms', 'email'];

/** Familles pour lesquelles le SMS a un sens (coût réel, évènements critiques uniquement). */
export const SMS_ALLOWED_TYPES: NotificationType[] = ['transaction', 'moderation'];

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  message: { push: true, sms: false, email: true },
  transaction: { push: true, sms: false, email: true },
  alerte_recherche: { push: true, sms: false, email: true },
  moderation: { push: true, sms: false, email: true },
  systeme: { push: true, sms: false, email: false },
};

/**
 * Préférences effectives : défauts, puis valeurs enregistrées, puis les
 * interrupteurs globaux historiques (`notifyPush` / `notifySms`) qui coupent
 * tout un canal d'un coup.
 */
export function effectivePrefs(stored: Partial<NotificationPrefs> | null | undefined, globals: { notifyPush: boolean; notifySms: boolean }): NotificationPrefs {
  const out = {} as NotificationPrefs;
  for (const type of NOTIFICATION_TYPES) {
    const base = { ...DEFAULT_NOTIFICATION_PREFS[type], ...(stored?.[type] ?? {}) };
    out[type] = {
      push: globals.notifyPush && base.push === true,
      sms: globals.notifySms && SMS_ALLOWED_TYPES.includes(type) && base.sms === true,
      email: base.email === true,
    };
  }
  return out;
}

/** Validation stricte du JSON reçu : uniquement les familles et canaux connus, valeurs booléennes. */
export function sanitizePrefs(input: unknown): Partial<NotificationPrefs> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Préférences invalides.');
  const out: Partial<NotificationPrefs> = {};
  for (const [type, channels] of Object.entries(input as Record<string, unknown>)) {
    if (!NOTIFICATION_TYPES.includes(type as NotificationType)) throw new Error(`Famille de notification inconnue : ${type}.`);
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw new Error(`Canaux invalides pour ${type}.`);
    const entry = { ...DEFAULT_NOTIFICATION_PREFS[type as NotificationType] };
    for (const [channel, value] of Object.entries(channels as Record<string, unknown>)) {
      if (!NOTIFICATION_CHANNELS.includes(channel as NotificationChannel)) throw new Error(`Canal inconnu : ${channel}.`);
      if (typeof value !== 'boolean') throw new Error(`La valeur de ${type}.${channel} doit être un booléen.`);
      entry[channel as NotificationChannel] = value;
    }
    out[type as NotificationType] = entry;
  }
  return out;
}
