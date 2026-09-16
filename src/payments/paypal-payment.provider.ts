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
 * Second fournisseur de l'architecture interchangeable : PayPal.
 *
 * ÉTAT : implémentation SIMULÉE (aucun appel réseau), sur le même modèle que
 * MockPaymentProvider, sélectionnée par PAYMENT_PROVIDER=paypal. La vraie
 * intégration (PayPal Orders API v2 : create order avec intent=AUTHORIZE,
 * authorize, capture authorization, refund captured payment ; PayPal Commerce
 * Platform pour le versement aux vendeurs) sera branchée quand le compte
 * marchand existera. Les identifiants attendus sont déjà déclarés
 * (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_ENV) pour que la
 * configuration soit stable.
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
