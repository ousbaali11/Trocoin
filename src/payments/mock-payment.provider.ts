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
    return { providerPaymentId, status: 'requires_capture' };
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
