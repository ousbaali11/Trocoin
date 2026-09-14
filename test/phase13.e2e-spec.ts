import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import Stripe from 'stripe';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { Notification } from '../src/notifications/notification.entity';
import { CheckoutSync, CreateCheckoutParams, IPaymentProvider, PaymentWebhookEvent } from '../src/payments/payment-provider.interface';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { PaymentsService } from '../src/payments/payments.service';
import { StripePaymentProvider } from '../src/payments/stripe-payment.provider';
import { Transaction } from '../src/payments/transaction.entity';
import { createListing, login } from './utils';

/**
 * Phase 13 : paiement hébergé (modèle Stripe Checkout, capture différée) et webhook signé.
 *  - flux HTTP complet avec un fournisseur hébergé simulé en mémoire (même contrat que Stripe) ;
 *  - vérification de signature et normalisation des évènements par le vrai fournisseur Stripe,
 *    sans réseau (signature fabriquée avec la bibliothèque officielle).
 * Le parcours contre Stripe en mode test réel est joué à part (AUDIT.md §15).
 */
class FakeHostedProvider implements IPaymentProvider {
  sessions = new Map<string, { status: CheckoutSync['status']; pi?: string; url: string; params: CreateCheckoutParams }>();
  captured: string[] = [];
  refunded: string[] = [];
  private n = 0;
  async createPaymentIntent(): Promise<never> {
    throw new Error('non utilisé en mode hébergé');
  }
  async createCheckout(params: CreateCheckoutParams) {
    const id = `cs_test_${++this.n}`;
    const url = `https://checkout.example.test/pay/${id}`;
    this.sessions.set(id, { status: 'en_attente', url, params });
    return { providerSessionId: id, checkoutUrl: url, expiresAt: new Date(Date.now() + 30 * 60_000) };
  }
  async syncCheckout(id: string): Promise<CheckoutSync> {
    const s = this.sessions.get(id);
    if (!s) throw new Error('session inconnue');
    return s.status === 'en_attente' ? { status: 'en_attente', checkoutUrl: s.url } : { status: s.status, providerPaymentId: s.pi };
  }
  parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentWebhookEvent {
    if (signature !== 'sig-valide') throw new (require('@nestjs/common').BadRequestException)('Signature invalide');
    const e = JSON.parse(rawBody.toString());
    return { id: e.id, raw: e.type, type: e.normalized, providerSessionId: e.sessionId, providerPaymentId: e.paymentIntentId, transactionId: e.transactionId };
  }
  async capture(id: string) {
    this.captured.push(id);
    return { status: 'succeeded' as const };
  }
  async refund(id: string) {
    this.refunded.push(id);
    return { status: 'rembourse' as const };
  }
  /** Simule l'acheteur qui paie sur la page hébergée (autorisation, capture différée). */
  pay(id: string) {
    const s = this.sessions.get(id)!;
    s.status = 'sequestre';
    s.pi = `pi_test_${id.slice(-1)}`;
  }
  expire(id: string) {
    this.sessions.get(id)!.status = 'annulee';
  }
}

