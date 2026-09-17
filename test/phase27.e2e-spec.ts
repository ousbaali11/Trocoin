import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login, makeAdmin, TestUser } from './utils';

/**
 * Phase 27 (audit final, AUDIT §42) : balayage des autorisations — un membre ne peut agir que sur ses propres
 * données. Pour chaque route portant un identifiant de ressource, un tiers connecté obtient un refus (403 ou
 * 404, jamais 200) et la ressource n'est pas modifiée ; un membre ordinaire n'atteint aucune route admin.
 */
describe('Phase 27 : autorisations sur les ressources (balayage IDOR)', () => {
  let app: INestApplication;
  let server: any;
  let seller: TestUser;
  let buyer: TestUser;
  let stranger: TestUser;
  let listingId: string;
  let otherListingId: string;
  let txId: string;
  let convId: string;
  let savedSearchId: string;
  let notificationId: string;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    seller = await login(app);
    buyer = await login(app);
    stranger = await login(app);
    listingId = (await createListing(app, seller, { title: 'VTT électrique de test', price: 300, deliveryAvailable: true })).id;
    otherListingId = (await createListing(app, seller, { title: 'Canapé de test' })).id;
    const tx = await request(server).post('/transactions').set(buyer.auth).send({ listingId, deliveryMethod: 'colissimo', shippingAddress: { name: 'Nora Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' } }).expect(201);
    txId = tx.body.transaction.id;
    await request(server).post(`/transactions/${txId}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000601' }).expect(201);
    convId = (await request(server).post('/conversations').set(buyer.auth).send({ listingId: otherListingId, message: 'Bonjour, toujours disponible ?' }).expect(201)).body.id;
    savedSearchId = (await request(server).post('/users/me/saved-searches').set(buyer.auth).send({ name: 'VTT Lyon', query: { q: 'vtt' } }).expect(201)).body.id;
    const notifs = await request(server).get('/notifications').set(seller.auth).expect(200);
    notificationId = (notifs.body.items ?? notifs.body)[0].id;
  });
  afterAll(() => app.close());

  const denied = (status: number, label = '') => expect(`${label} → ${status}`).toMatch(/→ (403|404)$/);

  it('transactions et expédition : un tiers ne voit ni ne modifie la vente des autres', async () => {
    const routes: Array<[string, string, unknown?]> = [
      ['get', `/transactions/${txId}`],
      ['post', `/transactions/${txId}/ship`, { trackingNumber: '6A00000000602' }],
      ['post', `/transactions/${txId}/confirm-delivery`],
      ['post', `/transactions/${txId}/handover`, { code: '123456' }],
      ['post', `/transactions/${txId}/cancel`],
      ['post', `/transactions/${txId}/dispute`, { reason: 'Tentative de tiers sur une vente qui ne le concerne pas.' }],
      ['post', `/transactions/${txId}/review`, { rating: 1, comment: 'Tiers' }],
      ['get', `/transactions/${txId}/shipment`],
      ['post', `/transactions/${txId}/shipment/quote`, { weightGrams: 1000 }],
      ['get', `/transactions/${txId}/shipment/relay-points?postalCode=75017&city=Paris`],
      ['post', `/transactions/${txId}/shipment`, { mode: 'domicile', weightGrams: 1000 }],
      ['get', `/transactions/${txId}/shipment/label.pdf`],
      ['get', `/transactions/${txId}/shipment/tracking`],
    ];
    for (const [method, url, body] of routes) {
      const res = await (request(server) as any)[method](url).set(stranger.auth).send(body);
      denied(res.status, `${method.toUpperCase()} ${url}`);
    }
    const after = await request(server).get(`/transactions/${txId}`).set(buyer.auth).expect(200);
    expect(after.body.status).toBe('livree');
    // Sans jeton : 401 partout
    await request(server).get(`/transactions/${txId}`).expect(401);
    await request(server).get('/transactions/mine').expect(401);
  });

  it('annonces : un tiers ne modifie, ne renouvelle, ne duplique, ne promeut ni ne supprime l\'annonce d\'un autre ; la liste « mes annonces » et les statistiques sont propres à chacun', async () => {
    const routes: Array<[string, string, unknown?]> = [
      ['patch', `/listings/${otherListingId}`, { title: 'Titre modifié par un tiers' }],
      ['post', `/listings/${otherListingId}/renew`],
      ['post', `/listings/${otherListingId}/duplicate`],
      ['post', `/listings/${otherListingId}/promote`, { type: 'boost' }],
      ['patch', `/listings/${otherListingId}/photos/order`, { photoIds: [] }],
      ['delete', `/listings/${otherListingId}/photos/00000000-0000-4000-8000-000000000000`],
      ['delete', `/listings/${otherListingId}`],
    ];
    for (const [method, url, body] of routes) {
      const res = await (request(server) as any)[method](url).set(stranger.auth).send(body);
      denied(res.status, `${method.toUpperCase()} ${url}`);
    }
    const still = await request(server).get(`/listings/${otherListingId}`).expect(200);
    expect(still.body.title).toBe('Canapé de test');
    const mine = await request(server).get('/listings/mine').set(stranger.auth).expect(200);
    expect((mine.body.items ?? mine.body).map((l: any) => l.id)).not.toContain(otherListingId);
    const stats = await request(server).get('/listings/mine/stats').set(stranger.auth).expect(200);
    expect(JSON.stringify(stats.body)).not.toContain(otherListingId);
  });

  it('messagerie, recherches sauvegardées, notifications : inaccessibles aux tiers', async () => {
    const routes: Array<[string, string, unknown?]> = [
      ['get', `/conversations/${convId}`],
      ['get', `/conversations/${convId}/messages`],
      ['post', `/conversations/${convId}/messages`, { content: 'Intrusion' }],
      ['post', `/conversations/${convId}/offers`, { amount: 10 }],
      ['delete', `/conversations/${convId}`],
      ['get', `/users/me/saved-searches/${savedSearchId}/results`],
      ['patch', `/users/me/saved-searches/${savedSearchId}`, { name: 'Volée' }],
      ['delete', `/users/me/saved-searches/${savedSearchId}`],
      ['post', `/notifications/${notificationId}/read`],
    ];
    for (const [method, url, body] of routes) {
      const res = await (request(server) as any)[method](url).set(stranger.auth).send(body);
      denied(res.status, `${method.toUpperCase()} ${url}`);
    }
    const conv = await request(server).get(`/conversations/${convId}`).set(buyer.auth).expect(200);
    expect(conv.body.messages.some((m: any) => m.content === 'Intrusion')).toBe(false);
    expect((await request(server).get('/users/me/saved-searches').set(buyer.auth).expect(200)).body.map((s: any) => s.id)).toContain(savedSearchId);
    const notifs = await request(server).get('/notifications').set(seller.auth).expect(200);
    expect((notifs.body.items ?? notifs.body).find((n: any) => n.id === notificationId).readAt).toBeNull();
  });

  it('console admin : chaque route refuse un membre ordinaire (403) et un anonyme (401) ; un admin y accède', async () => {
    const admin = await login(app);
    await makeAdmin(app, admin);
    const routes: Array<[string, string, unknown?]> = [
      ['get', '/admin/stats'], ['get', '/admin/users'], ['get', `/admin/users/${seller.id}`], ['patch', `/admin/users/${seller.id}`, { city: 'Lyon' }],
      ['post', `/admin/users/${seller.id}/reset-password`], ['delete', `/admin/users/${seller.id}`, { reason: 'Tentative', confirm: 'SUPPRIMER' }],
      ['get', '/admin/listings'], ['get', `/admin/listings/${listingId}`], ['patch', `/admin/listings/${listingId}`, { status: 'refusee' }], ['delete', `/admin/listings/${listingId}`, { reason: 'Tentative', confirm: 'SUPPRIMER' }],
      ['get', '/admin/reports'], ['get', '/admin/transactions'], ['get', `/admin/transactions/${txId}`], ['post', `/admin/transactions/${txId}/resolve`, { decision: 'rembourser', note: 'Tentative de tiers' }],
      ['get', '/admin/settings'], ['patch', '/admin/settings', { monetization_enabled: true }], ['get', '/admin/plans'], ['get', '/admin/pages'], ['get', '/admin/audit-log'],
    ];
    for (const [method, url, body] of routes) {
      expect((await (request(server) as any)[method](url).set(buyer.auth).send(body)).status).toBe(403);
      expect((await (request(server) as any)[method](url).send(body)).status).toBe(401);
    }
    await request(server).get('/admin/stats').set(admin.auth).expect(200);
    expect((await request(server).get(`/transactions/${txId}`).set(buyer.auth).expect(200)).body.status).toBe('livree');
    expect((await request(server).get(`/listings/${listingId}`).expect(200)).body.status).toBe('vendue'); // AUDIT §58 : payée, donc « vendue » ; aucune route admin refusée ne l'a modifiée
  });

  it('numéro du vendeur : réservé aux connectés (le throttling, désactivé dans les tests, est posé sur la route : 30 / heure)', async () => {
    // Annonce en ligne (celle du balayage est « vendue » depuis son paiement : son numéro n'est plus communiqué)
    const online = (await createListing(app, seller, { title: 'Casque de vélo de test', price: 25 })).id;
    await request(server).post(`/listings/${online}/phone`).expect(401);
    const first = await request(server).post(`/listings/${online}/phone`).set(stranger.auth);
    expect([200, 201]).toContain(first.status);
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'listings', 'listings.controller.ts'), 'utf8');
    expect(src).toMatch(/@Throttle\(\{ default: \{ limit: 30, ttl: 3_600_000 \} \}\)\s*\n\s*@Post\(':id\/phone'\)/);
  });
});
