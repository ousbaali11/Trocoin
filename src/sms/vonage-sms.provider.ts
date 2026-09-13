import { Logger } from '@nestjs/common';
import { ISmsProvider, SmsDeliveryError } from './sms-provider';

/**
 * Vonage (ex-Nexmo) SMS API — https://developer.vonage.com/en/messaging/sms/overview
 *
 * Variables : SMS_PROVIDER=vonage, VONAGE_API_KEY, VONAGE_API_SECRET, SMS_SENDER
 * (expéditeur alphanumérique ≤ 11 caractères, ex. « Trocoin », autorisé en France).
 *
 * Chaque statut d'erreur renvoyé par Vonage est traduit en SmsDeliveryError
 * explicite (numéro invalide, crédit épuisé, identifiants, numéro non
 * autorisé sur compte d'essai…) : le service OTP annule alors la demande de
 * code et l'utilisateur reçoit un 503, jamais un faux succès.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface VonageMessage {
  to?: string;
  'message-id'?: string;
  status: string;
  'error-text'?: string;
  'remaining-balance'?: string;
  'message-price'?: string;
  network?: string;
}

const VONAGE_STATUS: Record<string, string> = {
  '1': 'débit trop élevé (throttled), réessayer plus tard',
  '2': 'paramètres manquants',
  '3': 'paramètres invalides',
  '4': 'identifiants Vonage invalides (VONAGE_API_KEY / VONAGE_API_SECRET)',
  '5': 'erreur interne Vonage',
  '6': 'message invalide',
  '7': 'numéro bloqué par Vonage',
  '8': 'compte Vonage bloqué',
  '9': 'crédit Vonage insuffisant',
  '11': 'compte non activé pour l’API HTTP',
  '12': 'message trop long',
  '14': 'signature invalide',
  '15': 'expéditeur (SMS_SENDER) refusé pour cette destination',
  '22': 'code réseau invalide',
  '29': 'destination non autorisée : compte d’essai Vonage, ajouter le numéro à la liste blanche (Dashboard → Test numbers) ou créditer le compte',
  '32': 'méthode d’authentification refusée pour ce compte',
  '33': 'numéro désactivé',
};

export class VonageSmsProvider implements ISmsProvider {
  private readonly logger = new Logger('SMS(vonage)');
  static readonly ENDPOINT = 'https://rest.nexmo.com/sms/json';

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly sender: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly timeoutMs = 8_000,
  ) {
    if (!apiKey || !apiSecret || !sender) {
      throw new Error('VonageSmsProvider : VONAGE_API_KEY, VONAGE_API_SECRET et SMS_SENDER sont requis.');
    }
  }

  async send(toFrenchE164: string, message: string): Promise<void> {
    if (!/^\+33[67]\d{8}$/.test(toFrenchE164)) {
      throw new SmsDeliveryError('vonage', `numéro refusé (mobile français attendu) : ${toFrenchE164.slice(0, 6)}…`);
    }
    const body = new URLSearchParams({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      from: this.sender,
      to: toFrenchE164.slice(1), // E.164 sans le « + »
      text: message,
      // Français avec accents : l'alphabet GSM-7 couvre é/è/à ; on force unicode
      // uniquement si un caractère hors GSM-7 est présent.
      ...(needsUnicode(message) ? { type: 'unicode' } : {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(VonageSmsProvider.ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error;
      throw new SmsDeliveryError('vonage', e.name === 'AbortError' ? `aucune réponse en ${this.timeoutMs} ms` : `réseau : ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new SmsDeliveryError('vonage', `HTTP ${res.status}`);

    let payload: { messages?: VonageMessage[] };
    try {
      payload = (await res.json()) as { messages?: VonageMessage[] };
    } catch {
      throw new SmsDeliveryError('vonage', 'réponse illisible');
    }
    const msg = payload.messages?.[0];
    if (!msg) throw new SmsDeliveryError('vonage', 'réponse sans message');
    if (msg.status !== '0') {
      const known = VONAGE_STATUS[msg.status];
      throw new SmsDeliveryError('vonage', `statut ${msg.status} : ${known ?? msg['error-text'] ?? 'erreur inconnue'}`);
    }
    this.logger.log(
      `SMS accepté par Vonage (id ${msg['message-id']}, réseau ${msg.network ?? '?'}, coût ${msg['message-price'] ?? '?'} €, solde ${msg['remaining-balance'] ?? '?'} €)`,
    );
  }
}

/** Alphabet GSM-7 de base (suffisant pour le message OTP en français). */
const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n\r^{}\\\[~\]|€]*$/;
function needsUnicode(text: string): boolean {
  return !GSM7.test(text);
}
