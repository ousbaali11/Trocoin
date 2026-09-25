import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { Listing } from '../src/listings/listing.entity';
import { Transaction } from '../src/payments/transaction.entity';
import { Review } from '../src/reviews/review.entity';
import { User } from '../src/users/user.entity';
import { buyShipped, createApp, createListing, login, makeAdmin, type TestUser } from './utils';

/**
 * Phase 45 (AUDIT §73, livraison 2) : autorisations et courses. Un vendeur suspendu revenait en ligne par un membre de sa
 * boutique (ou par l'approbation d'une annonce) et pouvait encaisser ; deux clics rapprochés achetaient deux étiquettes ;
 * deux envois simultanés créaient deux avis ; une formule payante s'activait gratuitement ; le vendeur gardait l'adresse de
 * l'acheteur après annulation ; « l'autre a effacé la conversation » était renvoyé au membre.
 */
describe('Phase 45 : vendeur suspendu, courses, formules payantes, fuites mineures', () => {
  let app: INestApplication;
  let server: any;
  let users: Repository<User>;
  let listings: Repository<Listing>;
  let transactions: Repository<Transaction>;
  let reviews: Repository<Review>;
  let admin: TestUser;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    users = app.get(getRepositoryToken(User));
    listings = app.get(getRepositoryToken(Listing));
    transactions = app.get(getRepositoryToken(Transaction));
    reviews = app.get(getRepositoryToken(Review));
    admin = await login(app);
    await makeAdmin(app, admin);
  });
  afterAll(async () => { await app.close(); });

  it('corps de requête trop volumineux : 413 clair (avant : « Erreur interne » 500) ; champs inconnus ignorés (userId, status, isDemoAccount)', async () => {
    const seller = await login(app);
    const huge = await request(server).post('/listings').set(seller.auth).set('Content-Type', 'application/json').send(JSON.stringify({ title: 'x', description: 'y'.repeat(600_000), categorySlug: 'ameublement', price: 1 }));
    expect(huge.status).toBe(413);
    expect(huge.body.message).toMatch(/volumineux/);
    const forged = await request(server).post('/listings').set(seller.auth).send({ title: 'Champs inconnus', description: 'Les champs inconnus sont ignorés, jamais appliqués.', categorySlug: 'ameublement', price: 10, status: 'vendue', userId: '00000000-0000-4000-8000-000000000000', isDemoAccount: true });
    expect(forged.status).toBe(201);
    const stored = (await listings.findOne({ where: { id: forged.body.id } }))!;
    expect(stored.userId).toBe(seller.id);
    expect(stored.status).not.toBe('vendue');
  });

  it('vendeur suspendu : son membre de boutique ne remet rien en ligne ni ne dépose en son nom, l\'admin ne peut pas approuver son annonce, un acheteur ne peut pas payer', async () => {
    const owner = await login(app);
    await request(server).post('/users/me/become-pro').set(owner.auth).send({ siret: '73282932000074', shopName: 'Boutique Suspendue' }).expect(201);
    const member = await login(app);
    await request(server).post('/users/me/shop/members').set(owner.auth).send({ phoneNumber: member.phone }).expect(201);
    const listing = await createListing(app, owner, { price: 30, title: 'Lampe de bureau' });
    const pending = await createListing(app, owner, { price: 20, title: 'Cadre photo' });
    await listings.update(pending.id, { status: 'en_attente' });
    // Avant la suspension : le membre gère bien la boutique
    await request(server).patch(`/listings/${listing.id}`).set(member.auth).send({ status: 'desactivee' }).expect(200);
    await request(server).patch(`/listings/${listing.id}`).set(member.auth).send({ status: 'en_ligne' }).expect(200);
    // Suspension par l'administration : annonces en pause, sessions révoquées
    await request(server).patch(`/admin/users/${owner.id}`).set(admin.auth).send({ suspended: true, suspensionReason: 'Vérification en cours' }).expect(200);
    expect((await listings.findOne({ where: { id: listing.id } }))!.status).toBe('desactivee');
    // Le membre ne peut plus la remettre en ligne, ni la renouveler, ni déposer au nom du propriétaire
    const republish = await request(server).patch(`/listings/${listing.id}`).set(member.auth).send({ status: 'en_ligne' });
    expect([400, 403]).toContain(republish.status);
    expect((await listings.findOne({ where: { id: listing.id } }))!.status).toBe('desactivee');
    const renew = await request(server).post(`/listings/${listing.id}/renew`).set(member.auth);
    expect([400, 403]).toContain(renew.status);
    const onBehalf = await request(server).post('/listings').set(member.auth).send({ title: 'Dépôt au nom du suspendu', description: 'Ne doit pas passer, le propriétaire est suspendu.', categorySlug: 'ameublement', price: 15, onBehalfOf: owner.id });
    expect([400, 403]).toContain(onBehalf.status);
    // L'administration ne peut pas approuver une annonce en vérification de ce compte
    const approve = await request(server).patch(`/admin/listings/${pending.id}`).set(admin.auth).send({ status: 'en_ligne' });
    expect(approve.status).toBe(400);
    expect(approve.body.message).toMatch(/suspendu/);
    // Une annonce restée en ligne par un autre chemin ne peut pas être payée
    await listings.update(listing.id, { status: 'en_ligne' });
    const buyer = await login(app);
    const quote = await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(buyer.auth).expect(200);
    expect(quote.body.eligible).toBe(false);
    expect(quote.body.reason).toMatch(/plus actif/);
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'main_propre' }).expect(400);
    // Levée de la suspension : le membre retrouve ses droits
    await request(server).patch(`/admin/users/${owner.id}`).set(admin.auth).send({ suspended: false }).expect(200);
    await request(server).patch(`/listings/${listing.id}`).set(member.auth).send({ status: 'desactivee' }).expect(200);
    await request(server).patch(`/listings/${listing.id}`).set(member.auth).send({ status: 'en_ligne' }).expect(200);
  });

  it('avis : deux envois simultanés → un seul avis, note recalculée depuis la table', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 25 });
    const body = await buyShipped(app, buyer, listing.id);
    const txId = (body.transaction ?? body).id as string;
    await transactions.update(txId, { status: 'confirme', confirmedAt: new Date() });
    await request(server).post(`/transactions/${txId}/review`).set(buyer.auth).send({ rating: 5, comment: 'Parfait' }).expect(201);
    const again = await request(server).post(`/transactions/${txId}/review`).set(buyer.auth).send({ rating: 1, comment: 'Doublon' });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/déjà laissé un avis/);
    // Deux envois vraiment simultanés passent tous deux la vérification applicative : c'est la base qui tranche (index unique)
    await expect(reviews.insert({ transactionId: txId, reviewerId: buyer.id, reviewedId: seller.id, rating: 1, comment: 'Doublon simultané' })).rejects.toThrow(/unique/i);
    expect(await reviews.count({ where: { transactionId: txId, reviewerId: buyer.id } })).toBe(1);
    const rated = (await users.findOne({ where: { id: seller.id } }))!;
    expect(rated.ratingCount).toBe(1);
    expect(rated.ratingAvg).toBe(5);
    // Second avis (par le vendeur, sur l'acheteur) : note de l'acheteur recalculée à part
    await request(server).post(`/transactions/${txId}/review`).set(seller.auth).send({ rating: 4, comment: 'Sérieux' }).expect(201);
    expect((await users.findOne({ where: { id: buyer.id } }))!.ratingCount).toBe(1);
  });

  it('bon d\'envoi : deux créations simultanées → une seule étiquette (201 puis 409)', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 120, deliveryAvailable: true, title: 'Enceinte Bluetooth' });
    const body = await buyShipped(app, buyer, listing.id, 'colissimo', { legacy: true, keepAddress: true });
    const txId = (body.transaction ?? body).id as string;
    const sender = { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', phone: '0612345678' };
    const recipient = { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' };
    const payload = { mode: 'domicile', parcel: { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 15 }, sender, recipient };
    const results = await Promise.all([
      request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send(payload),
      request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send(payload),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const view = await request(server).get(`/transactions/${txId}/shipment`).set(seller.auth).expect(200);
    expect(view.body.status).toBe('etiquette_prete');
  });

  it('formule payante : refusée tant qu\'aucun prélèvement n\'est possible (monétisation activée) ; formule gratuite acceptée', async () => {
    await request(server).patch('/admin/settings').set(admin.auth).send({ monetization_enabled: true }).expect(200);
    const member = await login(app);
    const plans = (await request(server).get('/plans')).body;
    const premium = plans.find((p: any) => p.slug === 'boutique-premium');
    const free = plans.find((p: any) => p.slug === 'gratuit');
    const paid = await request(server).post(`/users/me/subscription/${premium.id}`).set(member.auth);
    expect(paid.status).toBe(503);
    expect(paid.body.message).toMatch(/pas encore ouvertes/);
    const entitlements = await request(server).get('/users/me/entitlements').set(member.auth).expect(200);
    expect(JSON.stringify(entitlements.body)).not.toContain('boutique-premium');
    await request(server).post(`/users/me/subscription/${free.id}`).set(member.auth).expect(201);
    await request(server).patch('/admin/settings').set(admin.auth).send({ monetization_enabled: false }).expect(200);
  });

  it('adresse de l\'acheteur retirée au vendeur après annulation ; indicateurs de masquage jamais renvoyés dans une conversation', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 40, deliveryAvailable: true });
    const body = await buyShipped(app, buyer, listing.id);
    const txId = (body.transaction ?? body).id as string;
    const before = await request(server).get(`/transactions/${txId}`).set(seller.auth).expect(200);
    expect(before.body.shippingAddress).not.toBeNull();
    const cancelled = await request(server).post(`/transactions/${txId}/cancel`).set(buyer.auth);
    expect([200, 201]).toContain(cancelled.status);
    const after = await request(server).get(`/transactions/${txId}`).set(seller.auth).expect(200);
    expect(after.body.status).toBe('annulee');
    expect(after.body.shippingAddress).toBeNull();
    const conv = await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Bonjour, toujours disponible ?' }).expect(201);
    const detail = await request(server).get(`/conversations/${conv.body.id}`).set(seller.auth).expect(200);
    expect(detail.body).not.toHaveProperty('hiddenForBuyerAt');
    expect(detail.body).not.toHaveProperty('hiddenForSellerAt');
  });
});
