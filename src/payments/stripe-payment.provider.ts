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
  TransferParams,
} from './payment-provider.interface';

import { CHECKOUT_TTL_MINUTES } from './payments.constants';

/**
 * Implémentation réelle via Stripe (Checkout hébergé + Connect).
 *
 * Modèle (AUDIT §39) : « paiements et transferts distincts » avec capture manuelle. L'acheteur paie
 * sur la page Stripe Checkout (aucune clé publiable ni formulaire de carte côté front) ; le montant
 * est AUTORISÉ puis capturé rapidement **sur le solde de la plateforme** (PaymentsService : à
 * l'expédition, à la remise, au litige ou au plus tard ESCROW_CAPTURE_AFTER_HOURS après le
 * paiement). Le vendeur n'est payé qu'à la confirmation, par un Transfer (`transfer`) rattaché à la
 * charge d'origine (`source_transaction`, donc indépendant du solde disponible de la plateforme) et
 * regroupé avec elle (`transfer_group`). Un remboursement avant transfert part du solde de la
 * plateforme ; après transfert, le transfert est d'abord annulé (`reverseTransfer`, le compte du
 * vendeur est débité) puis l'acheteur remboursé.
 *
 * Ancien modèle « destination charge » (`sellerConnectedAccountId` fourni à la création :
 * application_fee_amount + transfer_data.destination, fonds versés au vendeur à la capture) : plus
 * utilisé pour les nouvelles ventes, conservé pour terminer celles créées avant la bascule
 * (`refund` annule alors le transfert avec reverse_transfer).
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
        : params.transferGroup
          ? { transfer_group: params.transferGroup }
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
      // Deux lignes sur la page Stripe (AUDIT §51) : l'article et les frais de protection, jamais un total sans détail.
      // Leur somme est le total du devis ; à défaut de détail (anciens appels), une seule ligne au montant total.
      line_items:
        params.priceEuros !== undefined && params.feeEuros !== undefined && params.feeEuros > 0 && this.toCents(params.priceEuros) + this.toCents(params.feeEuros) + this.toCents(params.shippingEuros ?? 0) === this.toCents(params.amountEuros)
          ? [
              { quantity: 1, price_data: { currency: 'eur', unit_amount: this.toCents(params.priceEuros), product_data: { name: params.title.slice(0, 120) } } },
              { quantity: 1, price_data: { currency: 'eur', unit_amount: this.toCents(params.feeEuros), product_data: { name: 'Frais de protection acheteur Trocoin', description: "Paiement conservé par Trocoin jusqu'à la réception, remboursement si le colis n'arrive pas." } } },
              // Frais de livraison choisis par l'acheteur (AUDIT §59) : ligne à part, jamais fondue dans le prix
              ...(params.shippingEuros && params.shippingEuros > 0 ? [{ quantity: 1, price_data: { currency: 'eur', unit_amount: this.toCents(params.shippingEuros), product_data: { name: (params.shippingLabel || 'Frais de livraison').slice(0, 120) } } }] : []),
            ]
          : [{ quantity: 1, price_data: { currency: 'eur', unit_amount: this.toCents(params.amountEuros), product_data: { name: params.title.slice(0, 120) } } }],
      payment_intent_data: {
        capture_method: 'manual',
        metadata: params.metadata,
        ...(params.sellerConnectedAccountId
          ? { application_fee_amount: this.toCents(params.applicationFeeEuros), transfer_data: { destination: params.sellerConnectedAccountId } }
          : params.transferGroup
            ? { transfer_group: params.transferGroup }
            : {}),
      },
      // Moyens de paiement : volontairement AUCUN `payment_method_types` ni `payment_method_options` — Stripe
      // propose les moyens activés dans le Dashboard et compatibles avec la capture différée (carte, et PayPal
      // via Stripe une fois la demande « place de marché » approuvée : même séquestre, même virement Connect ;
      // AUDIT §40). L'autorisation prolongée de la carte (§37, paramètre absent des types Checkout du SDK 16 et
      // refusé par l'API : « unknown parameter ») n'est plus demandée : le séquestre sur le solde (§39) capture
      // sous 24 h, la date `capture_before` relue dans syncCheckout ne sert plus que de garde-fou.
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      expires_at: expiresAt,
    });
    if (!session.url) throw new Error('Stripe n\'a pas renvoyé d\'URL de paiement.');
    return { providerSessionId: session.id, checkoutUrl: session.url, expiresAt: new Date(expiresAt * 1000) };
  }

  async syncCheckout(providerSessionId: string): Promise<CheckoutSync> {
    const session = await this.stripe.checkout.sessions.retrieve(providerSessionId, { expand: ['payment_intent', 'payment_intent.latest_charge'] });
    const intent = session.payment_intent as Stripe.PaymentIntent | null;
    if (intent && (intent.status === 'requires_capture' || intent.status === 'succeeded')) {
      // Date limite de capture réelle (réseau de la carte, autorisation prolongée ou non) : pilote les échéances du séquestre
      const charge = intent.latest_charge && typeof intent.latest_charge !== 'string' ? intent.latest_charge : null;
      const card = charge?.payment_method_details?.card as { capture_before?: number; extended_authorization?: { status?: string } } | undefined;
      // Moyen réellement utilisé (card, paypal, …) : mémorisé sur la transaction, jamais supposé être une carte
      const paymentMethodType = charge?.payment_method_details?.type ?? undefined;
      return {
        status: 'sequestre',
        providerPaymentId: intent.id,
        paymentMethodType,
        captureBefore: card?.capture_before ? new Date(card.capture_before * 1000) : undefined,
        extendedAuthorization: card?.extended_authorization?.status === 'enabled',
      };
    }
    if (session.status === 'expired' || intent?.status === 'canceled') return { status: 'annulee', providerPaymentId: intent?.id };
    return { status: 'en_attente', checkoutUrl: session.url ?? undefined };
  }

  /** L'acheteur abandonne : la session Checkout est expirée chez Stripe (sans effet si elle l'est déjà ou si elle est payée). */
  async expireCheckout(providerSessionId: string): Promise<void> {
    const session = await this.stripe.checkout.sessions.retrieve(providerSessionId);
    if (session.status === 'open') await this.stripe.checkout.sessions.expire(providerSessionId);
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
        // Remboursement PARTIEL (geste commercial fait dans le tableau de bord) : la vente ne passe pas « remboursée »
        if (!ch.refunded) return { ...base, type: 'ignored' };
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
    // Une autorisation non capturée est annulée ; un paiement capturé est remboursé (modèle platform :
    // depuis le solde de la plateforme ; ancien modèle destination : avec annulation du transfert).
    const intent = await this.stripe.paymentIntents.retrieve(providerPaymentId);
    if (intent.status === 'requires_capture') {
      await this.stripe.paymentIntents.cancel(providerPaymentId);
    } else if (intent.status === 'succeeded') {
      await this.stripe.refunds.create({ payment_intent: providerPaymentId, ...(intent.transfer_data ? { reverse_transfer: true, refund_application_fee: true } : {}) });
    }
    return { status: 'rembourse' as const };
  }

  async transfer(params: TransferParams) {
    // `source_transaction` : le transfert est adossé à la charge de l'acheteur ; Stripe l'exécute quand ces
    // fonds sont disponibles, sans dépendre du solde disponible global de la plateforme (sinon le virement
    // serait refusé tant que la charge n'est pas réglée, environ 7 jours en France).
    const intent = await this.stripe.paymentIntents.retrieve(params.providerPaymentId);
    if (intent.status !== 'succeeded') throw new Error(`Paiement ${params.providerPaymentId} non capturé (${intent.status}) : transfert impossible.`);
    const chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;
    if (!chargeId) throw new Error(`Paiement ${params.providerPaymentId} sans charge : transfert impossible.`);
    const transfer = await this.stripe.transfers.create({
      amount: this.toCents(params.amountEuros),
      currency: 'eur',
      destination: params.sellerConnectedAccountId,
      source_transaction: chargeId,
      transfer_group: params.transactionId,
      description: params.description,
      metadata: { transactionId: params.transactionId },
    }, { idempotencyKey: `payout-${params.transactionId}` });
    return { transferId: transfer.id };
  }

  async reverseTransfer(transferId: string) {
    // Annulation intégrale : le compte connecté du vendeur est débité (solde négatif possible, la plateforme en répond).
    await this.stripe.transfers.createReversal(transferId, {});
  }
}
