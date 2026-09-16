import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CreatePaymentIntentParams,
  IPaymentProvider,
  PaymentIntentResult,
} from './payment-provider.interface';

/**
 * Simule un séquestre sans appeler de service externe : utile pour développer
 * et tester tout le flux (création -> confirmation -> litige) hors-ligne.
 * Interdit en production (bloqué par validateEnv).
 */
@Injectable()
export class MockPaymentProvider implements IPaymentProvider {
  private readonly logger = new Logger('Paiement(mock)');

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    const providerPaymentId = `mock_pi_${randomUUID()}`;
    this.logger.log(
      `Séquestre simulé de ${params.amountEuros} € (part plateforme ${params.applicationFeeEuros} €, vendeur ${params.sellerConnectedAccountId || 'non connecté'}) réf ${providerPaymentId}`,
    );
    // Comme une carte en ligne chez Stripe : l'autorisation vaut 7 jours (date limite de capture)
    return { providerPaymentId, status: 'requires_capture', captureBefore: new Date(Date.now() + 7 * 86_400_000) };
  }

  async capture(providerPaymentId: string) {
    this.logger.log(`Capture simulée : ${providerPaymentId}`);
    return { status: 'succeeded' as const };
  }

  async refund(providerPaymentId: string) {
    this.logger.log(`Remboursement simulé : ${providerPaymentId}`);
    return { status: 'rembourse' as const };
  }
}
