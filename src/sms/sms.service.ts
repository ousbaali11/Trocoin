import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProduction } from '../config/env.validation';

export interface ISmsProvider {
  send(toFrenchE164: string, message: string): Promise<void>;
}

/**
 * Fournisseur de dev : n'envoie rien, journalise le code en console.
 */
class MockSmsProvider implements ISmsProvider {
  private readonly logger = new Logger('SMS(mock)');
  async send(to: string, message: string): Promise<void> {
    this.logger.log(`--> Vers ${to} : ${message}`);
  }
}

/**
 * Point d'extension pour un fournisseur réel (Vonage, Twilio, OVH…).
 * Implémenter ISmsProvider et l'instancier dans SmsService selon SMS_PROVIDER.
 * Exemple Vonage : POST https://rest.nexmo.com/sms/json avec api_key/api_secret.
 */
class UnconfiguredSmsProvider implements ISmsProvider {
  constructor(private name: string) {}
  async send(): Promise<void> {
    throw new Error(
      `Fournisseur SMS "${this.name}" non implémenté : ajoutez une classe ISmsProvider dans src/sms/sms.service.ts.`,
    );
  }
}

@Injectable()
export class SmsService {
  private readonly provider: ISmsProvider;
  private readonly isMock: boolean;
  // Uniquement en mode mock ET hors production : permet à l'interface de
  // test locale de récupérer le dernier code sans lire les logs.
  private lastCodesForDev = new Map<string, string>();

  constructor(private config: ConfigService) {
    const name = this.config.get<string>('SMS_PROVIDER') || 'mock';
    this.isMock = name === 'mock' && !isProduction();
    this.provider = this.isMock ? new MockSmsProvider() : new UnconfiguredSmsProvider(name);
  }

  async sendOtp(toFrenchE164: string, code: string): Promise<void> {
    if (this.isMock) this.lastCodesForDev.set(toFrenchE164, code);
    await this.provider.send(
      toFrenchE164,
      `Votre code de vérification Trocoin est : ${code} (valable 5 minutes).`,
    );
  }

  getLastCodeForDev(toFrenchE164: string): string | undefined {
    if (!this.isMock) return undefined;
    return this.lastCodesForDev.get(toFrenchE164);
  }
}
