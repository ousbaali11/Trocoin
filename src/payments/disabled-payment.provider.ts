import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IPaymentProvider } from './payment-provider.interface';

export const PAYMENT_DISABLED_MESSAGE =
  "Le paiement sécurisé n'est pas encore disponible sur Trocoin. Réglez la transaction directement avec le vendeur (remise en main propre).";

/**
 * PAYMENT_PROVIDER=disabled : aucun séquestre possible, les endpoints de
 * paiement répondent 503 avec un message clair. C'est le seul mode autorisé en
 * production tant que Stripe (ou PayPal) n'est pas configuré : contrairement
 * au mock, il ne fait jamais croire à un acheteur qu'un paiement a eu lieu.
 */
@Injectable()
export class DisabledPaymentProvider implements IPaymentProvider {
  async createPaymentIntent(): Promise<never> {
    throw new ServiceUnavailableException(PAYMENT_DISABLED_MESSAGE);
  }
  async capture(): Promise<never> {
    throw new ServiceUnavailableException(PAYMENT_DISABLED_MESSAGE);
  }
  async refund(): Promise<never> {
    throw new ServiceUnavailableException(PAYMENT_DISABLED_MESSAGE);
  }
}
