import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { DemoCatalogueService } from '../src/demo-catalogue/demo-catalogue.service';
import { Listing } from '../src/listings/listing.entity';
import { User } from '../src/users/user.entity';
import sharp from 'sharp';
import { createApp, login, makeAdmin } from './utils';

/**
 * Phase 43 (AUDIT §71) : catalogue de démonstration — ensemencement côté serveur (comptes fictifs marqués « démo », annonces
 * validées contre les schémas, photos passées par le traitement d'image, reprise idempotente), garde-fous (aucun paiement en
 * ligne, numéro jamais révélé, indicateur invisible du public), réponse automatique honnête au premier message d'un membre,
 * suivi et réponse par l'administration signée « Équipe Trocoin », identifiants remis une seule fois.
 */
describe('Phase 43 : catalogue de démonstration', () => {
  let app: INestApplication;
  let server: any;
  let demo: DemoCatalogueService;
  let users: Repository<User>;
  let listings: Repository<Listing>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    demo = app.get(DemoCatalogueService);
    users = app.get(getRepositoryToken(User));
    listings = app.get(getRepositoryToken(Listing));
    // Aucun réseau : chaque « téléchargement » renvoie une image PNG valide, agrandie pour passer les contrôles de taille
    const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 60, g: 120, b: 90 } } }).png().toBuffer();
    demo.fetchImage = async () => png;
    // Photos de test pour les premières annonces du jeu de données (le fichier réel est rempli par resolve-photos.js)
    const photos = (demo as unknown as { photos: Record<string, unknown[]> }).photos;
    const first = (demo as unknown as { listings: Array<{ key: string }> }).listings.slice(0, 12);
    for (const l of first) photos[l.key] = [{ id: `t:${l.key}:1`, url: 'https://exemple.test/1.png', source: 'test', author: 'x', landing: 'https://exemple.test', license: 'CC0' }, { id: `t:${l.key}:2`, url: 'https://exemple.test/2.png', source: 'test', author: 'x', landing: 'https://exemple.test', license: 'CC0' }];
  });
  afterAll(() => app.close());

  it('ensemencement (12 annonces) : comptes démo, annonces en ligne avec attributs valides et photos, reprise sans doublon, identifiants remis une fois', async () => {
    const admin = await login(app);
    await makeAdmin(app, admin);
    const summaryBefore = await request(server).get('/admin/demo-catalogue').set(admin.auth).expect(200);
    expect(summaryBefore.body.dataset.listings).toBe(600);
    expect(summaryBefore.body.dataset.accounts).toBe(50);
    expect(Object.values(summaryBefore.body.dataset.byFamily as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(600);

    const state = await demo.runNow({ limit: 12 });
    expect(state.status).toBe('done');
    expect(state.listings.created).toBe(12);
    expect(state.listings.failed).toBe(0);
    expect(state.photos.created).toBe(24);
    expect(state.accounts.created).toBeGreaterThan(0);

    const demoUsers = await users.find({ where: { isDemoAccount: true } });
    expect(demoUsers.length).toBe(state.accounts.created);
    for (const u of demoUsers) {
      expect(u.securePaymentDisabled).toBe(true);
      expect(u.phonePublic).toBe(false);
      expect(u.email).toMatch(/^ousbaali11\+demo-.*@gmail\.com$/);
      expect(u.phoneNumber).toMatch(/^\+33639980/);
    }
    const created = await listings.find({ where: { userId: demoUsers[0].id } });
    expect(created.length).toBeGreaterThan(0);
    for (const l of created) {
      expect(l.status).toBe('en_ligne');
      expect(l.deliveryAvailable).toBe(false);
      expect(l.externalRef).toMatch(/^demo:/);
    }
    // Identifiants : une seule lecture
    const creds = await request(server).post('/admin/demo-catalogue/credentials').set(admin.auth).expect(200);
    expect(creds.body.items.length).toBe(state.accounts.created);
    expect(creds.body.items[0].password).toMatch(/-Tr0c$/);
    const again = await request(server).post('/admin/demo-catalogue/credentials').set(admin.auth).expect(200);
    expect(again.body.items).toEqual([]);
    // Reprise : rien n'est recréé
    const second = await demo.runNow({ limit: 12 });
    expect(second.listings.created).toBe(0);
    expect(second.listings.existing).toBe(12);
    expect(second.photos.created).toBe(0);
    expect(second.accounts.created).toBe(0);
    const summary = await request(server).get('/admin/demo-catalogue').set(admin.auth).expect(200);
    expect(summary.body.database.listings).toBe(12);
    expect(summary.body.database.online).toBe(12);
    // Route réservée aux administrateurs
    const member = await login(app);
    await request(server).get('/admin/demo-catalogue').set(member.auth).expect(403);
  });

  it('garde-fous publics : pas de paiement sécurisé, numéro jamais révélé, indicateur « démo » invisible, photos servies', async () => {
    const member = await login(app);
    const demoUser = (await users.findOne({ where: { isDemoAccount: true } }))!;
    const listing = (await listings.findOne({ where: { userId: demoUser.id, status: 'en_ligne' } }))!;
    const detail = await request(server).get(`/listings/${listing.id}`).set(member.auth).expect(200);
    expect(detail.body.phoneAvailable).toBe(false);
    expect(detail.body.photos.length).toBe(2);
    expect(detail.body.photos[0].thumbUrl).toBeTruthy();
    expect(detail.body.seller.isDemoAccount).toBeUndefined();
    expect(JSON.stringify(detail.body)).not.toContain('isDemoAccount');
    await request(server).post(`/listings/${listing.id}/phone`).set(member.auth).expect(404);
    const quote = await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(member.auth).expect(200);
    expect(quote.body.eligible).toBe(false);
    expect(quote.body.reason).toContain('main propre');
    await request(server).post('/transactions').set(member.auth).send({ listingId: listing.id, deliveryMethod: 'main_propre' }).expect(400);
    const profile = await request(server).get(`/users/${demoUser.id}/profile`).expect(200);
    expect(JSON.stringify(profile.body)).not.toContain('isDemoAccount');
  });

  it('messagerie : réponse automatique honnête une seule fois, administration prévenue, réponse de l\'équipe signée et visible', async () => {
    const admin = await login(app);
    await makeAdmin(app, admin);
    const member = await login(app);
    const demoUser = (await users.findOne({ where: { isDemoAccount: true } }))!;
    const listing = (await listings.findOne({ where: { userId: demoUser.id, status: 'en_ligne' } }))!;
    const conv = await request(server).post('/conversations').set(member.auth).send({ listingId: listing.id, message: 'Bonjour, est-ce toujours disponible ?' }).expect(201);
    let detail = await request(server).get(`/conversations/${conv.body.id}`).set(member.auth).expect(200);
    expect(detail.body.listing.securePayment).toBe(false); // le fil ne propose pas « Acheter » sur une annonce de démonstration
    const auto = detail.body.messages.filter((m: any) => m.meta?.auto === 'demo');
    expect(auto).toHaveLength(1);
    expect(auto[0].senderId).toBe(demoUser.id);
    expect(auto[0].content).toContain('catalogue de lancement de Trocoin');
    expect(auto[0].content).toContain('Aucun paiement');
    // Un second message ne déclenche pas une seconde réponse automatique
    await request(server).post(`/conversations/${conv.body.id}/messages`).set(member.auth).send({ content: 'Je peux passer demain.' }).expect(201);
    detail = await request(server).get(`/conversations/${conv.body.id}`).set(member.auth).expect(200);
    expect(detail.body.messages.filter((m: any) => m.meta?.auto === 'demo')).toHaveLength(1);
    // L'administration voit la conversation en attente et répond au nom du compte, signée « Équipe Trocoin »
    const adminNotifs = await request(server).get('/notifications').set(admin.auth).expect(200);
    expect(JSON.stringify(adminNotifs.body)).toContain('compte de démonstration');
    const list = await request(server).get('/admin/demo-catalogue/conversations').set(admin.auth).expect(200);
    const mine = list.body.find((c: any) => c.id === conv.body.id);
    expect(mine).toMatchObject({ needsReply: true, buyer: { id: member.id } });
    expect(mine.unreadFromBuyer).toBe(2);
    const thread = await request(server).get(`/admin/demo-catalogue/conversations/${conv.body.id}`).set(admin.auth).expect(200);
    expect(thread.body.length).toBe(3);
    await request(server).post(`/admin/demo-catalogue/conversations/${conv.body.id}/reply`).set(admin.auth).send({ content: 'Oui, disponible : quel créneau vous arrange ?' }).expect(201);
    detail = await request(server).get(`/conversations/${conv.body.id}`).set(member.auth).expect(200);
    const staff = detail.body.messages.filter((m: any) => m.meta?.staff === 1);
    expect(staff).toHaveLength(1);
    expect(staff[0].content).toMatch(/^Équipe Trocoin — Oui, disponible/);
    const after = await request(server).get('/admin/demo-catalogue/conversations').set(admin.auth).expect(200);
    expect(after.body.find((c: any) => c.id === conv.body.id)).toMatchObject({ needsReply: false, unreadFromBuyer: 0 });
    // Un membre ordinaire ne peut pas utiliser ces routes ; une conversation sans compte démo est refusée
    await request(server).get('/admin/demo-catalogue/conversations').set(member.auth).expect(403);
    const seller = await login(app);
    const normal = await request(server).post('/listings').set(seller.auth).send({ title: 'Table basse en chêne', description: 'Table basse en chêne massif, très bon état, à venir chercher.', categorySlug: 'ameublement', price: 80, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003' }).expect(201);
    const normalConv = await request(server).post('/conversations').set(member.auth).send({ listingId: normal.body.id, message: 'Bonjour' }).expect(201);
    const normalDetail = await request(server).get(`/conversations/${normalConv.body.id}`).set(member.auth).expect(200);
    expect(normalDetail.body.messages.filter((m: any) => m.meta?.auto === 'demo')).toHaveLength(0);
    await request(server).post(`/admin/demo-catalogue/conversations/${normalConv.body.id}/reply`).set(admin.auth).send({ content: 'x' }).expect(400);
  });
});
