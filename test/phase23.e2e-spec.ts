import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AdminAuditLog } from '../src/admin/admin-audit-log.entity';
import { createApp, createListing, login, makeAdmin } from './utils';

/**
 * Phase 23 (audit admin, étape 2) : suppression définitive d'un compte et d'une annonce avec motif et
 * confirmation explicite, décisions admin sur toute transaction ouverte (rembourser, libérer, annuler),
 * fiche détaillée d'une transaction, journal d'audit systématique.
 */
describe('Phase 23 : droits admin — suppressions définitives, transactions, journal', () => {
  let app: INestApplication;
  let server: any;
  let audit: Repository<AdminAuditLog>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    audit = app.get(getRepositoryToken(AdminAuditLog));
  });
  afterAll(() => app.close());

  it('supprime définitivement un compte : motif et confirmation obligatoires, transactions en cours remboursées, annonces retirées, journal', async () => {
    const admin = await login(app);
    await makeAdmin(app, admin);
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 50 });
    const tx = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201)).body.transaction;

    // Garde-fous : confirmation manquante ou fausse, motif trop court, soi-même, membre non admin
    await request(server).delete(`/admin/users/${seller.id}`).set(admin.auth).send({ reason: 'Fraude avérée sur plusieurs ventes' }).expect(400);
    await request(server).delete(`/admin/users/${seller.id}`).set(admin.auth).send({ reason: 'Fraude avérée', confirm: 'supprimer' }).expect(400);
    await request(server).delete(`/admin/users/${seller.id}`).set(admin.auth).send({ reason: 'Fr', confirm: 'SUPPRIMER' }).expect(400);
    await request(server).delete(`/admin/users/${admin.id}`).set(admin.auth).send({ reason: 'Erreur de manipulation', confirm: 'SUPPRIMER' }).expect(400);
    await request(server).delete(`/admin/users/${seller.id}`).set(buyer.auth).send({ reason: 'Fraude avérée', confirm: 'SUPPRIMER' }).expect(403);

    const res = await request(server).delete(`/admin/users/${seller.id}`).set(admin.auth).send({ reason: 'Fraude avérée sur plusieurs ventes', confirm: 'SUPPRIMER' }).expect(200);
    expect(res.body).toMatchObject({ deleted: true, refundedTransactions: [tx.id] });
    // Effets : connexion impossible, profil public « Compte supprimé », annonce retirée, acheteur remboursé
    await request(server).get('/users/me').set(seller.auth).expect(401);
    expect((await request(server).get(`/users/${seller.id}/profile`)).status).toBe(404);
    expect((await request(server).get(`/listings/${listing.id}`)).status).toBe(404);
    const txAfter = await request(server).get(`/transactions/${tx.id}`).set(buyer.auth).expect(200);
    expect(txAfter.body.status).toBe('rembourse');
    expect(txAfter.body.resolutionNote).toMatch(/Compte vendeur supprimé par la modération/);
    // Journal : qui, quoi, sur qui, pourquoi
    const entry = await audit.findOne({ where: { action: 'user.delete', targetId: seller.id } });
    expect(entry).toBeTruthy();
    expect(entry!.adminId).toBe(admin.id);
    expect(entry!.details).toMatchObject({ reason: 'Fraude avérée sur plusieurs ventes', refundedTransactions: [tx.id] });
    const remboursement = await audit.findOne({ where: { action: 'transaction.force_refund', targetId: tx.id } });
    expect(remboursement).toBeTruthy();
    // Déjà supprimé (effacé de la base, AUDIT §41) : introuvable ; visible dans le journal via l'API
    await request(server).delete(`/admin/users/${seller.id}`).set(admin.auth).send({ reason: 'Nouvelle tentative', confirm: 'SUPPRIMER' }).expect(404);
    const log = await request(server).get(`/admin/audit-log?action=user.delete&target_id=${seller.id}`).set(admin.auth).expect(200);
    expect(log.body.items).toHaveLength(1);
    expect(log.body.items[0].adminName).toBeTruthy();
  });

  it('supprime définitivement une annonce avec motif et confirmation ; le propriétaire est prévenu ; journal', async () => {
    const admin = await login(app);
    await makeAdmin(app, admin);
    const seller = await login(app);
    const listing = await createListing(app, seller, { title: 'Contrefaçon de sac à main' });
    await request(server).delete(`/admin/listings/${listing.id}`).set(admin.auth).send({ reason: 'Contrefaçon' }).expect(400);
    await request(server).delete(`/admin/listings/${listing.id}?reason=Contrefaçon`).set(admin.auth).expect(400); // l'ancien paramètre d'URL ne suffit plus
    await request(server).delete(`/admin/listings/${listing.id}`).set(admin.auth).send({ reason: 'Contrefaçon signalée par la marque', confirm: 'SUPPRIMER' }).expect(200);
    await request(server).get(`/listings/${listing.id}`).expect(404);
    await request(server).get(`/admin/listings/${listing.id}`).set(admin.auth).expect(404);
    const entry = await audit.findOne({ where: { action: 'listing.delete', targetId: listing.id } });
    expect(entry!.details).toMatchObject({ reason: 'Contrefaçon signalée par la marque', hardDeleted: true });
    const notifs = await request(server).get('/notifications').set(seller.auth).expect(200);
    const titles = (Array.isArray(notifs.body) ? notifs.body : notifs.body.items).map((n: any) => n.title);
    expect(titles).toContain('Votre annonce a été retirée');
  });

  it('transactions : rembourser, libérer ou annuler hors litige (fraude, conflit) ; fiche détaillée ; journal distinct de l\'arbitrage', async () => {
    const admin = await login(app);
    await makeAdmin(app, admin);
    const seller = await login(app);
    const buyer = await login(app);
    const buy = async (price: number, delivery = false) => {
      const l = await createListing(app, seller, { price, deliveryAvailable: delivery });
      const body = delivery ? { listingId: l.id, deliveryMethod: 'colissimo', shippingAddress: { name: 'Alex A.', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' } } : { listingId: l.id };
      return { listing: l, tx: (await request(server).post('/transactions').set(buyer.auth).send(body).expect(201)).body.transaction };
    };

    // Annuler une vente en séquestre (vendeur injoignable) : acheteur remboursé, annonce toujours en ligne
    const a = await buy(30);
    await request(server).post(`/admin/transactions/${a.tx.id}/resolve`).set(admin.auth).send({ decision: 'annuler', note: 'Vendeur injoignable depuis 5 jours' }).expect(201);
    expect((await request(server).get(`/transactions/${a.tx.id}`).set(buyer.auth)).body.status).toBe('annulee');
    expect((await request(server).get(`/listings/${a.listing.id}`)).body.status).toBe('en_ligne');
    expect(await audit.findOne({ where: { action: 'transaction.cancel', targetId: a.tx.id } })).toBeTruthy();

    // Forcer la capture d'une vente expédiée (acheteur de mauvaise foi) : vendeur payé
    const b = await buy(40, true);
    await request(server).post(`/transactions/${b.tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000009' }).expect(201);
    await request(server).post(`/admin/transactions/${b.tx.id}/resolve`).set(admin.auth).send({ decision: 'liberer', note: 'Preuve de livraison fournie par le transporteur' }).expect(201);
    expect((await request(server).get(`/transactions/${b.tx.id}`).set(seller.auth)).body.status).toBe('confirme');
    expect((await request(server).get(`/listings/${b.listing.id}`)).body.status).toBe('vendue');
    expect(await audit.findOne({ where: { action: 'transaction.force_capture', targetId: b.tx.id } })).toBeTruthy();

    // Forcer un remboursement d'une vente expédiée (colis vide avéré)
    const c = await buy(25, true);
    await request(server).post(`/transactions/${c.tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000010' }).expect(201);
    await request(server).post(`/admin/transactions/${c.tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Colis vide constaté par le transporteur' }).expect(201);
    expect((await request(server).get(`/transactions/${c.tx.id}`).set(buyer.auth)).body.status).toBe('rembourse');
    expect(await audit.findOne({ where: { action: 'transaction.force_refund', targetId: c.tx.id } })).toBeTruthy();

    // Litige classique : l'action reste « transaction.resolve »
    const d = await buy(20);
    await request(server).post(`/transactions/${d.tx.id}/dispute`).set(buyer.auth).send({ reason: 'Objet non conforme à la description.' }).expect(201);
    await request(server).post(`/admin/transactions/${d.tx.id}/resolve`).set(admin.auth).send({ decision: 'liberer', note: 'Description conforme, photos à l\'appui' }).expect(201);
    expect(await audit.findOne({ where: { action: 'transaction.resolve', targetId: d.tx.id } })).toBeTruthy();

    // Annuler une transaction déjà capturée : refusé ; terminée : aucune décision
    await request(server).post(`/admin/transactions/${b.tx.id}/resolve`).set(admin.auth).send({ decision: 'annuler', note: 'Trop tard pour annuler' }).expect(400);
    await request(server).post(`/admin/transactions/${b.tx.id}/resolve`).set(admin.auth).send({ decision: 'liberer', note: 'Déjà terminée' }).expect(400);

    // Fiche détaillée : parties, annonce, expédition, journal lié, jamais le code de remise
    const detail = await request(server).get(`/admin/transactions/${c.tx.id}`).set(admin.auth).expect(200);
    expect(detail.body.buyer.id).toBe(buyer.id);
    expect(detail.body.seller.id).toBe(seller.id);
    expect(detail.body.listing.id).toBe(c.listing.id);
    expect(detail.body.shippingAddress.city).toBe('Paris');
    expect(detail.body.handoverCode).toBeUndefined();
    expect(detail.body.audit.map((e: any) => e.action)).toContain('transaction.force_refund');
    await request(server).get(`/admin/transactions/${c.tx.id}`).set(buyer.auth).expect(403);
    await request(server).get('/admin/transactions/00000000-0000-4000-8000-000000000000').set(admin.auth).expect(404);
  });
});
