import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AdminAuditLog } from '../src/admin/admin-audit-log.entity';
import { Favorite } from '../src/favorites/favorite.entity';
import { ListingPhoto } from '../src/listings/listing-photo.entity';
import { ListingView } from '../src/listings/listing-view.entity';
import { Listing } from '../src/listings/listing.entity';
import { Notification } from '../src/notifications/notification.entity';
import { Transaction } from '../src/payments/transaction.entity';
import { Review } from '../src/reviews/review.entity';
import { User } from '../src/users/user.entity';
import { createApp, createListing, login, makeAdmin, TestUser } from './utils';

/**
 * Phase 26 (AUDIT §41) : suppression réelle d'une annonce ou d'un compte (plus aucune ligne en base ni dans
 * les listes admin), trace comptable anonymisée des ventes payées, journal d'audit conservé ; correction de
 * la page Traçabilité (entrée du script CLI avec adminId non uuid).
 */
describe('Phase 26 : suppression réelle, trace comptable anonymisée, journal Traçabilité', () => {
  let app: INestApplication;
  let server: any;
  let admin: TestUser;
  let users: Repository<User>;
  let listings: Repository<Listing>;
  let photos: Repository<ListingPhoto>;
  let favorites: Repository<Favorite>;
  let views: Repository<ListingView>;
  let txRepo: Repository<Transaction>;
  let reviews: Repository<Review>;
  let notifications: Repository<Notification>;
  let audit: Repository<AdminAuditLog>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    users = app.get(getRepositoryToken(User));
    listings = app.get(getRepositoryToken(Listing));
    photos = app.get(getRepositoryToken(ListingPhoto));
    favorites = app.get(getRepositoryToken(Favorite));
    views = app.get(getRepositoryToken(ListingView));
    txRepo = app.get(getRepositoryToken(Transaction));
    reviews = app.get(getRepositoryToken(Review));
    notifications = app.get(getRepositoryToken(Notification));
    audit = app.get(getRepositoryToken(AdminAuditLog));
    admin = await login(app);
    await makeAdmin(app, admin);
  });
  afterAll(() => app.close());

  const HARD = { reason: 'Contenu illicite confirmé par la modération', confirm: 'SUPPRIMER' };
  const buy = async (seller: TestUser, buyer: TestUser, listingId: string, delivery: 'colissimo' | 'main_propre' = 'colissimo') => {
    const body = delivery === 'main_propre' ? { listingId } : { listingId, deliveryMethod: delivery, shippingAddress: { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris', phone: '0612345678' } };
    return (await request(server).post('/transactions').set(buyer.auth).send(body).expect(201)).body.transaction as Transaction;
  };

  it('Traçabilité : une entrée écrite par le script CLI (adminId = « cli », pas un uuid) ne fait plus échouer le journal ; les autres entrées gardent le nom de l\'admin', async () => {
    await audit.save(audit.create({ adminId: 'cli', action: 'user.promote_admin', targetType: 'user', targetId: admin.id, details: { via: 'create-admin script' } }));
    await request(server).patch(`/admin/users/${admin.id}`).set(admin.auth).send({ city: 'Lyon' }).expect(200);
    const log = await request(server).get('/admin/audit-log?page_size=50').set(admin.auth).expect(200);
    const cli = log.body.items.find((e: any) => e.adminId === 'cli');
    expect(cli).toBeTruthy();
    expect(cli.adminName).toBe("Script d'administration (CLI)");
    const mine = log.body.items.find((e: any) => e.adminId === admin.id);
    expect(mine.adminName).toBeTruthy();
    expect(mine.adminName).not.toBe(admin.id);
    await request(server).get('/admin/audit-log?action=user.promote').set(admin.auth).expect(200);
  });

  it('annonce supprimée par l\'admin : effacée de la base et des listes admin (photos, favoris, historique compris), transaction jamais payée effacée, conversation de l\'autre membre intacte avec « annonce supprimée », journal conservé', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { title: 'Sac en cuir camel' });
    await photos.save(photos.create({ listingId: listing.id, url: '/uploads/test-photo.jpg', thumbUrl: '/uploads/test-photo-thumb.jpg', sortOrder: 0 }));
    await request(server).post(`/listings/${listing.id}/favorite`).set(buyer.auth).expect(201);
    await request(server).get(`/listings/${listing.id}`).set(buyer.auth).expect(200); // historique de consultation
    const conv = await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Toujours disponible ?' }).expect(201);
    // Transaction jamais payée (page de paiement abandonnée)
    const tx = await buy(seller, buyer, listing.id, 'main_propre');
    await txRepo.update(tx.id, { status: 'en_attente', paidAt: null as any, capturedAt: null as any });
    expect(await views.count({ where: { listingId: listing.id } })).toBeGreaterThanOrEqual(1);

    const res = await request(server).delete(`/admin/listings/${listing.id}`).set(admin.auth).send(HARD).expect(200);
    expect(res.body).toEqual({ deleted: true, keptTransactions: 0 });
    // Plus aucune ligne : base, fiche admin, liste admin (recherche par identifiant), site public
    expect(await listings.findOne({ where: { id: listing.id } })).toBeNull();
    await request(server).get(`/admin/listings/${listing.id}`).set(admin.auth).expect(404);
    const list = await request(server).get(`/admin/listings?q=${listing.id}&page_size=50`).set(admin.auth).expect(200);
    expect(list.body.items.map((l: any) => l.id)).not.toContain(listing.id);
    await request(server).get(`/listings/${listing.id}`).expect(404);
    expect(await photos.count({ where: { listingId: listing.id } })).toBe(0);
    expect(await favorites.count({ where: { listingId: listing.id } })).toBe(0);
    expect(await views.count({ where: { listingId: listing.id } })).toBe(0);
    expect(await txRepo.findOne({ where: { id: tx.id } })).toBeNull();
    const favs = await request(server).get('/users/me/favorites').set(buyer.auth).expect(200);
    expect(JSON.stringify(favs.body)).not.toContain(listing.id);
    // L'autre membre ouvre encore la conversation : pas d'erreur, l'annonce est signalée absente
    const detail = await request(server).get(`/conversations/${conv.body.id}`).set(buyer.auth).expect(200);
    expect(detail.body.listing).toBeNull();
    expect(detail.body.messages.length).toBeGreaterThanOrEqual(1);
    const mine = await request(server).get('/conversations').set(buyer.auth).expect(200);
    expect(mine.body.find((c: any) => c.id === conv.body.id).listing).toBeNull();
    // Journal : l'entrée reste après l'effacement réel
    const entry = await audit.findOne({ where: { action: 'listing.delete', targetId: listing.id } });
    expect(entry!.details).toMatchObject({ reason: HARD.reason, hardDeleted: true, keptTransactions: 0, title: 'Sac en cuir camel' });
    const log = await request(server).get(`/admin/audit-log?target_id=${listing.id}`).set(admin.auth).expect(200);
    expect(log.body.items[0].action).toBe('listing.delete');
    expect(log.body.items[0].adminName).toBeTruthy();
  });

  it('annonce liée à une vente payée : l\'annonce est effacée, la vente garde montant, dates, références et titre, affichée « (annonce supprimée) » à l\'acheteur et à l\'admin', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { title: 'Casque audio sans fil', price: 70, deliveryAvailable: true });
    const tx = await buy(seller, buyer, listing.id);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000301' }).expect(201);
    await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(buyer.auth).expect(201);
    const res = await request(server).delete(`/admin/listings/${listing.id}`).set(admin.auth).send(HARD).expect(200);
    expect(res.body).toEqual({ deleted: true, keptTransactions: 1 });
    expect(await listings.findOne({ where: { id: listing.id } })).toBeNull();
    const kept = (await txRepo.findOne({ where: { id: tx.id } }))!;
    expect(kept.status).toBe('confirme');
    expect(kept.amount).toBe(70);
    expect(kept.listingTitle).toBe('Casque audio sans fil');
    expect(kept.paidAt).toBeTruthy();
    expect(kept.providerPaymentId).toBeTruthy();
    const view = await request(server).get(`/transactions/${tx.id}`).set(buyer.auth).expect(200);
    expect(view.body.listing).toBeNull();
    expect(view.body.listingTitle).toBe('Casque audio sans fil');
    const adminView = await request(server).get(`/admin/transactions/${tx.id}`).set(admin.auth).expect(200);
    expect(adminView.body.listing).toBeNull();
    expect(adminView.body.listingTitle).toBe('Casque audio sans fil');
    const adminList = await request(server).get('/admin/transactions?status=confirme&page_size=100').set(admin.auth).expect(200);
    expect(adminList.body.items.find((t: any) => t.id === tx.id).listingTitle).toBe('Casque audio sans fil');
    expect((await audit.findOne({ where: { action: 'listing.delete', targetId: listing.id } }))!.details).toMatchObject({ keptTransactions: 1 });
  });

  it('compte supprimé par l\'admin : ligne effacée (liste et fiche admin), données propres effacées, numéro réutilisable ; ses ventes payées restent sans données personnelles et s\'affichent « Compte supprimé » ; avis reçus effacés, avis rédigés conservés ; journal conservé', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { title: 'Platine vinyle', price: 90, deliveryAvailable: true });
    const other = await createListing(app, buyer, { title: 'Lampe de chevet' });
    const tx = await buy(seller, buyer, listing.id);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000302' }).expect(201);
    await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(buyer.auth).expect(201);
    await request(server).post(`/transactions/${tx.id}/review`).set(buyer.auth).send({ rating: 5, comment: 'Vendeur parfait' }).expect(201);
    await request(server).post(`/transactions/${tx.id}/review`).set(seller.auth).send({ rating: 4, comment: 'Acheteur sérieux' }).expect(201);
    await request(server).post(`/listings/${listing.id}/favorite`).set(buyer.auth).expect(201);
    const conv = await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Merci pour la platine !' }).expect(201);
    expect(await notifications.count({ where: { userId: buyer.id } })).toBeGreaterThanOrEqual(1);

    const res = await request(server).delete(`/admin/users/${buyer.id}`).set(admin.auth).send({ reason: 'Compte frauduleux (usurpation d\'identité)', confirm: 'SUPPRIMER' }).expect(200);
    expect(res.body).toMatchObject({ deleted: true, refundedTransactions: [], listings: 1, keptTransactions: 1 });
    // Effacé partout : base, fiche et liste admin, profil public, ses annonces, ses favoris, ses notifications, ses avis reçus
    expect(await users.findOne({ where: { id: buyer.id } })).toBeNull();
    await request(server).get(`/admin/users/${buyer.id}`).set(admin.auth).expect(404);
    const list = await request(server).get(`/admin/users?q=${encodeURIComponent(buyer.phone)}`).set(admin.auth).expect(200);
    expect(list.body.items).toHaveLength(0);
    await request(server).get(`/users/${buyer.id}/profile`).expect(404);
    expect(await listings.findOne({ where: { id: other.id } })).toBeNull();
    expect(await favorites.count({ where: { userId: buyer.id } })).toBe(0);
    expect(await notifications.count({ where: { userId: buyer.id } })).toBe(0);
    expect(await reviews.count({ where: { reviewedId: buyer.id } })).toBe(0);
    // Trace comptable de la vente payée : montant, dates, références conservés ; adresse et code effacés
    const kept = (await txRepo.findOne({ where: { id: tx.id } }))!;
    expect(kept.amount).toBe(90);
    expect(kept.buyerId).toBe(buyer.id);
    expect(kept.shippingAddress).toBeNull();
    expect(kept.handoverCode).toBeNull();
    expect(kept.listingTitle).toBe('Platine vinyle');
    // Le vendeur voit toujours sa vente, avec un acheteur « Compte supprimé »
    const sellerView = await request(server).get(`/transactions/${tx.id}`).set(seller.auth).expect(200);
    expect(sellerView.body.other).toMatchObject({ id: buyer.id, displayName: 'Compte supprimé', deleted: true });
    const sellerList = await request(server).get('/transactions/mine').set(seller.auth).expect(200);
    expect(sellerList.body.find((t: any) => t.id === tx.id).other.displayName).toBe('Compte supprimé');
    const adminTx = await request(server).get(`/admin/transactions/${tx.id}`).set(admin.auth).expect(200);
    expect(adminTx.body.buyer).toBeNull();
    expect(adminTx.body.seller.id).toBe(seller.id);
    // L'avis rédigé par le compte supprimé reste sur le vendeur (auteur « Compte supprimé ») ; la conversation reste lisible
    const received = await request(server).get(`/users/${seller.id}/reviews`).expect(200);
    const fromDeleted = (received.body.items ?? received.body).find((r: any) => r.reviewerId === buyer.id);
    expect(fromDeleted.reviewer.displayName).toBe('Compte supprimé');
    const detail = await request(server).get(`/conversations/${conv.body.id}`).set(seller.auth).expect(200);
    expect(detail.body.other.displayName).toBe('Compte supprimé');
    // Journal conservé : qui, quoi, quand, pourquoi — et lisible depuis la page Traçabilité
    const entry = await audit.findOne({ where: { action: 'user.delete', targetId: buyer.id } });
    expect(entry!.adminId).toBe(admin.id);
    expect(entry!.details).toMatchObject({ reason: 'Compte frauduleux (usurpation d\'identité)', listingsDeleted: 1, keptTransactions: 1 });
    const log = await request(server).get(`/admin/audit-log?target_id=${buyer.id}`).set(admin.auth).expect(200);
    expect(log.body.items.map((e: any) => e.action)).toContain('user.delete');
    // Le numéro est libre : nouvelle inscription possible (formulaire, sans OTP : le numéro n'est plus pris)
    const tag = String(Date.now()).slice(-6);
    const again = await request(server).post('/auth/register').send({ accountType: 'particulier', firstName: 'Nora', lastName: 'Bex', username: `nora_${tag}`, email: `nora.${tag}@example.org`, phoneNumber: buyer.phone, password: 'MotDePasse!2026', passwordConfirmation: 'MotDePasse!2026' }).expect(201);
    expect(again.body.user.id).not.toBe(buyer.id);
  });

  it('auto-suppression RGPD : même effacement réel (ligne, annonces, favoris), et le compte disparaît des listes admin', async () => {
    const user = await login(app);
    const listing = await createListing(app, user, { title: 'Vélo enfant 16 pouces' });
    await request(server).delete('/users/me').set(user.auth).expect(204);
    expect(await users.findOne({ where: { id: user.id } })).toBeNull();
    expect(await listings.findOne({ where: { id: listing.id } })).toBeNull();
    const list = await request(server).get(`/admin/users?q=${encodeURIComponent(user.phone)}`).set(admin.auth).expect(200);
    expect(list.body.items).toHaveLength(0);
    await request(server).get(`/listings/${listing.id}`).expect(404);
  });
});
