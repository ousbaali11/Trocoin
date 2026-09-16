import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AdminAuditLog } from '../src/admin/admin-audit-log.entity';
import { Listing } from '../src/listings/listing.entity';
import { CheckoutSync, CreateCheckoutParams, IPaymentProvider } from '../src/payments/payment-provider.interface';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { Transaction } from '../src/payments/transaction.entity';
import { createApp, createListing, login, makeAdmin, TestUser } from './utils';

/**
 * Phase 25 (AUDIT §40) : suppression admin bloquée par une vente expédiée ou un litige (suspension toujours
 * possible), annonces remises en ligne à la réactivation (sauf expirées), « urgent » / « whatsapp » en
 * pré-modération, moyen de paiement (PayPal via Stripe) relu et mémorisé sans rien supposer d'une carte.
 */
describe('Phase 25 : suppression bloquée, réactivation, pré-modération, PayPal via Stripe', () => {
  let app: INestApplication;
  let server: any;
  let txRepo: Repository<Transaction>;
  let listingRepo: Repository<Listing>;
  let auditRepo: Repository<AdminAuditLog>;
  let admin: TestUser;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    txRepo = app.get(getRepositoryToken(Transaction));
    listingRepo = app.get(getRepositoryToken(Listing));
    auditRepo = app.get(getRepositoryToken(AdminAuditLog));
    admin = await login(app);
    await makeAdmin(app, admin);
  });
  afterAll(() => app.close());

  const buy = async (delivery: 'colissimo' | 'main_propre', price = 40) => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price, deliveryAvailable: delivery !== 'main_propre' });
    const body = delivery === 'main_propre' ? { listingId: listing.id } : { listingId: listing.id, deliveryMethod: delivery, shippingAddress: { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' } };
    const created = await request(server).post('/transactions').set(buyer.auth).send(body).expect(201);
    return { seller, buyer, listing, tx: created.body.transaction as Transaction & { id: string } };
  };
  const del = (id: string) => request(server).delete(`/admin/users/${id}`).set(admin.auth).send({ reason: 'Fraude soupçonnée sur plusieurs ventes', confirm: 'SUPPRIMER' });

  it('suppression bloquée par une vente expédiée : message clair, suspension immédiate possible, suppression acceptée une fois la réception confirmée', async () => {
    const { seller, buyer, tx } = await buy('colissimo', 60);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000201' }).expect(201);
    const refused = await del(seller.id).expect(400);
    expect(refused.body.message).toMatch(/1 vente expédiée ou remise en attente de confirmation/);
    expect(refused.body.message).toMatch(/suspendez-le/);
    expect((await txRepo.findOne({ where: { id: tx.id } }))!.status).toBe('livree'); // rien n'a été remboursé
    // L'acheteur aussi est protégé : sa suppression est refusée pour la même raison
    expect((await del(buyer.id).expect(400)).body.message).toMatch(/expédiée/);
    // Suspension (réversible) tout de suite
    await request(server).patch(`/admin/users/${seller.id}`).set(admin.auth).send({ suspended: true, suspensionReason: 'Suspicion de fraude, vérification en cours' }).expect(200);
    await request(server).get('/users/me').set(seller.auth).expect(403);
    // L'acheteur confirme la réception : la vente est résolue, la suppression devient possible
    await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(buyer.auth).expect(201);
    const ok = await del(seller.id).expect(200);
    expect(ok.body).toMatchObject({ deleted: true, refundedTransactions: [] });
    await request(server).get(`/users/${seller.id}/profile`).expect(404);
  });

  it('suppression bloquée par une remise en main propre en attente du code, et par un litige ; une vente non expédiée est encore remboursée d\'office', async () => {
    const hand = await buy('main_propre', 30);
    await request(server).post(`/transactions/${hand.tx.id}/ship`).set(hand.seller.auth).send({}).expect(201); // « prêt pour la remise »
    expect((await del(hand.seller.id).expect(400)).body.message).toMatch(/remise en attente de confirmation/);
    const disputed = await buy('colissimo', 50);
    await request(server).post(`/transactions/${disputed.tx.id}/dispute`).set(disputed.buyer.auth).send({ reason: 'Vendeur injoignable.' }).expect(201);
    expect((await del(disputed.seller.id).expect(400)).body.message).toMatch(/1 litige en cours/);
    // Non expédiée : annulée et remboursée, puis compte supprimé
    const pending = await buy('colissimo', 20);
    const ok = await del(pending.seller.id).expect(200);
    expect(ok.body.refundedTransactions).toEqual([pending.tx.id]);
    expect((await txRepo.findOne({ where: { id: pending.tx.id } }))!.status).toBe('rembourse');
  });

  it('réactivation : les annonces mises en pause par la suspension reviennent en ligne, une annonce expirée entre-temps passe « expirée », une annonce mise en pause par le membre reste en pause', async () => {
    const user = await login(app);
    const live = await createListing(app, user, { title: 'Table basse en chêne massif' });
    const old = await createListing(app, user, { title: 'Lampe articulée de bureau' });
    const paused = await createListing(app, user, { title: 'Tapis berbère en laine' });
    await listingRepo.update(old.id, { expiresAt: new Date(Date.now() - 60_000) });
    await request(server).patch(`/listings/${paused.id}`).set(user.auth).send({ status: 'desactivee' }).expect(200);
    await request(server).patch(`/admin/users/${user.id}`).set(admin.auth).send({ suspended: true, suspensionReason: 'Vérification' }).expect(200);
    for (const id of [live.id, old.id]) {
      const l = (await listingRepo.findOne({ where: { id } }))!;
      expect(l.status).toBe('desactivee');
      expect(l.moderationReason).toBe('Compte suspendu');
    }
    await request(server).get(`/listings/${live.id}`).expect(404);
    await request(server).patch(`/admin/users/${user.id}`).set(admin.auth).send({ suspended: false }).expect(200);
    expect((await listingRepo.findOne({ where: { id: live.id } }))!.status).toBe('en_ligne');
    expect((await listingRepo.findOne({ where: { id: live.id } }))!.moderationReason).toBeNull();
    await request(server).get(`/listings/${live.id}`).expect(200);
    expect((await listingRepo.findOne({ where: { id: old.id } }))!.status).toBe('expiree');
    expect((await listingRepo.findOne({ where: { id: paused.id } }))!.status).toBe('desactivee'); // pause voulue par le membre
    const entries = await auditRepo.find({ where: { targetId: user.id, action: 'user.update' } });
    const reactivation = entries.find((e) => (e.details as any)?.suspended?.to === false);
    expect(reactivation!.details).toMatchObject({ suspended: { to: false }, listingsRestored: { republished: 1, expired: 1 } });
  });

  it('pré-modération : « urgent » et « whatsapp » (titre ou description) envoient l\'annonce en vérification ; une annonce ordinaire reste publiée directement', async () => {
    const user = await login(app);
    const urgent = await createListing(app, user, { title: 'iPhone 15 pas cher urgent' });
    expect(urgent.status).toBe('en_attente');
    expect(urgent.moderationReason).toMatch(/signaux d'arnaque/);
    const wa = await createListing(app, user, { title: 'Vélo de route carbone', description: 'Etat neuf, contactez moi sur WhatsApp pour aller plus vite, pas de messagerie ici.' });
    expect(wa.status).toBe('en_attente');
    expect(wa.moderationReason).toMatch(/signaux d'arnaque/);
    await request(server).get(`/listings/${wa.id}`).expect(404);
    const fine = await createListing(app, user, { title: 'Chaise de bureau ergonomique', description: 'Reglable en hauteur, accoudoirs, tres bon etat general, a retirer sur place.' });
    expect(fine.status).toBe('en_ligne');
  });

  it('PayPal via Stripe : le moyen de paiement relu à l\'autorisation est mémorisé (paypal) et visible du membre et de l\'admin, rien ne dépend d\'une carte', async () => {
    const provider = app.get<IPaymentProvider>(PAYMENT_PROVIDER);
    const sessions = new Map<string, CreateCheckoutParams>();
    provider.createCheckout = async (params) => { const id = `cs_paypal_${sessions.size + 1}`; sessions.set(id, params); return { providerSessionId: id, checkoutUrl: `https://checkout.example.test/${id}`, expiresAt: new Date(Date.now() + 30 * 60_000) }; };
    provider.syncCheckout = async (id): Promise<CheckoutSync> => ({ status: 'sequestre', providerPaymentId: `pi_${id}`, paymentMethodType: 'paypal', captureBefore: new Date(Date.now() + 10 * 86_400_000) });
    try {
      const seller = await login(app);
      const buyer = await login(app);
      const listing = await createListing(app, seller, { price: 35 });
      const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
      expect(created.body.transaction.status).toBe('en_attente');
      expect([...sessions.values()][0].sellerConnectedAccountId).toBeUndefined(); // charge plateforme, aucune restriction de moyen
      const view = await request(server).get(`/transactions/${created.body.transaction.id}`).set(buyer.auth).expect(200);
      expect(view.body.status).toBe('sequestre');
      expect(view.body.paymentMethod).toBe('paypal');
      expect(view.body.escrowModel).toBe('platform');
      const detail = await request(server).get(`/admin/transactions/${created.body.transaction.id}`).set(admin.auth).expect(200);
      expect(detail.body.paymentMethod).toBe('paypal');
    } finally {
      delete (provider as Partial<IPaymentProvider>).createCheckout;
      delete (provider as Partial<IPaymentProvider>).syncCheckout;
    }
  });
});
