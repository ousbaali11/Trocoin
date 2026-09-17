import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { ConversationsService } from '../src/conversations/conversations.service';
import { Message } from '../src/conversations/message.entity';
import { createApp, createListing, login, TEST_ADDRESS } from './utils';

/**
 * Phase 37 (AUDIT §60) : proposition de prix acceptée = prix payé ; tout évènement de conversation est diffusé en
 * direct, quel que soit son chemin ; failles relevées par l'audit de sécurité refermées (code de remise, adresse de
 * l'acheteur avant paiement, données du vendeur vues par l'acheteur, bon d'envoi après annulation, statut d'annonce
 * pendant une vente ou une vérification, suppression pendant une vente, double confirmation).
 */
describe('Phase 37 : prix négocié, diffusion en direct, failles refermées', () => {
  let app: INestApplication;
  let server: any;
  let conversations: ConversationsService;
  let messages: Repository<Message>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    conversations = app.get(ConversationsService);
    messages = app.get(getRepositoryToken(Message));
  });
  afterAll(() => app.close());

  async function negotiate(price: number, offer: number) {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price, title: 'Noix de coco décorative' });
    const conv = (await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Bonjour, est-ce toujours disponible ?' }).expect(201)).body;
    const msg = (await request(server).post(`/conversations/${conv.id}/offers`).set(buyer.auth).send({ amount: offer }).expect(201)).body;
    return { seller, buyer, listing, conv, offerId: msg.id as string };
  }

  it('proposition acceptée : devis et paiement au prix négocié pour CET acheteur seulement ; commission et versement sur ce prix ; expirée, le prix affiché revient', async () => {
    const { seller, buyer, listing, conv, offerId } = await negotiate(20, 15);
    const other = await login(app);
    // En attente : rien ne change
    expect((await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(buyer.auth).expect(200)).body).toMatchObject({ price: 20, buyerTotal: 21.5 });
    await request(server).post(`/conversations/${conv.id}/offers/${offerId}`).set(seller.auth).send({ decision: 'acceptee' }).expect(201);

    const quote = (await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(buyer.auth).expect(200)).body;
    expect(quote).toMatchObject({ price: 15, buyerFee: 1.25, buyerTotal: 16.25, commission: 1.2, sellerPayout: 13.8, listPrice: 20, offer: { id: offerId, amount: 15 } });
    // Un autre membre, ou un visiteur, voit toujours le prix affiché
    expect((await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(other.auth).expect(200)).body).toMatchObject({ price: 20, buyerTotal: 21.5 });
    expect((await request(server).get(`/transactions/quote?listingId=${listing.id}`).expect(200)).body.offer).toBeUndefined();
    // La conversation dit à l'acheteur qu'il peut payer ce prix
    expect((await request(server).get(`/conversations/${conv.id}`).set(buyer.auth).expect(200)).body.acceptedOffer).toMatchObject({ id: offerId, amount: 15 });

    // Le total attendu à l'ancien prix est refusé (rien n'est débité), le bon passe ; la vente porte le prix négocié
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, expectedTotal: 21.5 }).expect(409);
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, expectedTotal: 16.25 }).expect(201);
    const tx = created.body.transaction ?? created.body;
    expect(tx).toMatchObject({ amount: 15, listPrice: 20, commission: 1.2, buyerFee: 1.25 });
    const detail = (await request(server).get(`/conversations/${conv.id}`).set(seller.auth).expect(200)).body;
    expect(detail.messages.find((m: any) => m.systemEvent === 'achat_confirme').meta).toMatchObject({ price: 15, listPrice: 20, amount: 16.25 });

    // Expiration : une proposition acceptée il y a plus de 72 h ne vaut plus
    const late = await negotiate(50, 40);
    await request(server).post(`/conversations/${late.conv.id}/offers/${late.offerId}`).set(late.seller.auth).send({ decision: 'acceptee' }).expect(201);
    expect((await request(server).get(`/transactions/quote?listingId=${late.listing.id}`).set(late.buyer.auth).expect(200)).body.price).toBe(40);
    await messages.update(late.offerId, { offerAnsweredAt: new Date(Date.now() - 73 * 3_600_000) });
    const expired = (await request(server).get(`/transactions/quote?listingId=${late.listing.id}`).set(late.buyer.auth).expect(200)).body;
    expect(expired.price).toBe(50);
    expect(expired.offer).toBeUndefined();
    // Proposition refusée, ou supérieure au prix : jamais un prix de vente
    const refused = await negotiate(30, 25);
    await request(server).post(`/conversations/${refused.conv.id}/offers/${refused.offerId}`).set(refused.seller.auth).send({ decision: 'refusee' }).expect(201);
    expect((await request(server).get(`/transactions/quote?listingId=${refused.listing.id}`).set(refused.buyer.auth).expect(200)).body.price).toBe(30);
  });

  it('diffusion en direct : message par route HTTP, proposition, réponse, message automatique — chacun émet un évènement pour la conversation et les deux boîtes', async () => {
    const events: Array<{ kind: string; type: string; status?: string }> = [];
    conversations.onMessageEvent((e) => events.push({ kind: e.kind, type: e.message.type, status: e.message.offerStatus ?? undefined }));
    const { seller, buyer, listing, conv, offerId } = await negotiate(60, 50);
    // (le premier message et la proposition de `negotiate` ont été créés avant la lecture ci-dessous)
    expect(events.filter((e) => e.kind === 'new').map((e) => e.type)).toEqual(['text', 'offer']);
    events.length = 0;
    await request(server).post(`/conversations/${conv.id}/messages`).set(seller.auth).send({ content: 'Oui, toujours disponible.' }).expect(201);
    const second = (await request(server).post(`/conversations/${conv.id}/offers`).set(buyer.auth).send({ amount: 55 }).expect(201)).body;
    await request(server).post(`/conversations/${conv.id}/offers/${second.id}`).set(seller.auth).send({ decision: 'acceptee' }).expect(201);
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
    expect(events).toEqual([
      { kind: 'new', type: 'text', status: undefined },
      { kind: 'update', type: 'offer', status: 'retiree' }, // l'ancienne proposition, remplacée
      { kind: 'new', type: 'offer', status: 'en_attente' },
      { kind: 'update', type: 'offer', status: 'acceptee' },
      { kind: 'new', type: 'system', status: undefined },
    ]);
    expect(offerId).toBeTruthy();
  });

  it('code de remise : aucune route d\'action ne le renvoie au vendeur ; 5 codes faux → vente verrouillée une heure', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 40 });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
    const tx = created.body.transaction ?? created.body;
    expect(tx.handoverCode).toMatch(/^\d{6}$/); // l'acheteur le reçoit
    const asSeller = [
      await request(server).post(`/transactions/${tx.id}/confirm-availability`).set(seller.auth).expect(200),
      await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({}).expect(201),
      await request(server).get(`/transactions/${tx.id}`).set(seller.auth).expect(200),
      await request(server).get('/transactions/mine').set(seller.auth).expect(200),
    ];
    for (const res of asSeller) {
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(tx.handoverCode);
      expect(body).not.toMatch(/"handoverCode":"|providerPaymentId|"transferId"/);
    }
    const wrong = tx.handoverCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) await request(server).post(`/transactions/${tx.id}/handover`).set(seller.auth).send({ code: wrong }).expect(400);
    const locked = await request(server).post(`/transactions/${tx.id}/handover`).set(seller.auth).send({ code: tx.handoverCode }).expect(400);
    expect(locked.body.message).toMatch(/Trop de codes incorrects/);
  });

  it('double action : une vente confirmée ne peut plus être annulée ni reconfirmée ; deux confirmations simultanées → une seule aboutit', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 25 });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
    const id = (created.body.transaction ?? created.body).id;
    const results = await Promise.all([request(server).post(`/transactions/${id}/confirm-delivery`).set(buyer.auth), request(server).post(`/transactions/${id}/confirm-delivery`).set(buyer.auth)]);
    expect(results.map((r) => r.status).sort()).not.toEqual([201, 201]);
    expect(results.some((r) => r.status === 201)).toBe(true);
    await request(server).post(`/transactions/${id}/cancel`).set(buyer.auth).expect(400);
    const detail = (await request(server).get('/conversations').set(seller.auth).expect(200)).body[0];
    const conv = (await request(server).get(`/conversations/${detail.id}`).set(seller.auth).expect(200)).body;
    expect(conv.messages.filter((m: any) => m.systemEvent === 'reception_confirmee')).toHaveLength(1);
  });

  it('vues par rôle : adresse de l\'acheteur invisible du vendeur avant paiement ; l\'acheteur ne voit ni l\'adresse ni le téléphone du vendeur sur l\'expédition ; bon d\'envoi retiré après annulation', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 35, weightGrams: 700 });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: { ...TEST_ADDRESS, phone: '06 12 34 56 78' } }).expect(201);
    const id = (created.body.transaction ?? created.body).id;
    expect((await request(server).get(`/transactions/${id}`).set(seller.auth).expect(200)).body.shippingAddress).toMatchObject({ line1: TEST_ADDRESS.line1 }); // payée : visible
    await request(server).post(`/transactions/${id}/confirm-availability`).set(seller.auth).expect(200);
    const sender = { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', phone: '06 11 22 33 44' };
    await request(server).post(`/transactions/${id}/shipment`).set(seller.auth).send({}).expect(400); // expéditeur requis (plus d'erreur 500)
    await request(server).post(`/transactions/${id}/shipment`).set(seller.auth).send({ sender }).expect(201);
    const buyerView = JSON.stringify((await request(server).get(`/transactions/${id}/shipment`).set(buyer.auth).expect(200)).body);
    expect(buyerView).not.toContain('12 rue de la République');
    expect(buyerView).not.toMatch(/611223344|providerRef|offerCode/);
    expect(buyerView).toMatch(/trackingNumber/);
    expect(JSON.stringify((await request(server).get(`/transactions/${id}/shipment`).set(seller.auth).expect(200)).body)).toContain('12 rue de la République');
    await request(server).get(`/transactions/${id}/shipment/label.pdf`).set(seller.auth).expect(200);
    await request(server).post(`/transactions/${id}/cancel`).set(buyer.auth).expect(201);
    await request(server).get(`/transactions/${id}/shipment/label.pdf`).set(seller.auth).expect(400);
  });

  it('statut d\'annonce : ni pause ni renouvellement depuis « en vérification » ; ni pause, ni remise en ligne, ni suppression pendant une vente payée', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    // Texte signalé par la modération automatique → en vérification
    const flagged = await createListing(app, seller, { title: 'Téléphone neuf', description: 'Paiement par Western Union uniquement, contactez-moi sur WhatsApp au plus vite pour conclure.' });
    if (flagged.status === 'en_attente') {
      await request(server).patch(`/listings/${flagged.id}`).set(seller.auth).send({ status: 'desactivee' }).expect(400);
      await request(server).post(`/listings/${flagged.id}/renew`).set(seller.auth).expect(400);
    }
    const listing = await createListing(app, seller, { price: 45 });
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
    for (const status of ['desactivee', 'en_ligne']) {
      const res = await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ status }).expect(400);
      expect(res.body.message).toMatch(/Une vente est en cours/);
    }
    await request(server).post(`/listings/${listing.id}/renew`).set(seller.auth).expect(400);
    expect((await request(server).delete(`/listings/${listing.id}`).set(seller.auth).expect(400)).body.message).toMatch(/Une vente est en cours/);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('vendue');
  });
});
