import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { Listing } from '../src/listings/listing.entity';
import { ListingsService } from '../src/listings/listings.service';
import { createApp, createListing, login, makeAdmin, PNG_1x1 } from './utils';

/**
 * Phase 31 (AUDIT §54) : annonces sans expiration ; après publication, la catégorie, la marque et les photos de
 * publication sont verrouillées pour le vendeur (anti-fraude), l'admin garde tous ses pouvoirs.
 */
describe('Phase 31 : annonces sans expiration, verrous anti-fraude après publication', () => {
  let app: INestApplication;
  let server: any;
  let listingRepo: Repository<Listing>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    listingRepo = app.get(getRepositoryToken(Listing));
  });
  afterAll(() => app.close());

  const upload = (id: string, auth: Record<string, string>, name = 'a.png') =>
    request(server).post(`/listings/${id}/photos`).set(auth).attach('files', PNG_1x1, { filename: name, contentType: 'image/png' });

  it('aucune expiration : pas de date à la publication, plus de tâche planifiée, une annonce très ancienne reste en ligne et se renouvelle sans date', async () => {
    const user = await login(app);
    const listing = await createListing(app, user);
    expect(listing.expiresAt ?? null).toBeNull();
    expect((app.get(ListingsService) as unknown as { expireListings?: unknown }).expireListings).toBeUndefined();
    // Publiée il y a trois ans, avec une ancienne date d'expiration dépassée en base
    await listingRepo.update(listing.id, { publishedAt: new Date(Date.now() - 3 * 365 * 86_400_000), expiresAt: new Date(Date.now() - 365 * 86_400_000) });
    const pub = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(pub.body.status).toBe('en_ligne');
    const search = await request(server).get('/listings?page_size=50').expect(200);
    expect(search.body.items.map((l: { id: string }) => l.id)).toContain(listing.id);
    const renewed = await request(server).post(`/listings/${listing.id}/renew`).set(user.auth).expect(201);
    expect(renewed.body.status).toBe('en_ligne');
    const paused = await request(server).patch(`/listings/${listing.id}`).set(user.auth).send({ status: 'desactivee' }).expect(200);
    expect(paused.body.status).toBe('desactivee');
    const back = await request(server).patch(`/listings/${listing.id}`).set(user.auth).send({ status: 'en_ligne' }).expect(200);
    expect(back.body.status).toBe('en_ligne');
  });

  it('brouillon : tout reste modifiable (catégorie, marque, photos) ; à la publication, les photos présentes sont verrouillées', async () => {
    const user = await login(app);
    const draft = await createListing(app, user, { draft: true, categorySlug: 'telephonie', attributes: { marque: 'Apple', modele: 'iPhone 13', stockage: '128 Go' } });
    const p1 = (await upload(draft.id, user.auth).expect(201)).body[0];
    const p2 = (await upload(draft.id, user.auth, 'b.png').expect(201)).body[0];
    expect(p1.lockedAt ?? null).toBeNull();
    await request(server).patch(`/listings/${draft.id}`).set(user.auth).send({ categorySlug: 'informatique', attributes: { marque: 'Lenovo', type_produit: 'Ordinateur portable' } }).expect(200); // AUDIT §69 : la publication exige les attributs obligatoires
    await request(server).patch(`/listings/${draft.id}/photos/order`).set(user.auth).send({ photoIds: [p2.id, p1.id] }).expect(200);
    await request(server).delete(`/listings/${draft.id}/photos/${p1.id}`).set(user.auth).expect(204);

    const published = await request(server).patch(`/listings/${draft.id}`).set(user.auth).send({ status: 'en_ligne' }).expect(200);
    expect(published.body.status).toBe('en_ligne');
    const detail = await request(server).get(`/listings/${draft.id}`).set(user.auth).expect(200);
    expect(detail.body.locks).toEqual({ category: true, brand: true, photos: true });
    expect(detail.body.photos).toHaveLength(1);
    expect(detail.body.photos[0].lockedAt).toBeTruthy();
  });

  it('annonce publiée : changement de catégorie, de marque, retrait ou déplacement d\'une photo de publication refusés (400) ; le reste se modifie ; ajout de photos permis, après les verrouillées', async () => {
    const seller = await login(app);
    const listing = await createListing(app, seller, { categorySlug: 'telephonie', title: 'iPhone 13 128 Go noir', attributes: { marque: 'Apple', modele: 'iPhone 13', stockage: '128 Go' } });
    // Photos du dépôt (envoyées juste après la création) : elles font partie de la publication
    const first = (await upload(listing.id, seller.auth).expect(201)).body[0];
    const second = (await upload(listing.id, seller.auth, 'b.png').expect(201)).body[0];
    expect(first.lockedAt).toBeTruthy();

    const cat = await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ categorySlug: 'informatique' }).expect(400);
    expect(cat.body.message).toMatch(/catégorie d'une annonce publiée ne peut plus être modifiée/);
    const brand = await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ attributes: { marque: 'Samsung', modele: 'Galaxy S21', stockage: '128 Go' } }).expect(400);
    expect(brand.body.message).toMatch(/marque d'une annonce publiée ne peut plus être modifiée/);
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ attributes: { modele: 'iPhone 13', stockage: '128 Go' } }).expect(400); // marque retirée
    const del = await request(server).delete(`/listings/${listing.id}/photos/${first.id}`).set(seller.auth).expect(400);
    expect(del.body.message).toMatch(/ne peut plus être retirée ni remplacée/);
    const swap = await request(server).patch(`/listings/${listing.id}/photos/order`).set(seller.auth).send({ photoIds: [second.id, first.id] }).expect(400);
    expect(swap.body.message).toMatch(/gardent leur place/);

    // Même catégorie et même marque renvoyées par le formulaire : acceptées ; titre, prix, description, autres critères : modifiables
    const ok = await request(server).patch(`/listings/${listing.id}`).set(seller.auth)
      .send({ categorySlug: 'telephonie', title: 'iPhone 13 128 Go noir, très bon état', price: 380, description: 'Batterie à 91 %, vendu avec sa boîte et un chargeur, jamais réparé.', attributes: { marque: 'Apple', modele: 'iPhone 13', stockage: '256 Go' } });
    expect([ok.status, ok.body.message]).toEqual([200, undefined]);
    expect(ok.body.title).toBe('iPhone 13 128 Go noir, très bon état');
    expect(ok.body.price).toBe(380);
    expect(ok.body.attributes.stockage).toBe('256 Go');

    // Hors de la fenêtre de dépôt : une photo ajoutée plus tard est libre (retirable, déplaçable après les verrouillées)
    await listingRepo.update(listing.id, { publishedAt: new Date(Date.now() - 3_600_000) });
    const later = (await upload(listing.id, seller.auth, 'c.png').expect(201)).body[0];
    const later2 = (await upload(listing.id, seller.auth, 'd.png').expect(201)).body[0];
    expect(later.lockedAt ?? null).toBeNull();
    await request(server).patch(`/listings/${listing.id}/photos/order`).set(seller.auth).send({ photoIds: [later.id, first.id, second.id, later2.id] }).expect(400); // jamais devant une photo de publication
    const moved = await request(server).patch(`/listings/${listing.id}/photos/order`).set(seller.auth).send({ photoIds: [first.id, second.id, later2.id, later.id] }).expect(200);
    expect(moved.body.map((p: { id: string }) => p.id)).toEqual([first.id, second.id, later2.id, later.id]);
    await request(server).delete(`/listings/${listing.id}/photos/${later.id}`).set(seller.auth).expect(204);

    // Pause puis remise en ligne : la photo ajoutée entre-temps rejoint les photos verrouillées ; la catégorie reste verrouillée en pause
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ status: 'desactivee' }).expect(200);
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ categorySlug: 'informatique' }).expect(400);
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ status: 'en_ligne' }).expect(200);
    await request(server).delete(`/listings/${listing.id}/photos/${later2.id}`).set(seller.auth).expect(400);
  });

  it('admin : retire une photo verrouillée (motif, journal, vendeur prévenu), modifie et supprime l\'annonce ; un membre ne peut pas utiliser la route admin', async () => {
    const seller = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);
    const listing = await createListing(app, seller);
    const photo = (await upload(listing.id, seller.auth).expect(201)).body[0];
    await request(server).delete(`/listings/${listing.id}/photos/${photo.id}`).set(seller.auth).expect(400);
    await request(server).delete(`/admin/listings/${listing.id}/photos/${photo.id}`).set(seller.auth).send({ reason: 'Plaque visible' }).expect(403);
    await request(server).delete(`/admin/listings/${listing.id}/photos/${photo.id}`).set(admin.auth).send({}).expect(400); // motif obligatoire
    await request(server).delete(`/admin/listings/${listing.id}/photos/${photo.id}`).set(admin.auth).send({ reason: 'Plaque d\'immatriculation lisible sur la photo' }).expect(200);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.photos).toHaveLength(0);
    const log = await request(server).get(`/admin/audit-log?target_id=${listing.id}&action=listing.photo.delete`).set(admin.auth).expect(200);
    expect(JSON.stringify(log.body.items[0].details)).toContain('"wasLocked":true');
    await request(server).patch(`/admin/listings/${listing.id}`).set(admin.auth).send({ title: 'Canapé trois places en velours vert (titre corrigé)' }).expect(200);
    await request(server).delete(`/admin/listings/${listing.id}`).set(admin.auth).send({ reason: 'Annonce signalée, retirée après vérification', confirm: 'SUPPRIMER' }).expect(200);
    await request(server).get(`/listings/${listing.id}`).expect(404);
  });
});
