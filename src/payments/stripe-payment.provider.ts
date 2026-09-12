import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  CreatePaymentIntentParams,
  IPaymentProvider,
  PaymentIntentResult,
} from './payment-provider.interface';

/**
 * Implémentation réelle via Stripe Connect.
 *
 * Modèle : "destination charges" avec capture manuelle — le paiement est
 * autorisé à la commande (séquestre) puis capturé seulement quand
 * l'acheteur confirme la réception (voir PaymentsService.confirmDelivery).
 * La part plateforme (commission + frais acheteur) est retenue via
 * application_fee_amount ; le reste est transféré au compte Connect du
 * vendeur (créé par StripeConnectService).
 *
 * NON TESTÉ EN CONDITIONS RÉELLES dans cet environnement (pas de clé API,
 * pas d'accès réseau à api.stripe.com) — voir AUDIT.md §5.
 */
@Injectable()
export class StripePaymentProvider implements IPaymentProvider {
  private readonly stripe: Stripe;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      throw new Error(
        'STRIPE_SECRET_KEY manquant : configurez-le dans .env pour utiliser PAYMENT_PROVIDER=stripe.',
      );
    }
    this.stripe = new Stripe(key);
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    const amountCents = Math.round(params.amountEuros * 100);
    const applicationFeeCents = Math.round(params.applicationFeeEuros * 100);

    const intent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      capture_method: 'manual', // autorisation immédiate, capture différée = séquestre
      automatic_payment_methods: { enabled: true },
      metadata: params.metadata,
      ...(params.sellerConnectedAccountId
        ? {
            application_fee_amount: applicationFeeCents,
            transfer_data: { destination: params.sellerConnectedAccountId },
          }
        : {}),
    });

    return {
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret ?? undefined,
      status: intent.status === 'succeeded' ? 'succeeded' : 'processing',
    };
  }

  async capture(providerPaymentId: string) {
    await this.stripe.paymentIntents.capture(providerPaymentId);
    return { status: 'succeeded' as const };
  }

  async refund(providerPaymentId: string) {
    // Une autorisation non capturée est annulée ; un paiement capturé est remboursé.
    const intent = await this.stripe.paymentIntents.retrieve(providerPaymentId);
    if (intent.status === 'requires_capture') {
      await this.stripe.paymentIntents.cancel(providerPaymentId);
    } else {
      await this.stripe.refunds.create({ payment_intent: providerPaymentId, reverse_transfer: true, refund_application_fee: true });
    }
    return { status: 'rembourse' as const };
  }
}
