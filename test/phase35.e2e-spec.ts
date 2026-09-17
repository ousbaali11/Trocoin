import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { PaymentsService } from '../src/payments/payments.service';
import { Transaction } from '../src/payments/transaction.entity';
import { createApp, createListing, login } from './utils';

/**
 * Phase 35 (AUDIT §58) : cycle de vie de l'annonce pendant une vente. Payée → « vendue » (hors résultats, plus
 * achetable, toujours consultable) ; vente annulée → elle reste « vendue » et le vendeur la remet en ligne ; article
 * reçu → annonce supprimée automatiquement (la vente garde sa trace). Réception présumée → supprimée seulement à la
 * fin de la fenêtre de litige.
 */
describe('Phase 35 : annonce « vendue » dès le paiement, remise en ligne après annulation, supprimée à la réception', () => {
  let app: INestApplication;
  let server: any;
  let payments: PaymentsService;
  let transactions: Repository<Transaction>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    payments = app.get(PaymentsService);
    transactions = app.get(getRepositoryToken(Transaction));
  });
  afterAll(() => app.close());

  const inSearch = async (id: string, title: string) => (await request(server).get(`/listings?q=${encodeURIComponent(title)}`).expect(200)).body.items.some((l: any) => l.id === id);

  it('achat payé : annonce « vendue », hors résultats, plus achetable ni remise en ligne tant que la vente court ; toujours consultable', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const other = await login(app);
    const listing = await createListing(app, seller, { price: 50, title: 'Trottinette électrique pliable Xiaomi' });
    expect(await inSearch(listing.id, 'Trottinette électrique pliable')).toBe(true);
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);

    const pub = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(pub.body.status).toBe('vendue');
    expect(await inSearch(listing.id, 'Trottinette électrique pliable')).toBe(false);
    await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(other.auth).expect(404);
    await request(server).post('/transactions').set(other.auth).send({ listingId: listing.id }).expect(404);
    // Le vendeur ne peut pas la remettre en ligne pendant la vente (le même objet serait payable deux fois)
    const relist = await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ status: 'en_ligne' }).expect(400);
    expect(relist.body.message).toMatch(/Une vente est en cours sur cette annonce/);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('vendue');
  });

  it('annulation par l\'acheteur : l\'annonce reste « vendue », le vendeur est invité à la remettre en ligne et le peut en un appel ; elle redevient achetable', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 35, title: 'Appareil photo argentique Minolta' });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
    const txId = (created.body.transaction ?? created.body).id;
    await request(server).post(`/transactions/${txId}/cancel`).set(buyer.auth).expect(201);
    // Pas de remise en ligne automatique : le vendeur a pu vendre l'objet ailleurs entre-temps
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('vendue');
    expect(await inSearch(listing.id, 'Appareil photo argentique')).toBe(false);
    const notifs = (await request(server).get('/notifications').set(seller.auth).expect(200)).body;
    expect(JSON.stringify(notifs)).toMatch(/remettez-la en ligne depuis Mes annonces/);
    // La vente annulée garde le lien vers l'annonce, encore « vendue » (le site y accroche le bouton de remise en ligne)
    expect((await request(server).get(`/transactions/${txId}`).set(seller.auth).expect(200)).body.listing).toMatchObject({ id: listing.id, status: 'vendue' });
    await request(server).patch(`/listings/${listing.id}`).set(buyer.auth).send({ status: 'en_ligne' }).expect(403);
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ status: 'en_ligne' }).expect(200);
    expect(await inSearch(listing.id, 'Appareil photo argentique')).toBe(true);
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
  });

  it('réception confirmée par l\'acheteur : annonce supprimée automatiquement, la vente et la conversation gardent leur trace', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 80, deliveryAvailable: true, title: 'Machine à pain Moulinex' });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: { name: 'Nora Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' } }).expect(201);
    const txId = (created.body.transaction ?? created.body).id;
    await request(server).post(`/transactions/${txId}/ship`).set(seller.auth).send({ trackingNumber: '6A12345678901' }).expect(201);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('vendue');
    await request(server).post(`/transactions/${txId}/confirm-delivery`).set(buyer.auth).expect(201);

    await request(server).get(`/listings/${listing.id}`).expect(404);
    await request(server).get(`/listings/${listing.id}`).set(seller.auth).expect(404);
    expect((await request(server).get('/listings/mine').set(seller.auth).expect(200)).body.some((l: any) => l.id === listing.id)).toBe(false);
    const tx = (await request(server).get(`/transactions/${txId}`).set(seller.auth).expect(200)).body;
    expect(tx).toMatchObject({ status: 'confirme', listing: null, listingTitle: 'Machine à pain Moulinex' });
    const convs = (await request(server).get('/conversations').set(buyer.auth).expect(200)).body;
    expect(convs).toHaveLength(1);
    const conv = (await request(server).get(`/conversations/${convs[0].id}`).set(buyer.auth).expect(200)).body;
    expect(conv.listing).toBeNull();
    expect(conv.messages.map((m: any) => m.systemEvent)).toEqual(['achat_confirme', 'expedie', 'reception_confirmee']);
    expect(conv.transaction).toMatchObject({ id: txId, status: 'confirme' });
    // L'avis reste possible sur une vente dont l'annonce n'existe plus
    await request(server).post(`/transactions/${txId}/review`).set(buyer.auth).send({ rating: 5, comment: 'Parfait.' }).expect(201);
  });

  it('remise en main propre validée par le code : annonce supprimée', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 20 });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
    const tx = created.body.transaction ?? created.body;
    await request(server).post(`/transactions/${tx.id}/handover`).set(seller.auth).send({ code: tx.handoverCode }).expect(201);
    await request(server).get(`/listings/${listing.id}`).expect(404);
  });

  it('réception présumée : l\'annonce reste « vendue » pendant la fenêtre de litige, puis est supprimée ; remboursée entre-temps et remise en ligne par le vendeur, elle n\'est pas supprimée', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const mk = async (title: string) => {
      const listing = await createListing(app, seller, { price: 60, deliveryAvailable: true, title });
      const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: { name: 'Nora Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' } }).expect(201);
      const txId = (created.body.transaction ?? created.body).id as string;
      await request(server).post(`/transactions/${txId}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000001' }).expect(201);
      await transactions.update(txId, { autoConfirmAt: new Date(Date.now() - 60_000) });
      return { listing, txId };
    };
    const a = await mk('Robot pâtissier Kenwood');
    const b = await mk('Yaourtière Seb Multidélices');
    await payments.runEscrowSchedule(new Date());
    for (const x of [a, b]) {
      expect((await request(server).get(`/transactions/${x.txId}`).set(buyer.auth).expect(200)).body).toMatchObject({ status: 'confirme', autoResolution: 'reception_presumee' });
      expect((await request(server).get(`/listings/${x.listing.id}`).expect(200)).body.status).toBe('vendue'); // fenêtre de litige ouverte
    }
    // B : litige puis remboursement décidé par le médiateur ; le vendeur récupère l'article et remet l'annonce en ligne
    await request(server).post(`/transactions/${b.txId}/dispute`).set(buyer.auth).send({ reason: 'Colis jamais arrivé malgré la réception présumée.' }).expect(201);
    await payments.resolveDispute(b.txId, 'rembourser', 'Colis perdu par le transporteur.');
    expect((await request(server).get(`/listings/${b.listing.id}`).expect(200)).body.status).toBe('vendue');
    await request(server).patch(`/listings/${b.listing.id}`).set(seller.auth).send({ status: 'en_ligne' }).expect(200);
    // Fin de la fenêtre de litige
    await transactions.update(a.txId, { disputeAllowedUntil: new Date(Date.now() - 60_000) });
    await transactions.update(b.txId, { disputeAllowedUntil: new Date(Date.now() - 60_000) });
    await payments.runEscrowSchedule(new Date());
    await request(server).get(`/listings/${a.listing.id}`).expect(404);
    expect((await request(server).get(`/listings/${b.listing.id}`).expect(200)).body.status).toBe('en_ligne');
  });
});
