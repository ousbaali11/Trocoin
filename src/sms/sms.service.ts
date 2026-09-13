import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProduction } from '../config/env.validation';
import { ISmsProvider, SmsDeliveryError } from './sms-provider';
import { VonageSmsProvider } from './vonage-sms.provider';

export { ISmsProvider, SmsDeliveryError } from './sms-provider';

/** Fournisseur de dev : n'envoie rien, journalise le code en console. */
class MockSmsProvider implements ISmsProvider {
  private readonly logger = new Logger('SMS(mock)');
  async send(to: string, message: string): Promise<void> {
    // SMS_MOCK_FAIL=true simule une panne opérateur (tests de robustesse)
    if (process.env.SMS_MOCK_FAIL === 'true') throw new SmsDeliveryError('mock', 'panne simulée');
    this.logger.log(`--> Vers ${to} : ${message}`);
  }
}

/**
 * Fournisseurs :
 *   SMS_PROVIDER=vonage  + VONAGE_API_KEY, VONAGE_API_SECRET, SMS_SENDER → VonageSmsProvider (implémenté, testé en réel)
 *   SMS_PROVIDER=twilio  + TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM → NON implémenté
 *     (aucun identifiant Twilio disponible pour le tester ; voir AUDIT.md §8.1)
 * Un fournisseur non implémenté ou sans identifiants refuse explicitement
 * l'envoi : jamais d'échec silencieux.
 */
class UnconfiguredSmsProvider implements ISmsProvider {
  constructor(private name: string) {}
  async send(): Promise<void> {
    throw new SmsDeliveryError(this.name, 'fournisseur non implémenté / identifiants absents');
  }
}

function buildProvider(name: string, config: ConfigService): ISmsProvider {
  if (name === 'vonage') {
    return new VonageSmsProvider(
      config.get<string>('VONAGE_API_KEY') || '',
      config.get<string>('VONAGE_API_SECRET') || '',
      config.get<string>('SMS_SENDER') || '',
    );
  }
  return new UnconfiguredSmsProvider(name);
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger('SMS');
  private readonly provider: ISmsProvider;
  readonly providerName: string;
  private readonly isMock: boolean;
  private lastCodesForDev = new Map<string, string>();

  constructor(private config: ConfigService) {
    this.providerName = this.config.get<string>('SMS_PROVIDER') || 'mock';
    this.isMock = this.providerName === 'mock' && !isProduction();
    this.provider = this.isMock ? new MockSmsProvider() : buildProvider(this.providerName, this.config);
  }

  /**
   * Envoie le code. Toute erreur (opérateur, crédit, timeout, fournisseur
   * absent) est convertie en SmsDeliveryError : l'appelant doit annuler la
   * demande de code pour que l'utilisateur puisse réessayer sans attendre.
   */
  async sendOtp(toFrenchE164: string, code: string): Promise<void> {
    const text = `Votre code de vérification Trocoin est : ${code} (valable 5 minutes).`;
    try {
      await withTimeout(this.provider.send(toFrenchE164, text), 10_000);
    } catch (err) {
      const reason = err instanceof SmsDeliveryError ? err.reason : (err as Error).message;
      this.logger.error(`Envoi OTP impossible vers ${toFrenchE164.slice(0, 6)}… via ${this.providerName} : ${reason}`);
      throw new ServiceUnavailableException(
        "L'envoi du SMS a échoué. Vérifiez votre numéro et réessayez dans quelques instants.",
      );
    }
    if (this.isMock) this.lastCodesForDev.set(toFrenchE164, code);
  }

  getLastCodeForDev(toFrenchE164: string): string | undefined {
    if (!this.isMock) return undefined;
    return this.lastCodesForDev.get(toFrenchE164);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new SmsDeliveryError('timeout', `aucune réponse en ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
