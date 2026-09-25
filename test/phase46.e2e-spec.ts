import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { buildValidationPipe } from '../src/common/validation';
import { Notification } from '../src/notifications/notification.entity';
import { CheckoutSync, CreateCheckoutParams, IPaymentProvider, PaymentWebhookEvent } from '../src/payments/payment-provider.interface';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { PaymentsService } from '../src/payments/payments.service';
import { WebhookEvent } from '../src/payments/webhook-event.entity';
import { webhookTrace } from '../src/payments/webhook-trace';
import { StripeConnectService } from '../src/users/stripe-connect.service';
import { IMAGE_COOKIE } from '../src/conversations/image-access';
import { createListing, login, makeAdmin, PNG_1x1, TEST_ADDRESS } from './utils';

/**
 * Phase 46 (AUDIT §74) : (1) les évènements webhook sont livrés « au moins une fois » — un même évènement ne doit être
 * traité qu'une seule fois (pas de double capture, virement, statut ou notification) ; (2) les images de conversation ne
 * sont plus des fichiers publics : seuls les deux participants (et l'administration) les obtiennent, identité vérifiée à
 * chaque requête (jeton de session ou cookie posé à l'ouverture de la conversation).
 */
class FakeHostedProvider implements IPaymentProvider {
  sessions = new Map<string, { status: CheckoutSync['status']; pi?: string; url: string }>();
  refunded: string[] = [];
  reversed: string[] = [];
  private n = 0;
  async createPaymentIntent(): Promise<never> { throw new Error('non utilisé'); }
  async createCheckout(params: CreateCheckoutParams) {
    const id = `cs_test_${++this.n}`;
    const url = `https://checkout.example.test/pay/${id}`;
    this.sessions.set(id, { status: 'en_attente', url });
    void params;
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
    return { id: e.id, raw: e.type, type: e.normalized, providerSessionId: e.sessionId, providerPaymentId: e.paymentIntentId, transactionId: e.transactionId, accountId: e.accountId, account: e.account };
  }
  async capture() { return { status: 'succeeded' as const }; }
  async refund(id: string) { this.refunded.push(id); return { status: 'rembourse' as const }; }
  async reverseTransfer(id: string) { this.reversed.push(id); }
  pay(id: string) { const s = this.sessions.get(id)!; s.status = 'sequestre'; s.pi = `pi_test_${id.slice(-1)}`; }
}