describe('Phase 13 : paiement hébergé (Checkout, capture différée) et webhook signé', () => {
  let app: INestApplication;
  let server: any;
  const fake = new FakeHostedProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PAYMENT_PROVIDER).useValue(fake).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  const notifsOf = async (userId: string, type = 'transaction') => app.get<Repository<Notification>>(getRepositoryToken(Notification)).find({ where: { userId, type } as any });

  it('achat → transaction « en_attente » + URL de paiement ; le vendeur n\'est prévenu qu\'après l\'autorisation ; retour de l\'acheteur → « sequestre »', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 38 });

    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo' }).expect(201);
    expect(created.body.transaction.status).toBe('en_attente');
    expect(created.body.checkoutUrl).toMatch(/^https:\/\/checkout\.example\.test\/pay\/cs_test_/);
    expect(created.body.transaction.checkoutUrl).toBe(created.body.checkoutUrl);
    const sessionId = created.body.checkoutUrl.split('/').pop();
    const params = fake.sessions.get(sessionId)!.params;
    expect(params.amountEuros).toBe(40.4); // 38 € + 5 % + 0,50 €
    expect(params.applicationFeeEuros).toBe(5.44); // commission 3,04 € + frais 2,40 €
    expect(params.successUrl).toMatch(new RegExp(`/compte/transactions/${created.body.transaction.id}\\?paiement=retour$`));
    expect(params.cancelUrl).toMatch(new RegExp(`/annonces/${listing.id}\\?paiement=annule$`));
    expect(params.transactionId).toBe(created.body.transaction.id);
    expect(await notifsOf(seller.id)).toHaveLength(0);

    // Tant que ce n'est pas payé : l'acheteur voit l'URL pour reprendre, le vendeur non ; l'annonce est bloquée
    const asBuyer = await request(server).get(`/transactions/${created.body.transaction.id}`).set(buyer.auth).expect(200);
    expect(asBuyer.body.status).toBe('en_attente');
    expect(asBuyer.body.checkoutUrl).toBe(created.body.checkoutUrl);
    const asSeller = await request(server).get(`/transactions/${created.body.transaction.id}`).set(seller.auth).expect(200);
    expect(asSeller.body.checkoutUrl).toBeUndefined();
    const other = await login(app);
    await request(server).post('/transactions').set(other.auth).send({ listingId: listing.id }).expect(400);

    // L'acheteur paie sur la page hébergée puis revient : relecture → sequestre, vendeur prévenu, identifiant du paiement conservé
    fake.pay(sessionId);
    const back = await request(server).get(`/transactions/${created.body.transaction.id}`).set(buyer.auth).expect(200);
    expect(back.body.status).toBe('sequestre');
    expect(back.body.checkoutUrl).toBeUndefined();
    expect(back.body.providerPaymentId).toBeUndefined(); // jamais exposé
    const stored = await app.get<Repository<Transaction>>(getRepositoryToken(Transaction)).findOne({ where: { id: created.body.transaction.id } });
    expect(stored!.providerPaymentId).toMatch(/^pi_test_/);
    expect((await notifsOf(seller.id)).map((n) => n.title)).toEqual(['Nouvelle vente sécurisée']);

    // Suite du parcours inchangée : expédition, réception → capture du paiement
    await request(server).post(`/transactions/${created.body.transaction.id}/ship`).set(seller.auth).send({ trackingNumber: '6A98765432109' }).expect(201);
    const confirmed = await request(server).post(`/transactions/${created.body.transaction.id}/confirm-delivery`).set(buyer.auth).expect(201);
    expect(confirmed.body.status).toBe('confirme');
    expect(fake.captured).toEqual([stored!.providerPaymentId]);
  });

  it('webhook : signature obligatoire et vérifiée ; « completed » confirme, « expired » annule, « refunded » rembourse ; rejouable sans effet', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const l1 = await createListing(app, seller, { title: 'Vélo enfant 16 pouces', price: 60 });
    const t1 = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: l1.id }).expect(201)).body;
    const s1 = t1.checkoutUrl.split('/').pop();

    const post = (body: object, signature?: string) => {
      const r = request(server).post('/transactions/webhook/stripe').set('Content-Type', 'application/json');
      return (signature ? r.set('stripe-signature', signature) : r).send(JSON.stringify(body));
    };
    await post({ id: 'evt_1', type: 'checkout.session.completed', normalized: 'checkout_completed', sessionId: s1 }).expect(400);
    await post({ id: 'evt_1', type: 'checkout.session.completed', normalized: 'checkout_completed', sessionId: s1 }, 'sig-fausse').expect(400);

    // completed alors que Stripe confirme l'autorisation → sequestre
    fake.pay(s1);
    const ok = await post({ id: 'evt_1', type: 'checkout.session.completed', normalized: 'checkout_completed', sessionId: s1, transactionId: t1.transaction.id }, 'sig-valide').expect(200);
    expect(ok.body).toEqual({ received: true, handled: 'checkout_completed' });
    expect((await request(server).get(`/transactions/${t1.transaction.id}`).set(buyer.auth)).body.status).toBe('sequestre');
    await post({ id: 'evt_1', type: 'checkout.session.completed', normalized: 'checkout_completed', sessionId: s1 }, 'sig-valide').expect(200); // rejeu : idempotent
    expect((await request(server).get(`/transactions/${t1.transaction.id}`).set(buyer.auth)).body.status).toBe('sequestre');

    // refunded (remboursement émis depuis le tableau de bord Stripe) → rembourse + notification acheteur
    const pi1 = (await app.get<Repository<Transaction>>(getRepositoryToken(Transaction)).findOne({ where: { id: t1.transaction.id } }))!.providerPaymentId;
    await post({ id: 'evt_2', type: 'charge.refunded', normalized: 'payment_refunded', paymentIntentId: pi1 }, 'sig-valide').expect(200);
    const refunded = await request(server).get(`/transactions/${t1.transaction.id}`).set(buyer.auth).expect(200);
    expect(refunded.body.status).toBe('rembourse');
    expect(refunded.body.resolutionNote).toMatch(/Remboursement constaté/);
    expect((await notifsOf(buyer.id)).some((n) => n.title === 'Remboursement effectué')).toBe(true);

    // expired : page abandonnée → annulee, l'annonce redevient achetable
    const l2 = await createListing(app, seller, { title: 'Lampe de bureau', price: 25 });
    const t2 = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: l2.id }).expect(201)).body;
    const s2 = t2.checkoutUrl.split('/').pop();
    fake.expire(s2);
    await post({ id: 'evt_3', type: 'checkout.session.expired', normalized: 'checkout_expired', sessionId: s2 }, 'sig-valide').expect(200);
    const expired = await request(server).get(`/transactions/${t2.transaction.id}`).set(buyer.auth).expect(200);
    expect(expired.body.status).toBe('annulee');
    expect(expired.body.resolutionNote).toBe('Paiement non finalisé');
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: l2.id }).expect(201);

    // payment_intent.canceled sur une transaction séquestrée (annulation côté Stripe) → annulee, les deux parties prévenues
    const l3 = await createListing(app, seller, { title: 'Chaise haute', price: 30 });
    const t3 = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: l3.id }).expect(201)).body;
    const s3 = t3.checkoutUrl.split('/').pop();
    fake.pay(s3);
    await request(server).get(`/transactions/${t3.transaction.id}`).set(buyer.auth).expect(200);
    const pi3 = (await app.get<Repository<Transaction>>(getRepositoryToken(Transaction)).findOne({ where: { id: t3.transaction.id } }))!.providerPaymentId;
    await post({ id: 'evt_4', type: 'payment_intent.canceled', normalized: 'payment_canceled', paymentIntentId: pi3 }, 'sig-valide').expect(200);
    expect((await request(server).get(`/transactions/${t3.transaction.id}`).set(seller.auth)).body.status).toBe('annulee');
    expect((await notifsOf(seller.id)).some((n) => n.title === 'Transaction annulée')).toBe(true);
  });

  it('page de paiement abandonnée sans webhook : la tâche périodique annule après le délai, et une annulation par l\'acheteur libère l\'autorisation', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { title: 'Poussette canne', price: 45 });
    const t = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201)).body;
    const repo = app.get<Repository<Transaction>>(getRepositoryToken(Transaction));
    // Trop récente : rien ne se passe
    expect(await app.get(PaymentsService).expirePendingCheckouts()).toBe(0);
    await repo.update(t.transaction.id, { createdAt: new Date(Date.now() - 45 * 60_000) });
    expect(await app.get(PaymentsService).expirePendingCheckouts()).toBe(1);
    expect((await request(server).get(`/transactions/${t.transaction.id}`).set(buyer.auth)).body.status).toBe('annulee');

    // Autorisation obtenue puis achat annulé avant envoi → remboursement (annulation de l'autorisation chez le fournisseur)
    const t2 = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201)).body;
    fake.pay(t2.checkoutUrl.split('/').pop());
    await request(server).get(`/transactions/${t2.transaction.id}`).set(buyer.auth).expect(200);
    const cancelled = await request(server).post(`/transactions/${t2.transaction.id}/cancel`).set(buyer.auth).expect(201);
    expect(cancelled.body.status).toBe('annulee');
    const pi = (await repo.findOne({ where: { id: t2.transaction.id } }))!.providerPaymentId;
    expect(fake.refunded).toContain(pi);
  });

  describe('fournisseur Stripe réel, sans réseau : vérification de signature et normalisation', () => {
    const secret = 'whsec_test_secret_0123456789';
    const config = { get: (k: string) => ({ STRIPE_SECRET_KEY: 'sk_test_fictive', STRIPE_WEBHOOK_SECRET: secret })[k] } as unknown as ConfigService;
    const provider = new StripePaymentProvider(config);
    const stripe = new Stripe('sk_test_fictive');
    const signed = (event: object) => {
      const payload = JSON.stringify(event);
      return { payload: Buffer.from(payload), header: stripe.webhooks.generateTestHeaderString({ payload, secret }) };
    };

    it('checkout.session.completed → checkout_completed avec la session et la transaction ; charge.refunded → payment_refunded', () => {
      const completed = signed({ id: 'evt_c', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_test_abc', object: 'checkout.session', client_reference_id: 'tx-123' } } });
      expect(provider.parseWebhook(completed.payload, completed.header)).toEqual({ id: 'evt_c', raw: 'checkout.session.completed', type: 'checkout_completed', providerSessionId: 'cs_test_abc', transactionId: 'tx-123' });
      const refunded = signed({ id: 'evt_r', object: 'event', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: 'pi_9' } } });
      expect(provider.parseWebhook(refunded.payload, refunded.header)).toMatchObject({ type: 'payment_refunded', providerPaymentId: 'pi_9' });
      const other = signed({ id: 'evt_o', object: 'event', type: 'customer.created', data: { object: { id: 'cus_1', object: 'customer' } } });
      expect(provider.parseWebhook(other.payload, other.header).type).toBe('ignored');
    });

    it('signature absente, forgée avec un autre secret, ou corps modifié après signature → 400', () => {
      const ev = signed({ id: 'evt_x', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_1', object: 'checkout.session' } } });
      expect(() => provider.parseWebhook(ev.payload, undefined)).toThrow(/stripe-signature absent/);
      const forged = stripe.webhooks.generateTestHeaderString({ payload: ev.payload.toString(), secret: 'whsec_autre' });
      expect(() => provider.parseWebhook(ev.payload, forged)).toThrow(/Signature Stripe invalide/);
      const tampered = Buffer.from(ev.payload.toString().replace('cs_1', 'cs_2'));
      expect(() => provider.parseWebhook(tampered, ev.header)).toThrow(/Signature Stripe invalide/);
      const unconfigured = new StripePaymentProvider({ get: (k: string) => (k === 'STRIPE_SECRET_KEY' ? 'sk_test_fictive' : undefined) } as unknown as ConfigService);
      expect(() => unconfigured.parseWebhook(ev.payload, ev.header)).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });
  });
});
