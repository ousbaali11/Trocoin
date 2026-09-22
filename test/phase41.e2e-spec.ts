import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { Repository } from 'typeorm';
import { EmailService } from '../src/email/email.service';
import { Listing } from '../src/listings/listing.entity';
import { MockPaymentProvider } from '../src/payments/mock-payment.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { PaymentsService } from '../src/payments/payments.service';
import { Transaction } from '../src/payments/transaction.entity';
import { createApp, createListing, login, makeAdmin, nextPhone, TEST_ADDRESS, type TestUser } from './utils';

/**
 * Phase 41 (AUDIT §69) — audit approfondi :
 *  - sécurité des personnes : jeton de défi 2FA refusé par le temps réel, connexion par SMS refusée sur un numéro jamais
 *    vérifié, liens de changement d'adresse annulés par un changement de mot de passe, blocage respecté par « Voir le
 *    numéro » et par le temps réel, avertissement d'arnaque sur les messages ;
 *  - annonces : brouillon jamais « vendu » ni « en pause », annonce archivée intouchable par le vendeur, titre vide refusé,
 *    prix effacé en « gratuit », remise en ligne sans remontée gratuite, favoris sans annonces retirées, signalements sans
 *    note interne, avis publics sans identifiants ;
 *  - argent : proposition sous 1 € refusée, réception confirmable seulement après l'expédition, réception présumée suspendue
 *    quand le transporteur n'a jamais pris le colis, colis déposé sans déclaration = vente expédiée (pas remboursée),
 *    plafond de pages de paiement ouvertes.
 */
