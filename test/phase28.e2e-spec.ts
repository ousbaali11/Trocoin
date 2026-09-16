import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login, makeAdmin } from './utils';

/**
 * Phase 28 (AUDIT §46) : préférence « pas de paiement sécurisé sur mes annonces » (réglable par le vendeur) et
 * indicateur interne « compte de démonstration » (admin) — numéro jamais révélé, aucun paiement en ligne.
 */
describe('Phase 28 : paiement sécurisé désactivable par le vendeur, comptes de démonstration', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('vendeur qui retire le paiement sécurisé : devis non éligible avec motif, achat refusé (400), le numéro reste révélable ; réactivable', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 80 });
    expect((await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(buyer.auth).expect(200)).body.eligible).toBe(true);
    await request(server).patch('/users/me').set(seller.auth).send({ securePaymentDisabled: true }).expect(200);
    expect((await request(server).get('/users/me').set(seller.auth).expect(200)).body.securePaymentDisabled).toBe(true);
    const quote = await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(buyer.auth).expect(200);
    expect(quote.body.eligible).toBe(false);
    expect(quote.body.reason).toMatch(/ne propose pas le paiement sécurisé/);
    const refused = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(400);
    expect(refused.body.message).toMatch(/ne propose pas le paiement sécurisé/);
    // Le numéro suit sa propre préférence (affiché par défaut)
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.phoneAvailable).toBe(true);
    await request(server).post(`/listings/${listing.id}/phone`).set(buyer.auth).expect(200);
    await request(server).patch('/users/me').set(seller.auth).send({ securePaymentDisabled: false }).expect(200);
    expect((await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(buyer.auth).expect(200)).body.eligible).toBe(true);
  });

  it('compte de démonstration (admin) : indicateur visible de l\'admin seulement, numéro jamais révélé même si affiché, aucun paiement en ligne, messagerie normale', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);
    const listing = await createListing(app, seller, { price: 120 });
    // Un membre ne peut pas se marquer lui-même
    await request(server).patch('/users/me').set(seller.auth).send({ isDemoAccount: true }).expect(200);
    expect((await request(server).get(`/admin/users/${seller.id}`).set(admin.auth).expect(200)).body.isDemoAccount).toBe(false);
    // L'admin marque le compte
    await request(server).patch(`/admin/users/${seller.id}`).set(admin.auth).send({ isDemoAccount: true }).expect(200);
    const view = await request(server).get(`/admin/users/${seller.id}`).set(admin.auth).expect(200);
    expect(view.body.isDemoAccount).toBe(true);
    const list = await request(server).get(`/admin/users?q=${encodeURIComponent(seller.phone)}`).set(admin.auth).expect(200);
    expect(list.body.items[0].isDemoAccount).toBe(true);
    // Public : rien ne le signale, mais le numéro est masqué et l'achat impossible
    const pub = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(pub.body.phoneAvailable).toBe(false);
    expect(JSON.stringify(pub.body)).not.toContain('isDemoAccount');
    expect(JSON.stringify((await request(server).get(`/users/${seller.id}/profile`).expect(200)).body)).not.toContain('isDemoAccount');
    await request(server).post(`/listings/${listing.id}/phone`).set(buyer.auth).expect(404);
    const quote = await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(buyer.auth).expect(200);
    expect(quote.body.eligible).toBe(false);
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(400);
    // La messagerie fonctionne : le visiteur écrit, le compte de démonstration peut répondre
    const conv = await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Bonjour, est-ce toujours disponible ?' }).expect(201);
    await request(server).post(`/conversations/${conv.body.id}/messages`).set(seller.auth).send({ content: 'Oui, toujours disponible.' }).expect(201);
    const detail = await request(server).get(`/conversations/${conv.body.id}`).set(buyer.auth).expect(200);
    expect(detail.body.messages.map((m: any) => m.content)).toContain('Oui, toujours disponible.');
    // Journal : l'action admin est tracée
    const log = await request(server).get(`/admin/audit-log?target_id=${seller.id}&action=user.update`).set(admin.auth).expect(200);
    expect(JSON.stringify(log.body.items)).toContain('isDemoAccount');
  });
});