describe('Phase 46 : webhooks dédupliqués, images de conversation privées', () => {
  let app: INestApplication;
  let server: any;
  const fake = new FakeHostedProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PAYMENT_PROVIDER).useValue(fake).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  const notifsOf = async (userId: string, title: string) => (await app.get<Repository<Notification>>(getRepositoryToken(Notification)).find({ where: { userId, title } as any })).length;
  const post = (body: object) => request(server).post('/transactions/webhook/stripe').set('Content-Type', 'application/json').set('stripe-signature', 'sig-valide').send(JSON.stringify(body));

  it('un même évènement livré deux fois n\'est traité qu\'une fois : une seule notification, un seul remboursement, réponse 200 « déjà traité » ; libéré si le traitement échoue', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 45 });
    const created = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: TEST_ADDRESS }).expect(201)).body;
    const sessionId = created.checkoutUrl.split('/').pop();
    const txId = created.transaction.id;
    fake.pay(sessionId);
    const dupBefore = webhookTrace.duplicates;

    // checkout.session.completed livré deux fois (relance du prestataire)
    const first = await post({ id: 'evt_dedup_1', type: 'checkout.session.completed', normalized: 'checkout_completed', sessionId, transactionId: txId }).expect(200);
    expect(first.body).toEqual({ received: true, handled: 'checkout_completed' });
    const second = await post({ id: 'evt_dedup_1', type: 'checkout.session.completed', normalized: 'checkout_completed', sessionId, transactionId: txId }).expect(200);
    expect(second.body).toEqual({ received: true, handled: 'deja_traite' });
    expect(await notifsOf(seller.id, 'Nouvelle vente sécurisée')).toBe(1);
    expect(webhookTrace.duplicates).toBe(dupBefore + 1);

    // charge.refunded livré trois fois : un seul passage « remboursé », une seule notification à l'acheteur
    const pi = fake.sessions.get(sessionId)!.pi!;
    for (let i = 0; i < 3; i += 1) await post({ id: 'evt_dedup_2', type: 'charge.refunded', normalized: 'payment_refunded', paymentIntentId: pi }).expect(200);
    expect(await notifsOf(buyer.id, 'Remboursement effectué')).toBe(1);
    expect((await request(server).get(`/transactions/${txId}`).set(buyer.auth).expect(200)).body.status).toBe('rembourse');

    // Deux identifiants différents pour le même type : chacun est traité (la déduplication porte sur l'identifiant)
    const events = app.get<Repository<WebhookEvent>>(getRepositoryToken(WebhookEvent));
    expect((await events.find({ where: { id: 'evt_dedup_1' } })).length).toBe(1);
    expect((await events.find({ where: { id: 'evt_dedup_2' } })).length).toBe(1);

    // Traitement en échec (account.updated d'un compte que le service refuse) → 500, évènement libéré → la relance est traitée
    const connect = app.get(StripeConnectService);
    const spy = jest.spyOn(connect, 'applyAccountUpdate').mockRejectedValueOnce(new Error('base injoignable')).mockResolvedValue(undefined as never);
    await post({ id: 'evt_dedup_3', type: 'account.updated', normalized: 'account_updated', accountId: 'acct_test_1', account: { id: 'acct_test_1' } }).expect(500);
    expect((await events.find({ where: { id: 'evt_dedup_3' } })).length).toBe(0);
    const retry = await post({ id: 'evt_dedup_3', type: 'account.updated', normalized: 'account_updated', accountId: 'acct_test_1', account: { id: 'acct_test_1' } }).expect(200);
    expect(retry.body.handled).toBe('account_updated');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();

    // Purge : les évènements de plus de 30 jours disparaissent, les récents restent
    const payments = app.get(PaymentsService);
    expect(await payments.purgeWebhookEvents(new Date())).toBe(0);
    expect(await payments.purgeWebhookEvents(new Date(Date.now() + 31 * 86_400_000))).toBeGreaterThanOrEqual(3);
  });

  it('image de conversation : participants (jeton ou cookie) et administration seulement ; tiers connecté → 403, anonyme → 401 ; cache privé', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const stranger = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);
    const listing = await createListing(app, seller, { price: 60 });
    const conv = (await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Voici une photo' }).expect(201)).body;
    const img = await request(server).post(`/conversations/${conv.id}/images`).set(buyer.auth).attach('file', PNG_1x1, { filename: 'p.png', contentType: 'image/png' }).expect(201);
    const url: string = img.body.attachmentUrl;
    expect(url).toMatch(new RegExp(`^/conversations/${conv.id}/images/[0-9a-f-]{36}\\.png$`));
    expect(url).not.toContain('/uploads/'); // plus jamais un fichier public
    // Les deux participants par jeton de session
    const asBuyer = await request(server).get(url).set(buyer.auth).expect(200);
    expect(asBuyer.headers['content-type']).toBe('image/png');
    expect(asBuyer.headers['cache-control']).toBe('private, max-age=86400');
    await request(server).get(url).set(seller.auth).expect(200);
    // L'administration (modération)
    await request(server).get(url).set(admin.auth).expect(200);
    // Un tiers connecté, même avec l'URL exacte → refus ; anonyme → connexion requise ; l'ancien chemin public n'existe pas
    await request(server).get(url).set(stranger.auth).expect(403);
    await request(server).get(url).expect(401);
    await request(server).get(`/uploads/${url.split('/').pop()}`).expect(404);
    // Cookie posé à l'ouverture de la conversation : suffit au navigateur pour les balises <img> (même site)
    const opened = await request(server).get(`/conversations/${conv.id}`).set(buyer.auth).expect(200);
    const cookie = (opened.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${IMAGE_COOKIE}=`))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/conversations/);
    await request(server).get(url).set('Cookie', cookie.split(';')[0]).expect(200);
    // Le cookie d'un tiers ne donne rien ; un cookie falsifié non plus
    const strangerOpened = await request(server).get('/conversations').set(stranger.auth).expect(200);
    void strangerOpened;
    const forged = `${IMAGE_COOKIE}=${buyer.id}.${Math.floor(Date.now() / 1000) + 3600}.signature-fausse`;
    await request(server).get(url).set('Cookie', forged).expect(401);
    // Le message relu par les participants pointe vers la route contrôlée ; le détail de la conversation aussi
    const messages = await request(server).get(`/conversations/${conv.id}/messages`).set(seller.auth).expect(200);
    expect(messages.body.find((m: any) => m.type === 'image').attachmentUrl).toBe(url);
    // Fichier d'une autre conversation ou inexistant → 404, même pour un participant
    await request(server).get(`/conversations/${conv.id}/images/00000000-0000-4000-8000-000000000000.png`).set(buyer.auth).expect(404);
  });
});
