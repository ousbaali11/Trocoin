import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { User } from '../src/users/user.entity';
import { createApp, createListing, login } from './utils';

/**
 * Phase 21 (16 septembre 2026) : numéro de mobile obligatoire pour publier (celui du compte,
 * réutilisé pour toutes les annonces), « Voir le numéro » réservé aux membres connectés et
 * masquable, statistiques par annonce (vues, favoris, conversations, clics) visibles du
 * propriétaire seul.
 */
describe('Phase 21 : téléphone au dépôt, « Voir le numéro », statistiques par annonce', () => {
  let app: INestApplication;
  let server: any;
  let users: Repository<User>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    users = app.get(getRepositoryToken(User));
  });
  afterAll(() => app.close());

  it('publier exige un numéro de mobile français sur le compte ; brouillon possible sans ; le numéro ajouté est normalisé et unique', async () => {
    const seller = await login(app);
    await users.update(seller.id, { phoneNumber: '' }); // compte sans numéro (cas d'un compte importé)
    const refused = await request(server).post('/listings').set(seller.auth).send({ title: 'Table basse en chêne', description: 'Table basse en très bon état, pieds compas.', categorySlug: 'ameublement', price: 80 });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/numéro de mobile français/);
    const draft = await request(server).post('/listings').set(seller.auth).send({ title: 'Table basse en chêne', description: 'Table basse en très bon état, pieds compas.', categorySlug: 'ameublement', price: 80, draft: true }).expect(201);
    expect(draft.body.status).toBe('brouillon');
    // Publier le brouillon : même exigence
    const publishRefused = await request(server).patch(`/listings/${draft.body.id}`).set(seller.auth).send({ status: 'en_ligne' });
    expect(publishRefused.status).toBe(400);

    // Numéro invalide, puis étranger, puis déjà pris, puis valide (normalisé)
    await request(server).patch('/users/me').set(seller.auth).send({ phoneNumber: '01 23 45 67 89' }).expect(400);
    await request(server).patch('/users/me').set(seller.auth).send({ phoneNumber: '+32 470 12 34 56' }).expect(400);
    const other = await login(app);
    await request(server).patch('/users/me').set(seller.auth).send({ phoneNumber: other.phone }).expect(409);
    const me = await request(server).patch('/users/me').set(seller.auth).send({ phoneNumber: '06 98 76 54 32' }).expect(200);
    expect(me.body.phoneNumber).toBe('+33698765432');
    expect(me.body.phonePublic).toBe(true);
    // Un numéro déjà enregistré ne se modifie pas par ce chemin
    await request(server).patch('/users/me').set(seller.auth).send({ phoneNumber: '06 11 22 33 44' }).expect(400);
    await request(server).patch('/users/me').set(seller.auth).send({ phoneNumber: '0698765432' }).expect(200); // même numéro : accepté sans changement

    const published = await request(server).patch(`/listings/${draft.body.id}`).set(seller.auth).send({ status: 'en_ligne' }).expect(200);
    expect(published.body.status).toBe('en_ligne');
  });

  it('« Voir le numéro » : proposé si le vendeur l\'affiche, délivré aux membres connectés seulement, compté ; masquable', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { title: 'Vélo de ville hollandais' });

    const anon = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(anon.body.phoneAvailable).toBe(true);
    expect(JSON.stringify(anon.body)).not.toContain(seller.phone); // jamais dans la fiche publique
    await request(server).post(`/listings/${listing.id}/phone`).expect(401);

    const reveal = await request(server).post(`/listings/${listing.id}/phone`).set(buyer.auth).expect(200);
    expect(reveal.body.phoneNumber).toBe(seller.phone);
    await request(server).post(`/listings/${listing.id}/phone`).set(buyer.auth).expect(200);
    await request(server).post(`/listings/${listing.id}/phone`).set(seller.auth).expect(200); // le propriétaire ne compte pas
    const mine = await request(server).get('/listings/mine').set(seller.auth).expect(200);
    expect(mine.body.find((l: any) => l.id === listing.id).stats.phoneClicks).toBe(2);

    // Masqué : plus proposé ni délivré
    await request(server).patch('/users/me').set(seller.auth).send({ phonePublic: false }).expect(200);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.phoneAvailable).toBe(false);
    await request(server).post(`/listings/${listing.id}/phone`).set(buyer.auth).expect(404);
    // Annonce hors ligne : jamais délivré
    await request(server).patch('/users/me').set(seller.auth).send({ phonePublic: true }).expect(200);
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ status: 'desactivee' }).expect(200);
    await request(server).post(`/listings/${listing.id}/phone`).set(buyer.auth).expect(404);
  });

  it('statistiques par annonce : vues, favoris, conversations, clics — propriétaire seul, à jour à chaque lecture', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const other = await login(app);
    const listing = await createListing(app, seller, { title: 'Poussette compacte' });
    const statsOf = async () => (await request(server).get('/listings/mine').set(seller.auth).expect(200)).body.find((l: any) => l.id === listing.id).stats;
    expect(await statsOf()).toEqual({ views: 0, favorites: 0, messages: 0, phoneClicks: 0 });

    // Une vue = fiche affichée dans un navigateur (POST view) ; les lectures API ne comptent pas
    await request(server).get(`/listings/${listing.id}`).set(buyer.auth).expect(200);
    await request(server).get(`/listings/${listing.id}`).expect(200);
    expect((await statsOf()).views).toBe(0);
    await request(server).post(`/listings/${listing.id}/view`).set(buyer.auth).expect(200);
    await request(server).post(`/listings/${listing.id}/view`).expect(200); // visiteur anonyme : compté
    await request(server).post(`/listings/${listing.id}/view`).set(seller.auth).expect(200); // le propriétaire ne compte pas
    await request(server).post(`/listings/${listing.id}/favorite`).set(buyer.auth).expect(201);
    await request(server).post(`/listings/${listing.id}/favorite`).set(other.auth).expect(201);
    await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Bonjour, toujours disponible ?' }).expect(201);
    await request(server).post(`/listings/${listing.id}/phone`).set(other.auth).expect(200);
    expect(await statsOf()).toEqual({ views: 2, favorites: 2, messages: 1, phoneClicks: 1 });
    await request(server).delete(`/listings/${listing.id}/favorite`).set(other.auth).expect(200);
    expect((await statsOf()).favorites).toBe(1);
    // La vue d'un membre alimente aussi son historique « Annonces consultées » ; pas celle du propriétaire
    await request(server).post(`/listings/${listing.id}/view`).set(other.auth).expect(200);
    expect((await statsOf()).views).toBe(3);
    expect((await request(server).get('/listings/history/ids').set(other.auth).expect(200)).body).toEqual([listing.id]);
    expect((await request(server).get('/listings/history/ids').set(seller.auth).expect(200)).body).toEqual([]);
    // Annonce hors ligne : plus de vue comptée
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ status: 'desactivee' }).expect(200);
    await request(server).post(`/listings/${listing.id}/view`).set(other.auth).expect(200);
    expect((await statsOf()).views).toBe(3);
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ status: 'en_ligne' }).expect(200);

    // Jamais publiques : ni sur la fiche, ni dans les résultats, ni pour un autre membre
    const detail = await request(server).get(`/listings/${listing.id}`).set(buyer.auth).expect(200);
    expect(detail.body.stats).toBeUndefined();
    expect(detail.body.phoneClicksCount).toBeUndefined();
    const search = await request(server).get('/listings?q=poussette').expect(200);
    const card = search.body.items.find((l: any) => l.id === listing.id);
    expect(card.stats).toBeUndefined();
    expect(card.phoneClicksCount).toBeUndefined();
    const buyerMine = await request(server).get('/listings/mine').set(buyer.auth).expect(200);
    expect(buyerMine.body.find((l: any) => l.id === listing.id)).toBeUndefined();
  });
});
