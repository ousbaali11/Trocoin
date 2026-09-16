import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  CreatePaymentIntentParams,
  IPaymentProvider,
  PaymentIntentResult,
  TransferParams,
} from './payment-provider.interface';

/**
 * Fournisseur PayPal EN DIRECT (option « Commerce Platform », docs/paypal-integration.md) : NON RETENU.
 *
 * Décision (AUDIT §40) : PayPal est proposé **à travers Stripe**, comme moyen de paiement
 * supplémentaire de la session Stripe Checkout existante (même séquestre, même virement Connect) ;
 * rien ici n'est utilisé pour cela et aucun identifiant PayPal n'est nécessaire. Cette classe reste
 * une implémentation SIMULÉE (aucun appel réseau, même modèle que MockPaymentProvider,
 * PAYMENT_PROVIDER=paypal) au cas où l'option Commerce Platform (Orders API v2 intent=AUTHORIZE,
 * versement aux vendeurs onboardés) serait retenue plus tard ; les variables PAYPAL_CLIENT_ID /
 * PAYPAL_CLIENT_SECRET / PAYPAL_ENV restent déclarées mais inutilisées.
 */
@Injectable()
export class PaypalPaymentProvider implements IPaymentProvider {
  private readonly logger = new Logger('Paiement(paypal-simulé)');
  readonly mode: 'sandbox' | 'live';

  constructor(config: ConfigService) {
    this.mode = (config.get<string>('PAYPAL_ENV') as 'sandbox' | 'live') || 'sandbox';
    if (!config.get('PAYPAL_CLIENT_ID')) {
      this.logger.warn('PAYPAL_CLIENT_ID absent : fournisseur PayPal en mode simulé (aucun appel réseau).');
    }
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    const providerPaymentId = `paypal_auth_${randomUUID()}`;
    this.logger.log(`Autorisation PayPal simulée de ${params.amountEuros} € (part plateforme ${params.applicationFeeEuros} €) réf ${providerPaymentId}`);
    return { providerPaymentId, status: 'requires_capture' };
  }

  async capture(providerPaymentId: string) {
    this.logger.log(`Capture PayPal simulée : ${providerPaymentId}`);
    return { status: 'succeeded' as const };
  }

  async refund(providerPaymentId: string) {
    this.logger.log(`Remboursement PayPal simulé : ${providerPaymentId}`);
    return { status: 'rembourse' as const };
  }

  async transfer(params: TransferParams) {
    const transferId = `paypal_payout_${randomUUID()}`;
    this.logger.log(`Versement PayPal simulé de ${params.amountEuros} € au vendeur ${params.sellerConnectedAccountId} réf ${transferId}`);
    return { transferId };
  }

  async reverseTransfer(transferId: string) {
    this.logger.log(`Annulation de versement PayPal simulée : ${transferId}`);
  }
}
