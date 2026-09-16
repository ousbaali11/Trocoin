import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { Notification } from '../src/notifications/notification.entity';
import { SavedSearchesService } from '../src/saved-searches/saved-searches.service';
import { createApp, createListing, login, makeAdmin } from './utils';

describe('Messagerie, paiement séquestre, avis, signalements, alertes, admin', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('messagerie : participants seulement, non-lus, accusé de lecture, blocage', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const stranger = await login(app);
    const listing = await createListing(app, seller);

    await request(server).post('/conversations').set(seller.auth).send({ listingId: listing.id }).expect(400); // soi-même
    const conv = await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Bonjour, toujours disponible ?' }).expect(201);
    const again = await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id }).expect(201);
    expect(again.body.id).toBe(conv.body.id);

    await request(server).get(`/conversations/${conv.body.id}/messages`).set(stranger.auth).expect(403);
    await request(server).post(`/conversations/${conv.body.id}/messages`).set(stranger.auth).send({ content: 'intrus' }).expect(403);
    await request(server).post(`/conversations/${conv.body.id}/messages`).set(buyer.auth).send({ content: '' }).expect(400);

    const unreadSeller = await request(server).get('/conversations/unread-count').set(seller.auth).expect(200);
    expect(unreadSeller.body.unread).toBe(1);
    const inbox = await request(server).get('/conversations').set(seller.auth).expect(200);
    expect(inbox.body[0].unreadCount).toBe(1);
    expect(inbox.body[0].other.id).toBe(buyer.id);
    expect(inbox.body[0].listing.title).toBe(listing.title);
    expect(inbox.body[0].lastMessage.content).toMatch(/disponible/);

    const detail = await request(server).get(`/conversations/${conv.body.id}`).set(seller.auth).expect(200);
    expect(detail.body.messages[0].readAt).not.toBeNull(); // lu à l'ouverture
    const after = await request(server).get(`/conversations/${conv.body.id}/messages`).set(seller.auth).expect(200);
    expect(after.body[0].readAt).not.toBeNull();
    expect((await request(server).get('/conversations/unread-count').set(seller.auth)).body.unread).toBe(0);
    expect(detail.body.quickReplies.length).toBeGreaterThan(2);

    await request(server).post(`/conversations/${conv.body.id}/messages`).set(seller.auth).send({ content: 'Oui, toujours disponible.' }).expect(201);
    const notifs = await request(server).get('/notifications').set(buyer.auth).expect(200);
    expect(notifs.body.some((n: any) => n.type === 'message')).toBe(true);

    // blocage : le vendeur bloque l'acheteur -> plus aucun message dans les deux sens
    await request(server).post(`/users/me/blocks/${buyer.id}`).set(seller.auth).expect(201);
    await request(server).post(`/conversations/${conv.body.id}/messages`).set(buyer.auth).send({ content: 'encore ?' }).expect(403);
    await request(server).post(`/conversations/${conv.body.id}/messages`).set(seller.auth).send({ content: 'moi non plus' }).expect(403);
    const blocks = await request(server).get('/users/me/blocks').set(seller.auth).expect(200);
    expect(blocks.body[0].id).toBe(buyer.id);
    await request(server).delete(`/users/me/blocks/${buyer.id}`).set(seller.auth).expect(200);
    await request(server).post(`/conversations/${conv.body.id}/messages`).set(buyer.auth).send({ content: 'merci' }).expect(201);
  });

  it('paiement séquestre complet : devis, commission, expédition, confirmation, avis, note recalculée', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const stranger = await login(app);
    const listing = await createListing(app, seller, { price: 100, deliveryAvailable: true });

    const quote = await request(server).get(`/transactions/quote?listingId=${listing.id}`).expect(200);
    expect(quote.body).toMatchObject({ eligible: true, price: 100, commission: 8, buyerFee: 5.5, buyerTotal: 105.5, sellerPayout: 92 });

    await request(server).post('/transactions').set(seller.auth).send({ listingId: listing.id }).expect(400);
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: 'pas-un-uuid' }).expect(400);

    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo' }).expect(201);
    const tx = created.body.transaction;
    expect(tx.status).toBe('sequestre');
    expect(tx.amount).toBe(100);
    expect(tx.commission).toBe(8);
    expect(tx.buyerFee).toBe(5.5);
    expect(tx.providerPaymentId).toBeUndefined();

    // double vente impossible
    const dup = await request(server).post('/transactions').set(stranger.auth).send({ listingId: listing.id });
    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/déjà en cours/);

    await request(server).get(`/transactions/${tx.id}`).set(stranger.auth).expect(403);
    await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(seller.auth).expect(403);
    await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(stranger.auth).expect(403);
    await request(server).post(`/transactions/${tx.id}/ship`).set(buyer.auth).send({}).expect(403);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({}).expect(400); // suivi requis
    const shipped = await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A12345678901' }).expect(201);
    expect(shipped.body.status).toBe('livree');

    await request(server).post(`/transactions/${tx.id}/review`).set(buyer.auth).send({ rating: 5 }).expect(400); // pas encore confirmée
    const confirmed = await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(buyer.auth).expect(201);
    expect(confirmed.body.status).toBe('confirme');
    const sold = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(sold.body.status).toBe('vendue');

    await request(server).post(`/transactions/${tx.id}/review`).set(buyer.auth).send({ rating: 7 }).expect(400);
    await request(server).post(`/transactions/${tx.id}/review`).set(stranger.auth).send({ rating: 5 }).expect(403);
    await request(server).post(`/transactions/${tx.id}/review`).set(buyer.auth).send({ rating: 4, comment: 'Envoi rapide, conforme.' }).expect(201);
    await request(server).post(`/transactions/${tx.id}/review`).set(buyer.auth).send({ rating: 4 }).expect(400); // doublon
    await request(server).post(`/transactions/${tx.id}/review`).set(seller.auth).send({ rating: 5 }).expect(201);

    const profile = await request(server).get(`/users/${seller.id}/profile`).expect(200);
    expect(profile.body.ratingAvg).toBe(4);
    expect(profile.body.ratingCount).toBe(1);
    const buyerProfile = await request(server).get(`/users/${buyer.id}/profile`).expect(200);
    expect(buyerProfile.body.ratingAvg).toBe(5);
    const given = await request(server).get('/users/me/reviews-given').set(buyer.auth).expect(200);
    expect(given.body[0].reviewed.id).toBe(seller.id);
    const received = await request(server).get(`/users/${seller.id}/reviews`).expect(200);
    expect(received.body[0].comment).toMatch(/rapide/);

    // deuxième vente : moyenne pondérée (4 puis 2 -> 3)
    const listing2 = await createListing(app, seller, { price: 40 });
    const tx2 = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing2.id }).expect(201)).body.transaction;
    expect(tx2.handoverCode).toMatch(/^\d{6}$/); // main propre : code visible par l'acheteur
    const asSeller = await request(server).get(`/transactions/${tx2.id}`).set(seller.auth).expect(200);
    expect(asSeller.body.handoverCode).toBeUndefined();
    await request(server).post(`/transactions/${tx2.id}/handover`).set(seller.auth).send({ code: '000000' }).expect(400);
    await request(server).post(`/transactions/${tx2.id}/handover`).set(seller.auth).send({ code: tx2.handoverCode }).expect(201);
    await request(server).post(`/transactions/${tx2.id}/review`).set(buyer.auth).send({ rating: 2 }).expect(201);
    expect((await request(server).get(`/users/${seller.id}/profile`)).body.ratingAvg).toBe(3);
  });

  it('paiement : catégories exclues, plafond, annulation avant envoi, litige et arbitrage admin', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);

    const car = await createListing(app, seller, {
      title: 'Clio 4 diesel', description: 'Bon état général, distribution faite.', categorySlug: 'voitures', price: 6000,
      attributes: { marque: 'Renault', modele: 'Clio', annee: 2016, kilometrage: 120000, carburant: 'Diesel', boite: 'Manuelle' },
    });
    const q = await request(server).get(`/transactions/quote?listingId=${car.id}`).expect(200);
    expect(q.body.eligible).toBe(false);
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: car.id }).expect(400);
    const expensive = await createListing(app, seller, { price: 3000 });
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: expensive.id }).expect(400);

    const l1 = await createListing(app, seller, { price: 50 });
    const t1 = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: l1.id }).expect(201)).body.transaction;
    const cancelled = await request(server).post(`/transactions/${t1.id}/cancel`).set(seller.auth).expect(201);
    expect(cancelled.body.status).toBe('annulee');
    await request(server).post(`/transactions/${t1.id}/dispute`).set(buyer.auth).send({ reason: 'Trop tard pour un litige.' }).expect(400);

    const l2 = await createListing(app, seller, { price: 80 });
    const t2 = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: l2.id }).expect(201)).body.transaction;
    await request(server).post(`/transactions/${t2.id}/ship`).set(seller.auth).send({}).expect(201); // main propre : pas de suivi requis
    await request(server).post(`/transactions/${t2.id}/dispute`).set(buyer.auth).send({ reason: 'court' }).expect(400);
    const disputed = await request(server).post(`/transactions/${t2.id}/dispute`).set(buyer.auth).send({ reason: 'Objet non conforme à la description, rayures importantes.' }).expect(201);
    expect(disputed.body.status).toBe('litige');
    await request(server).post(`/transactions/${t2.id}/confirm-delivery`).set(buyer.auth).expect(400);

    await request(server).post(`/admin/transactions/${t2.id}/resolve`).set(buyer.auth).send({ decision: 'rembourser', note: 'x' }).expect(403);
    const disputes = await request(server).get('/admin/transactions?status=litige').set(admin.auth).expect(200);
    expect(disputes.body.items.map((t: any) => t.id)).toContain(t2.id);
    const resolved = await request(server).post(`/admin/transactions/${t2.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Photos de l\'acheteur concluantes.' }).expect(201);
    expect(resolved.body.status).toBe('rembourse');
    const mine = await request(server).get('/transactions/mine').set(buyer.auth).expect(200);
    expect(mine.body.find((t: any) => t.id === t2.id).status).toBe('rembourse');

    const audit = await request(server).get('/admin/audit-log?action=transaction').set(admin.auth).expect(200);
    expect(audit.body.items[0]).toMatchObject({ adminId: admin.id, action: 'transaction.resolve', targetId: t2.id });
  });

  it('signalements : création, doublon, file admin, traitement avec retrait de l\'annonce et suspension', async () => {
    const seller = await login(app);
    const reporter = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);
    const listing = await createListing(app, seller);

    expect((await request(server).get('/reports/reasons').expect(200)).body).toContain('arnaque');
    await request(server).post('/reports').set(reporter.auth).send({ reason: 'arnaque' }).expect(400); // aucune cible
    await request(server).post('/reports').set(seller.auth).send({ listingId: listing.id, reason: 'arnaque' }).expect(400); // sa propre annonce
    await request(server).post('/reports').set(reporter.auth).send({ listingId: listing.id, reason: 'inexistant' }).expect(400);
    const rep = await request(server).post('/reports').set(reporter.auth).send({ listingId: listing.id, reason: 'contrefacon', details: 'Photos issues d\'un site marchand.' }).expect(201);
    expect(rep.body.reportedUserId).toBe(seller.id);
    await request(server).post('/reports').set(reporter.auth).send({ listingId: listing.id, reason: 'arnaque' }).expect(400); // doublon ouvert

    await request(server).get('/admin/reports').set(reporter.auth).expect(403);
    const queue = await request(server).get('/admin/reports?status=ouvert').set(admin.auth).expect(200);
    const item = queue.body.items.find((r: any) => r.id === rep.body.id);
    expect(item.listing.title).toBe(listing.title);
    expect(item.reporter.id).toBe(reporter.id);

    await request(server).patch(`/admin/reports/${rep.body.id}`).set(admin.auth).send({ status: 'traite', action: 'retirer_et_suspendre', note: 'Contrefaçon avérée.' }).expect(200);
    await request(server).patch(`/admin/reports/${rep.body.id}`).set(admin.auth).send({ status: 'rejete' }).expect(400); // déjà traité
    await request(server).get(`/listings/${listing.id}`).expect(404);
    const adminView = await request(server).get(`/admin/listings/${listing.id}`).set(admin.auth).expect(200);
    expect(adminView.body.status).toBe('refusee');
    await request(server).get('/users/me').set(seller.auth).expect(403); // suspendu
    const u = await request(server).get(`/admin/users/${seller.id}`).set(admin.auth).expect(200);
    expect(u.body.suspended).toBe(true);
    expect(u.body.reportsAgainst.length).toBe(1);

    // réactivation par l'admin, journalisée
    await request(server).patch(`/admin/users/${seller.id}`).set(admin.auth).send({ suspended: false }).expect(200);
    await request(server).get('/users/me').set(seller.auth).expect(200);
    await request(server).patch(`/admin/users/${admin.id}`).set(admin.auth).send({ suspended: true }).expect(400); // pas soi-même
    const audit = await request(server).get(`/admin/audit-log?target_id=${seller.id}`).set(admin.auth).expect(200);
    expect(audit.body.items.some((a: any) => a.action === 'user.update')).toBe(true);
    const reportAudit = await request(server).get(`/admin/audit-log?target_id=${rep.body.id}`).set(admin.auth).expect(200);
    expect(reportAudit.body.items[0].details.userSuspended).toBe(seller.id);
  });

  it('admin : modération d\'une annonce en attente, stats, recherche utilisateurs, suppression', async () => {
    const seller = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);
    const pending = await createListing(app, seller, { title: 'Lot de cigarettes', description: 'Cartouches de cigarettes pas chères.' });
    expect(pending.status).toBe('en_attente');

    const flagged = await request(server).get('/admin/listings?flagged=true').set(admin.auth).expect(200);
    expect(flagged.body.items.map((l: any) => l.id)).toContain(pending.id);
    await request(server).patch(`/admin/listings/${pending.id}`).set(admin.auth).send({ status: 'refusee' }).expect(400); // motif requis
    await request(server).patch(`/admin/listings/${pending.id}`).set(admin.auth).send({ status: 'refusee', moderationReason: 'Produit interdit (tabac).' }).expect(200);
    const notifs = await request(server).get('/notifications').set(seller.auth).expect(200);
    expect(notifs.body.some((n: any) => n.type === 'moderation' && /refusée/.test(n.title))).toBe(true);

    const ok = await createListing(app, seller, { title: 'Lampe de bureau' });
    const approved = await request(server).patch(`/admin/listings/${ok.id}`).set(admin.auth).send({ title: 'Lampe de bureau (titre corrigé)' }).expect(200);
    expect(approved.body.title).toMatch(/corrigé/);
    const del = await request(server).delete(`/admin/listings/${ok.id}?reason=Test`).set(admin.auth).expect(200);
    expect(del.body.deleted).toBe(true);

    const stats = await request(server).get('/admin/stats').set(admin.auth).expect(200);
    expect(stats.body.users.total).toBeGreaterThan(1);
    expect(stats.body.listings).toHaveProperty('pending');
    const users = await request(server).get(`/admin/users?q=${encodeURIComponent(seller.phone)}`).set(admin.auth).expect(200);
    expect(users.body.items[0].id).toBe(seller.id);
    await request(server).get('/admin/stats').set(seller.auth).expect(403);
    await request(server).get('/admin/stats').expect(401);
  });

  it('recherches sauvegardées : création, exécution, alerte sur nouvelle annonce', async () => {
    const watcher = await login(app);
    const seller = await login(app);
    await request(server).post('/users/me/saved-searches').set(watcher.auth).send({ name: 'Vide', query: {} }).expect(400);
    const saved = await request(server).post('/users/me/saved-searches').set(watcher.auth)
      .send({ name: 'Vélos électriques Lyon', query: { category: 'velos', postal_code: '69', price_max: 1500 } }).expect(201);
    expect(saved.body.notifyPush).toBe(true);

    const svc = app.get(SavedSearchesService);
    await svc.checkAll();
    const notifRepo = app.get<Repository<Notification>>(getRepositoryToken(Notification));
    const before = await notifRepo.count({ where: { userId: watcher.id, type: 'alerte_recherche' } });

    await createListing(app, seller, { title: 'VTT électrique Rockrider', categorySlug: 'velos', price: 1200, postalCode: '69007', attributes: { type_velo: 'Électrique' } });
    await createListing(app, seller, { title: 'Vélo trop cher', categorySlug: 'velos', price: 4000, postalCode: '69007', attributes: { type_velo: 'Route' } });
    const result = await svc.checkAll();
    expect(result.notified).toBeGreaterThanOrEqual(1);
    const after = await notifRepo.find({ where: { userId: watcher.id, type: 'alerte_recherche' } });
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].body).toMatch(/Rockrider/);

    // « Suivre ce vendeur » (fiche annonce) : recherche sauvegardée sur le seul critère vendeur
    await request(server).post('/users/me/saved-searches').set(watcher.auth).send({ name: 'Suivi', query: { seller: 'pas-un-uuid' } }).expect(400);
    const follow = await request(server).post('/users/me/saved-searches').set(watcher.auth).send({ name: 'Annonces du vendeur', query: { seller: seller.id } }).expect(201);
    expect(follow.body.query.seller).toBe(seller.id);
    await svc.checkAll();
    const other = await login(app);
    await createListing(app, other, { title: 'Annonce d\'un autre vendeur', price: 300, postalCode: '75011' });
    await createListing(app, seller, { title: 'Nouvelle annonce du vendeur suivi', price: 40 });
    await svc.checkAll();
    const followed = await notifRepo.find({ where: { userId: watcher.id, type: 'alerte_recherche' } });
    expect(followed.some((n) => /vendeur suivi/.test(n.body))).toBe(true);
    expect(followed.some((n) => /autre vendeur/.test(n.body))).toBe(false);
    const followRun = await request(server).get(`/users/me/saved-searches/${follow.body.id}/results`).set(watcher.auth).expect(200);
    expect(followRun.body.items.length).toBeGreaterThanOrEqual(3);
    expect(followRun.body.items.every((l: any) => l.userId === seller.id)).toBe(true);
    await request(server).delete(`/users/me/saved-searches/${follow.body.id}`).set(watcher.auth).expect(200); // « Ne plus suivre »

    const run = await request(server).get(`/users/me/saved-searches/${saved.body.id}/results`).set(watcher.auth).expect(200);
    expect(run.body.items.length).toBe(1);
    await request(server).get(`/users/me/saved-searches/${saved.body.id}/results`).set(seller.auth).expect(404);
    await request(server).delete(`/users/me/saved-searches/${saved.body.id}`).set(watcher.auth).expect(200);
    expect((await request(server).get('/users/me/saved-searches').set(watcher.auth)).body.length).toBe(0);
  });

  it('RGPD : export des données puis suppression, numéro réutilisable', async () => {
    const user = await login(app);
    await createListing(app, user);
    const exp = await request(server).get('/users/me/export').set(user.auth).expect(200);
    expect(exp.body.listings.length).toBe(1);
    expect(exp.body.profile.phoneNumber).toBe(user.phone);
    await request(server).delete('/users/me').set(user.auth).expect(204);
    await request(server).get('/users/me').set(user.auth).expect(401);
    await request(server).get(`/users/${user.id}/profile`).expect(404);
    // Le numéro peut ré-ouvrir un compte (cooldown OTP : on attend la fenêtre en changeant de numéro dans les tests réels ;
    // ici on vérifie seulement que l'ancien compte est anonymisé)
    const admin = await login(app);
    await makeAdmin(app, admin);
    const view = await request(server).get(`/admin/users/${user.id}`).set(admin.auth).expect(200);
    expect(view.body.deleted).toBe(true);
    expect(view.body.phoneNumber).toBe(`deleted:${user.id}`);
  });

  it('onboarding Stripe (mode mock) : lien, statut, compte connecté transmis au paiement', async () => {
    const seller = await login(app);
    const link = await request(server).post('/users/me/stripe-onboarding-link').set(seller.auth).expect(201);
    expect(link.body.mode).toBe('mock');
    expect(link.body.url).toMatch(/^http/);
    const status = await request(server).get('/users/me/stripe-status').set(seller.auth).expect(200);
    expect(status.body.onboardingComplete).toBe(true);
    const me = await request(server).get('/users/me').set(seller.auth).expect(200);
    expect(me.body.stripeConnected).toBe(true);
    expect(me.body.stripeAccountId).toBeUndefined();
  });
});