describe('Phase 41 : audit approfondi (sécurité des personnes, annonces, argent)', () => {
  let app: INestApplication;
  let server: any;
  let url: string;
  let transactions: Repository<Transaction>;
  let listings: Repository<Listing>;
  let payments: PaymentsService;
  let provider: MockPaymentProvider;
  const sockets: Socket[] = [];

  let n = 0;
  const formUser = () => {
    n += 1;
    const tag = `${String(Date.now()).slice(-5)}${n}`;
    return { accountType: 'particulier' as const, firstName: 'Camille', lastName: 'Durand', username: `camille41_${tag}`, email: `camille41.${tag}@example.org`, phoneNumber: nextPhone(), password: 'MotDePasse!42', passwordConfirmation: 'MotDePasse!42' };
  };
  const connect = (opts: Record<string, unknown>) =>
    new Promise<{ ok: boolean; error?: string; socket?: Socket }>((resolve) => {
      const s = io(url, { transports: ['websocket'], forceNew: true, ...opts });
      sockets.push(s);
      s.on('connect', () => resolve({ ok: true, socket: s }));
      s.on('connect_error', (e) => resolve({ ok: false, error: e.message }));
    });
  const joinRoom = (s: Socket, id: string) => new Promise<{ ok: boolean; message?: string; blocked?: boolean }>((r) => s.emit('join', { conversationId: id }, r));
  const conversationBetween = async (buyer: TestUser, listingId: string) => {
    const res = await request(server).post('/conversations').set(buyer.auth).send({ listingId, message: 'Bonjour, toujours disponible ?' }).expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    url = `http://127.0.0.1:${typeof address === 'string' ? 0 : address.port}`;
    server = app.getHttpServer();
    transactions = app.get(getRepositoryToken(Transaction));
    listings = app.get(getRepositoryToken(Listing));
    payments = app.get(PaymentsService);
    provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app.close();
  });

  it('temps réel : jeton de défi 2FA et jeton en query string refusés ; blocage → conversation non rejointe', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const challenge = await app.get(JwtService).signAsync({ sub: buyer.id, purpose: 'two-factor' }, { expiresIn: '5m' });
    expect((await connect({ auth: { token: challenge } })).ok).toBe(false);
    expect((await connect({ query: { token: buyer.token } })).ok).toBe(false);
    const good = await connect({ auth: { token: buyer.token } });
    expect(good.ok).toBe(true);
    const listing = await createListing(app, seller);
    const convId = await conversationBetween(buyer, listing.id);
    expect((await joinRoom(good.socket!, convId)).ok).toBe(true);
    await request(server).post(`/users/me/blocks/${buyer.id}`).set(seller.auth).expect(201);
    const refused = await joinRoom(good.socket!, convId);
    expect(refused).toMatchObject({ ok: false, blocked: true });
    // « Voir le numéro » respecte aussi le blocage
    await request(server).patch('/users/me').set(seller.auth).send({ phonePublic: true }).expect(200);
    await request(server).post(`/listings/${listing.id}/phone`).set(buyer.auth).expect(404);
    await request(server).delete(`/users/me/blocks/${buyer.id}`).set(seller.auth).expect(200);
    const phone = await request(server).post(`/listings/${listing.id}/phone`).set(buyer.auth).expect(200);
    expect(phone.body.phoneNumber).toBe(seller.phone);
  });

  it('connexion par SMS refusée sur un compte créé par formulaire (numéro jamais vérifié) ; message de connexion indistinct', async () => {
    const dto = formUser();
    await request(server).post('/auth/register').send(dto).expect(201);
    await request(server).post('/auth/register/phone').send({ phoneNumber: dto.phoneNumber }).expect(200);
    const { SmsService } = await import('../src/sms/sms.service');
    const code = app.get(SmsService).getLastCodeForDev(dto.phoneNumber)!;
    const sms = await request(server).post('/auth/otp/verify').send({ phoneNumber: dto.phoneNumber, code }).expect(403);
    expect(sms.body.message).toContain('mot de passe');
    // Un compte créé par SMS (sans mot de passe) et un identifiant inconnu donnent la même réponse
    const smsOnly = await login(app);
    const a = await request(server).post('/auth/login').send({ identifier: smsOnly.phone, password: 'x'.repeat(12) }).expect(401);
    const b = await request(server).post('/auth/login').send({ identifier: '+33699999999', password: 'x'.repeat(12) }).expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it("changement de mot de passe : le lien de changement d'adresse e-mail en attente cesse de valoir", async () => {
    const dto = formUser();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    const newEmail = `pirate.${String(Date.now()).slice(-6)}@example.org`;
    await request(server).post('/auth/email/change').set(auth).send({ newEmail, password: dto.password }).expect(200);
    const link = app.get(EmailService).getLastVerificationLinkForDev(newEmail)!;
    const token = new URL(link).searchParams.get('token')!;
    await request(server).post('/auth/password/change').set(auth).send({ currentPassword: dto.password, newPassword: 'NouveauMdp!4242', newPasswordConfirmation: 'NouveauMdp!4242' }).expect(200);
    const verify = await request(server).post('/auth/email/verify').send({ token });
    expect(verify.status).toBe(400);
    const login2 = await request(server).post('/auth/login').send({ identifier: dto.email, password: 'NouveauMdp!4242' }).expect(200);
    expect(login2.body.user.email).toBe(dto.email);
  });

  it('messagerie : demande de paiement hors site, lien externe et IBAN signalés au destinataire ; lien trocoin.fr non signalé', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller);
    const convId = await conversationBetween(buyer, listing.id);
    const post = (content: string) => request(server).post(`/conversations/${convId}/messages`).set(seller.auth).send({ content }).expect(201);
    expect((await post('Faites-moi un virement et je vous envoie le colis demain')).body.meta).toEqual({ warning: 'paiement_hors_site' });
    expect((await post('Payez ici : https://paiement-securise.example.com/xyz')).body.meta).toEqual({ warning: 'lien_externe' });
    expect((await post('Mon IBAN : FR76 3000 6000 0112 3456 7890 189')).body.meta).toEqual({ warning: 'coordonnees_bancaires' });
    expect((await post('Voir mon autre annonce https://www.trocoin.fr/annonces/abc')).body.meta).toBeNull();
    expect((await post('Toujours disponible, à demain !')).body.meta).toBeNull();
    // Proposition de prix sous 1 € refusée (plancher du paiement sécurisé)
    await request(server).post(`/conversations/${convId}/offers`).set(buyer.auth).send({ amount: 0.5 }).expect(400);
    await request(server).post(`/conversations/${convId}/offers`).set(buyer.auth).send({ amount: 200 }).expect(201);
  });

  it('annonces : brouillon jamais vendu ni en pause, archivée intouchable, titre vide refusé, prix effacé en gratuit, favoris et signalements assainis', async () => {
    const seller = await login(app);
    const other = await login(app);
    const draft = await createListing(app, seller, { draft: true });
    expect(draft.status).toBe('brouillon');
    await request(server).patch(`/listings/${draft.id}`).set(seller.auth).send({ status: 'vendue' }).expect(400);
    await request(server).patch(`/listings/${draft.id}`).set(seller.auth).send({ status: 'desactivee' }).expect(400);
    await request(server).patch(`/listings/${draft.id}`).set(seller.auth).send({ title: '    ' }).expect(400);
    const online = await createListing(app, seller, { price: 500 });
    await request(server).patch(`/listings/${online.id}`).set(seller.auth).send({ priceType: 'gratuit' }).expect(200);
    expect((await listings.findOne({ where: { id: online.id } }))!.price).toBeNull();
    // Pause puis remise en ligne : la date de publication (tri, alertes) n'est pas rafraîchie avant sept jours
    const publishedAt = new Date(online.publishedAt).getTime();
    await request(server).patch(`/listings/${online.id}`).set(seller.auth).send({ status: 'desactivee' }).expect(200);
    const back = await request(server).patch(`/listings/${online.id}`).set(seller.auth).send({ status: 'en_ligne', priceType: 'fixe', price: 400 }).expect(200);
    expect(new Date(back.body.publishedAt).getTime()).toBe(publishedAt);
    // Favoris : une annonce mise en pause n'est plus servie
    await request(server).post(`/listings/${online.id}/favorite`).set(other.auth).expect(201);
    expect((await request(server).get('/users/me/favorites').set(other.auth).expect(200)).body.map((l: any) => l.id)).toContain(online.id);
    await request(server).patch(`/listings/${online.id}`).set(seller.auth).send({ status: 'desactivee' }).expect(200);
    expect((await request(server).get('/users/me/favorites').set(other.auth).expect(200)).body.map((l: any) => l.id)).not.toContain(online.id);
    await request(server).patch(`/listings/${online.id}`).set(seller.auth).send({ status: 'en_ligne' }).expect(200);
    // Archivée : plus rien pour le vendeur (ni statut, ni photos, ni suppression)
    await listings.update(online.id, { status: 'archivee', archivedAt: new Date() });
    await request(server).patch(`/listings/${online.id}`).set(seller.auth).send({ status: 'vendue' }).expect(404);
    await request(server).delete(`/listings/${online.id}`).set(seller.auth).expect(404);
    await request(server).post(`/listings/${online.id}/duplicate`).set(seller.auth).expect(404);
    // Signalement : le signalant ne voit ni l'administrateur ni sa note
    const target = await createListing(app, seller);
    await request(server).post('/reports').set(other.auth).send({ listingId: target.id, reason: 'arnaque', details: 'Prix anormalement bas' }).expect(201);
    const mine = await request(server).get('/reports/mine').set(other.auth).expect(200);
    expect(mine.body[0]).toMatchObject({ listingId: target.id, reason: 'arnaque' });
    expect(mine.body[0].handledBy).toBeUndefined();
    expect(mine.body[0].resolutionNote).toBeUndefined();
    expect(mine.body[0].details).toBeUndefined();
    // Fiche publique et cartes : champs internes absents
    const pub = await request(server).get(`/listings/${target.id}`).set(other.auth).expect(200);
    expect(pub.body.createdBy).toBeUndefined();
    expect(pub.body.moderationReason).toBeUndefined();
    expect(pub.body.externalRef).toBeUndefined();
  });

  it('argent : réception confirmable seulement après expédition ; réception présumée suspendue tant que le colis n\'est pas pris en charge', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);
    const listing = await createListing(app, seller, { price: 60 });
    const res = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: TEST_ADDRESS }).expect(201);
    const tx = (res.body.transaction ?? res.body) as Transaction;
    expect(tx.status).toBe('sequestre');
    const early = await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(buyer.auth).expect(400);
    expect(early.body.message).toContain("n'a pas encore déclaré l'expédition");
    // Bon d'envoi généré puis « Confirmer l'expédition » sans jamais déposer le colis
    await request(server).post(`/transactions/${tx.id}/confirm-availability`).set(seller.auth).expect(200);
    const sender = { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', phone: '06 11 22 33 44' };
    await request(server).post(`/transactions/${tx.id}/shipment`).set(seller.auth).send({ sender }).expect(201);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({}).expect(201);
    await transactions.update(tx.id, { autoConfirmAt: new Date(Date.now() - 60_000) });
    const r1 = await payments.runEscrowSchedule(new Date());
    expect(r1.confirmed).toBe(0);
    const still = (await transactions.findOne({ where: { id: tx.id } }))!;
    expect(still.status).toBe('livree');
    expect(still.escrowStage).toBe(3);
    const alerts = await request(server).get('/notifications').set(admin.auth).expect(200);
    expect(JSON.stringify(alerts.body)).toContain('colis jamais pris en charge');
    // Quatre jours plus tard le transporteur simulé a livré : la réception est présumée et le vendeur payé
    const r2 = await payments.runEscrowSchedule(new Date(Date.now() + 4 * 86_400_000));
    expect(r2.confirmed).toBeGreaterThanOrEqual(1);
    expect((await transactions.findOne({ where: { id: tx.id } }))!.status).toBe('confirme');
  });

  it("argent : colis déposé (bon d'envoi Trocoin) sans clic « Confirmer l'expédition » → expédié à l'échéance, pas remboursé", async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 60 });
    const res = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: TEST_ADDRESS }).expect(201);
    const tx = (res.body.transaction ?? res.body) as Transaction;
    await request(server).post(`/transactions/${tx.id}/confirm-availability`).set(seller.auth).expect(200);
    const sender = { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', phone: '06 11 22 33 44' };
    await request(server).post(`/transactions/${tx.id}/shipment`).set(seller.auth).send({ sender }).expect(201);
    const r = await payments.runEscrowSchedule(new Date(Date.now() + 30 * 86_400_000));
    expect(r.cancelled).toBe(0);
    const after = (await transactions.findOne({ where: { id: tx.id } }))!;
    expect(after.status).toBe('livree');
    expect(after.shippedAt).toBeTruthy();
    expect(after.deliveryTrackingNumber).toMatch(/^SIM/);
  });

  it('argent : au plus trois pages de paiement ouvertes par acheteur ; avis publics sans identifiants internes', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    provider.setHosted(true);
    try {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const l = await createListing(app, seller, { price: 20 + i, deliveryAvailable: false });
        const r = await request(server).post('/transactions').set(buyer.auth).send({ listingId: l.id, deliveryMethod: 'main_propre' }).expect(201);
        expect((r.body.transaction ?? r.body).status).toBe('en_attente');
        ids.push((r.body.transaction ?? r.body).id);
      }
      const fourth = await createListing(app, seller, { price: 30, deliveryAvailable: false });
      const refused = await request(server).post('/transactions').set(buyer.auth).send({ listingId: fourth.id, deliveryMethod: 'main_propre' }).expect(400);
      expect(refused.body.message).toContain('3 paiements en cours');
      await request(server).post(`/transactions/${ids[0]}/abandon`).set(buyer.auth).expect(200);
      await request(server).post('/transactions').set(buyer.auth).send({ listingId: fourth.id, deliveryMethod: 'main_propre' }).expect(201);
    } finally {
      provider.setHosted(false);
    }
    const reviews = await request(server).get(`/users/${seller.id}/reviews`).expect(200);
    expect(Array.isArray(reviews.body)).toBe(true);
    for (const r of reviews.body) {
      expect(r.transactionId).toBeUndefined();
      expect(r.reviewerId).toBeUndefined();
    }
  });
});
