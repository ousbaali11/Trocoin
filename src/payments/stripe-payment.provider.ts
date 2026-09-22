import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { createHash } from 'crypto';
import { payoutTrace } from './payout-trace';
import {
  CheckoutResult,
  CheckoutSync,
  CreateCheckoutParams,
  CreatePaymentIntentParams,
  IPaymentProvider,
  PaymentIntentResult,
  PaymentProviderError,
  PaymentState,
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
/** Clé d'idempotence d'un virement (AUDIT §70) : la vente ET les paramètres qui comptent (destination, montant, charge). */
export function transferIdempotencyKey(transactionId: string, destination: string, amountCents: number, chargeId: string): string {
  const fingerprint = createHash('sha256').update(`${destination}|${amountCents}|${chargeId}`).digest('hex').slice(0, 16);
  return `payout-${transactionId}-${fingerprint}`;
}

/** Refus Stripe « clé déjà utilisée avec d'autres paramètres ». */
export function isIdempotencyConflict(err: unknown): boolean {
  const e = err as { type?: string; code?: string; message?: string };
  return e?.type === 'StripeIdempotencyError' || e?.code === 'idempotency_key_in_use' || /idempotent requests/i.test(e?.message || '');
}

@Injectable()
export class StripePaymentProvider implements IPaymentProvider {
  private readonly stripe: Stripe;
  /**
   * Secrets de signature des webhooks (AUDIT §64). Deux points de terminaison Stripe visent la même URL :
   * celui du compte plateforme (paiements : STRIPE_WEBHOOK_SECRET) et celui des « comptes connectés »
   * (account.updated : STRIPE_CONNECT_WEBHOOK_SECRET, facultatif). Chaque évènement n'est signé qu'avec l'un des
   * deux : la signature est essayée avec chaque secret connu.
   */
  private readonly webhookSecrets: string[];
  private readonly logger = new Logger('Paiement(stripe)');

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY manquant : configurez-le dans .env pour utiliser PAYMENT_PROVIDER=stripe.');
    }
    this.stripe = new Stripe(key, { timeout: 20_000, maxNetworkRetries: 2 }); // AUDIT §69 : jamais 80 s d'attente
    this.webhookSecrets = [this.config.get<string>('STRIPE_WEBHOOK_SECRET'), this.config.get<string>('STRIPE_CONNECT_WEBHOOK_SECRET')].map((s) => (s || '').trim()).filter((s) => !!s);
    const connect = this.config.get<string>('STRIPE_CONNECT_WEBHOOK_SECRET') ? ', comptes connectés signés' : ', comptes connectés NON configurés (STRIPE_CONNECT_WEBHOOK_SECRET absent : account.updated ignoré)';
    this.logger.log(`Stripe ${key.startsWith('sk_test_') ? 'MODE TEST' : 'mode réel'} · webhook ${this.webhookSecrets.length ? 'signé' + connect : 'NON configuré (STRIPE_WEBHOOK_SECRET absent)'}`);
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
    if (this.webhookSecrets.length === 0) throw new BadRequestException('Webhook Stripe non configuré (STRIPE_WEBHOOK_SECRET).');
    if (!signature) throw new BadRequestException('En-tête stripe-signature absent.');
    let event: Stripe.Event | undefined;
    let lastError: Error | undefined;
    for (const secret of this.webhookSecrets) {
      try {
        event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
        break;
      } catch (e) {
        lastError = e as Error;
      }
    }
    if (!event) throw new BadRequestException(`Signature Stripe invalide : ${lastError?.message ?? 'aucun secret ne correspond'}`);
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
      case 'account.updated': {
        const acct = event.data.object as Stripe.Account;
        return { ...base, type: 'account_updated', accountId: acct.id, account: acct };
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

  /**
   * Lecture d'un paiement (AUDIT §65) : « No such payment_intent » (identifiant d'un autre environnement — clés de test
   * changées, bac à sable recréé — ou donnée effacée chez le prestataire) devient une erreur métier `paiement_absent`,
   * traitée une fois pour toutes au lieu d'être retentée à chaque passage de la tâche périodique.
   */
  private async retrieveIntent(id: string, params?: Stripe.PaymentIntentRetrieveParams): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.retrieve(id, params);
    } catch (err) {
      const e = err as { code?: string; statusCode?: number; message?: string };
      if (e?.code === 'resource_missing' || e?.statusCode === 404 || /No such payment_intent/i.test(e?.message || '')) {
        throw new PaymentProviderError('paiement_absent', `Paiement ${id} inconnu du prestataire (${e?.message || 'introuvable'}) : il appartient à un autre environnement ou a été effacé chez lui.`);
      }
      throw err;
    }
  }

  /** Identifiant de session de paiement encore présent (retour et webhook manqués) : on retrouve le paiement lui-même. */
  private async intentIdOf(providerPaymentId: string): Promise<string> {
    if (!providerPaymentId.startsWith('cs_')) return providerPaymentId;
    const session = await this.stripe.checkout.sessions.retrieve(providerPaymentId);
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!pi) throw new PaymentProviderError('paiement_absent', "Aucun paiement n'a été effectué sur cette page de paiement.");
    return pi;
  }

  /**
   * Encaissement (AUDIT §63) : l'état réel est relu d'abord — déjà encaissé (capture faite par le prestataire ou une
   * autre exécution) → rien à faire ; autorisation annulée ou expirée (7 jours pour une carte : la tâche des
   * échéances n'a pas pu tourner, API en veille) → refus explicite, plus jamais une « erreur interne ».
   */
  async capture(providerPaymentId: string) {
    const id = await this.intentIdOf(providerPaymentId);
    const intent = await this.retrieveIntent(id);
    if (intent.status === 'succeeded') return { status: 'succeeded' as const };
    if (intent.status === 'canceled') throw new PaymentProviderError('autorisation_expiree', "L'autorisation bancaire de cet achat a expiré ou a été annulée chez le prestataire : l'argent n'a jamais été encaissé et ne peut plus l'être.");
    try {
      await this.stripe.paymentIntents.capture(id);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (/expired|canceled|already been captured/i.test(e?.message || '')) throw new PaymentProviderError('autorisation_expiree', `Encaissement refusé par le prestataire : ${e.message}`);
      throw err;
    }
    return { status: 'succeeded' as const };
  }

  async inspect(providerPaymentId: string): Promise<{ state: PaymentState; detail?: string }> {
    let id: string;
    try {
      id = await this.intentIdOf(providerPaymentId);
    } catch (err) {
      return err instanceof PaymentProviderError ? { state: 'en_attente', detail: err.message } : { state: 'inconnue', detail: (err as Error).message };
    }
    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.retrieveIntent(id, { expand: ['latest_charge'] });
    } catch (err) {
      if (err instanceof PaymentProviderError) return { state: 'inconnue', detail: err.message };
      throw err;
    }
    const charge = intent.latest_charge && typeof intent.latest_charge !== 'string' ? intent.latest_charge : null;
    if (charge?.refunded) return { state: 'remboursee', detail: 'remboursement intégral émis' };
    if (intent.status === 'succeeded') return { state: 'encaissee', detail: charge?.amount_refunded ? `remboursé partiellement : ${(charge.amount_refunded / 100).toFixed(2)} €` : undefined };
    if (intent.status === 'requires_capture') return { state: 'autorisee' };
    if (intent.status === 'canceled') return { state: 'annulee', detail: intent.cancellation_reason ? `motif : ${intent.cancellation_reason}` : undefined };
    return { state: 'en_attente', detail: intent.status };
  }

  async refund(providerPaymentId: string) {
    // Une autorisation non capturée est annulée ; un paiement capturé est remboursé (modèle platform :
    // depuis le solde de la plateforme ; ancien modèle destination : avec annulation du transfert).
    const id = await this.intentIdOf(providerPaymentId).catch((err) => { if (err instanceof PaymentProviderError) return null; throw err; });
    if (!id) return { status: 'rembourse' as const }; // jamais payé : rien à rendre
    const intent = await this.retrieveIntent(id, { expand: ['latest_charge'] });
    const charge = intent.latest_charge && typeof intent.latest_charge !== 'string' ? intent.latest_charge : null;
    if (intent.status === 'requires_capture') {
      await this.stripe.paymentIntents.cancel(id);
    } else if (intent.status === 'succeeded' && !charge?.refunded) {
      await this.stripe.refunds.create({ payment_intent: id, ...(intent.transfer_data ? { reverse_transfer: true, refund_application_fee: true } : {}) });
    }
    // annulé / expiré / déjà remboursé : l'acheteur n'est pas (ou plus) débité, il n'y a rien à faire
    return { status: 'rembourse' as const };
  }

  async transfer(params: TransferParams) {
    // `source_transaction` : le transfert est adossé à la charge de l'acheteur ; Stripe l'exécute quand ces
    // fonds sont disponibles, sans dépendre du solde disponible global de la plateforme (sinon le virement
    // serait refusé tant que la charge n'est pas réglée, environ 7 jours en France).
    const intent = await this.retrieveIntent(await this.intentIdOf(params.providerPaymentId));
    if (intent.status !== 'succeeded') throw new Error(`Paiement ${params.providerPaymentId} non capturé (${intent.status}) : transfert impossible.`);
    const chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;
    if (!chargeId) throw new Error(`Paiement ${params.providerPaymentId} sans charge : transfert impossible.`);
    // AUDIT §70 : un virement déjà fait pour cette vente (réponse perdue, serveur endormi en plein appel) est réutilisé,
    // jamais recréé — et jamais retenté avec une clé en conflit
    const existing = await this.findTransfer(params.transactionId);
    if (existing) {
      payoutTrace.reused += 1;
      return { transferId: existing };
    }
    const amount = this.toCents(params.amountEuros);
    const body: Stripe.TransferCreateParams = {
      amount,
      currency: 'eur',
      destination: params.sellerConnectedAccountId,
      source_transaction: chargeId,
      transfer_group: params.transactionId,
      description: params.description,
      metadata: { transactionId: params.transactionId },
    };
    // Clé d'idempotence liée aux paramètres qui comptent (AUDIT §70) : la clé fixe `payout-<vente>` refusait toute nouvelle
    // tentative dès qu'un paramètre changeait (compte de versement remplacé, libellé différent selon le chemin d'appel) —
    // « Keys for idempotent requests can only be used with the same parameters » à chaque passage, sans fin.
    const key = transferIdempotencyKey(params.transactionId, params.sellerConnectedAccountId, amount, chargeId);
    try {
      const transfer = await this.stripe.transfers.create(body, { idempotencyKey: key });
      return { transferId: transfer.id };
    } catch (err) {
      if (!isIdempotencyConflict(err)) throw err;
      // Clé déjà utilisée avec d'autres paramètres (ancienne clé fixe, ou compte de versement changé dans les 24 h) : la
      // vente n'a pas de virement chez le prestataire (vérifié ci-dessus) → nouvelle clé, une seule fois
      payoutTrace.keyConflicts += 1;
      const transfer = await this.stripe.transfers.create(body, { idempotencyKey: `${key}-r${Date.now()}` });
      return { transferId: transfer.id };
    }
  }

  /** Virement déjà fait pour cette vente chez le prestataire (non annulé), sinon null. */
  async findTransfer(transactionId: string): Promise<string | null> {
    const list = await this.stripe.transfers.list({ transfer_group: transactionId, limit: 10 });
    return list.data.find((t) => !t.reversed)?.id ?? null;
  }

  async reverseTransfer(transferId: string) {
    // Annulation intégrale : le compte connecté du vendeur est débité (solde négatif possible, la plateforme en répond).
    await this.stripe.transfers.createReversal(transferId, {});
  }
}
