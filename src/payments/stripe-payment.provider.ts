import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  CheckoutResult,
  CheckoutSync,
  CreateCheckoutParams,
  CreatePaymentIntentParams,
  IPaymentProvider,
  PaymentIntentResult,
  PaymentWebhookEvent,
} from './payment-provider.interface';

import { CHECKOUT_TTL_MINUTES } from './payments.constants';

/**
 * Implémentation réelle via Stripe (Checkout hébergé + Connect).
 *
 * Modèle : « destination charges » avec capture manuelle. L'acheteur paie sur la page Stripe
 * Checkout (aucune clé publiable ni formulaire de carte côté front) ; le montant est seulement
 * AUTORISÉ (séquestre) puis capturé quand l'acheteur confirme la réception (PaymentsService).
 * La part plateforme (commission + frais acheteur) est retenue via application_fee_amount,
 * le reste est transféré au compte Connect du vendeur (StripeConnectService) quand il existe ;
 * sinon la plateforme encaisse et reverse manuellement.
 *
 * Webhook : POST /transactions/webhook/stripe, signature vérifiée avec STRIPE_WEBHOOK_SECRET
 * (constructEvent). Évènements utiles : checkout.session.completed / expired,
 * payment_intent.canceled, charge.refunded. Le retour de l'acheteur (success_url) déclenche
 * aussi une relecture directe de la session : le webhook n'est pas un point de défaillance unique.
 *
 * Testé le 14 septembre 2026 en mode test (clé sk_test) : session créée, paiement par carte de
 * test 4242, autorisation en attente de capture, capture à la confirmation, annulation → PaymentIntent
 * annulé (AUDIT.md §15).
 */
@Injectable()
export class StripePaymentProvider implements IPaymentProvider {
  private readonly stripe: Stripe;
  private readonly webhookSecret?: string;
  private readonly logger = new Logger('Paiement(stripe)');

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY manquant : configurez-le dans .env pour utiliser PAYMENT_PROVIDER=stripe.');
    }
    this.stripe = new Stripe(key);
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') || undefined;
    this.logger.log(`Stripe ${key.startsWith('sk_test_') ? 'MODE TEST' : 'mode réel'} · webhook ${this.webhookSecret ? 'signé' : 'NON configuré (STRIPE_WEBHOOK_SECRET absent)'}`);
  }

  private toCents(euros: number): number {
    return Math.round(euros * 100);
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: this.toCents(params.amountEuros),
      currency: 'eur',
      capture_method: 'manual', // autorisation immédiate, capture différée = séquestre
      automatic_payment_methods: { enabled: true },
      metadata: params.metadata,
      ...(params.sellerConnectedAccountId
        ? { application_fee_amount: this.toCents(params.applicationFeeEuros), transfer_data: { destination: params.sellerConnectedAccountId } }
        : {}),
    });
    return {
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret ?? undefined,
      status: intent.status === 'succeeded' ? 'succeeded' : intent.status === 'requires_capture' ? 'requires_capture' : 'processing',
    };
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_MINUTES * 60;
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      client_reference_id: params.transactionId,
      customer_email: params.buyerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'eur', unit_amount: this.toCents(params.amountEuros), product_data: { name: params.title.slice(0, 120) } },
        },
      ],
      payment_intent_data: {
        capture_method: 'manual',
        metadata: params.metadata,
        ...(params.sellerConnectedAccountId
          ? { application_fee_amount: this.toCents(params.applicationFeeEuros), transfer_data: { destination: params.sellerConnectedAccountId } }
          : {}),
      },
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      expires_at: expiresAt,
    });
    if (!session.url) throw new Error('Stripe n\'a pas renvoyé d\'URL de paiement.');
    return { providerSessionId: session.id, checkoutUrl: session.url, expiresAt: new Date(expiresAt * 1000) };
  }

  async syncCheckout(providerSessionId: string): Promise<CheckoutSync> {
    const session = await this.stripe.checkout.sessions.retrieve(providerSessionId, { expand: ['payment_intent'] });
    const intent = session.payment_intent as Stripe.PaymentIntent | null;
    if (intent && (intent.status === 'requires_capture' || intent.status === 'succeeded')) {
      return { status: 'sequestre', providerPaymentId: intent.id };
    }
    if (session.status === 'expired' || intent?.status === 'canceled') return { status: 'annulee', providerPaymentId: intent?.id };
    return { status: 'en_attente', checkoutUrl: session.url ?? undefined };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentWebhookEvent {
    if (!this.webhookSecret) throw new BadRequestException('Webhook Stripe non configuré (STRIPE_WEBHOOK_SECRET).');
    if (!signature) throw new BadRequestException('En-tête stripe-signature absent.');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (e) {
      throw new BadRequestException(`Signature Stripe invalide : ${(e as Error).message}`);
    }
    const base = { id: event.id, raw: event.type };
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object as Stripe.Checkout.Session;
        return { ...base, type: 'checkout_completed', providerSessionId: s.id, transactionId: s.client_reference_id ?? undefined };
      }
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const s = event.data.object as Stripe.Checkout.Session;
        return { ...base, type: 'checkout_expired', providerSessionId: s.id, transactionId: s.client_reference_id ?? undefined };
      }
      case 'payment_intent.canceled': {
        const pi = event.data.object as Stripe.PaymentIntent;
        return { ...base, type: 'payment_canceled', providerPaymentId: pi.id };
      }
      case 'charge.refunded': {
        const ch = event.data.object as Stripe.Charge;
        return { ...base, type: 'payment_refunded', providerPaymentId: typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id };
      }
      default:
        return { ...base, type: 'ignored' };
    }
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
    } else if (intent.status === 'succeeded') {
      await this.stripe.refunds.create({ payment_intent: providerPaymentId, ...(intent.transfer_data ? { reverse_transfer: true, refund_application_fee: true } : {}) });
    }
    return { status: 'rembourse' as const };
  }
}
