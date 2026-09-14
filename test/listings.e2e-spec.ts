import { INestApplication } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { UPLOAD_DIR } from '../src/common/upload/image-upload';
import { createApp, createListing, login, PNG_1x1 } from './utils';

describe('Annonces : dépôt, validation, recherche, photos, contrôle d\'accès', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('expose l\'arborescence des catégories et les schémas de champs', async () => {
    const tree = await request(server).get('/categories/tree').expect(200);
    expect(tree.body.length).toBe(12);
    const vehicules = tree.body.find((c: any) => c.slug === 'vehicules');
    expect(vehicules.children.map((c: any) => c.slug)).toContain('voitures');
    const schema = await request(server).get('/categories/voitures/schema').expect(200);
    expect(schema.body.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(['marque', 'kilometrage', 'carburant']));
    await request(server).get('/categories/inconnue/schema').expect(404);
  });

  it('refuse une annonce voiture sans les champs obligatoires, l\'accepte complète', async () => {
    const user = await login(app);
    const bad = await request(server).post('/listings').set(user.auth).send({
      title: 'Peugeot 208 essence',
      description: 'Voiture bien entretenue, contrôle technique OK.',
      categorySlug: 'voitures',
      price: 8900,
      attributes: { marque: 'Peugeot' },
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body.message)).toMatch(/Kilométrage/);

    const good = await createListing(app, user, {
      title: 'Peugeot 208 essence',
      description: 'Voiture bien entretenue, contrôle technique OK.',
      categorySlug: 'voitures',
      price: 8900,
      condition: 'bon_etat',
      attributes: { marque: 'Peugeot', modele: '208', annee: 2018, kilometrage: 64000, carburant: 'Essence', boite: 'Manuelle', inconnu: 'ignoré' },
      deliveryAvailable: true,
    });
    expect(good.status).toBe('en_ligne');
    expect(good.attributes.inconnu).toBeUndefined();
    expect(good.deliveryAvailable).toBe(false); // véhicules : pas de livraison
    expect(good.expiresAt).toBeDefined();
    expect(good.latitude).toBeCloseTo(45.87, 0); // centroïde du 69
  });

  it('valide les bornes : prix négatif, code postal, type de prix sans prix, statut interdit', async () => {
    const user = await login(app);
    await request(server).post('/listings').set(user.auth).send({ title: 'abc', description: 'description valide ici', categorySlug: 'ameublement', price: -5 }).expect(400);
    await request(server).post('/listings').set(user.auth).send({ title: 'abc', description: 'description valide ici', categorySlug: 'ameublement', price: 10, postalCode: '123' }).expect(400);
    const noPrice = await request(server).post('/listings').set(user.auth).send({ title: 'abc', description: 'description valide ici', categorySlug: 'ameublement', priceType: 'fixe' });
    expect(noPrice.status).toBe(400);
    const free = await createListing(app, user, { priceType: 'gratuit', price: undefined });
    expect(free.price).toBeNull();
    await request(server).patch(`/listings/${free.id}`).set(user.auth).send({ status: 'refusee' }).expect(400);
    await request(server).patch(`/listings/${free.id}`).set(user.auth).send({ condition: 'comme_neuf' }).expect(400);
  });

  it('pré-modération : mots-clés interdits ou coordonnées -> en_attente, invisible publiquement', async () => {
    const user = await login(app);
    const flagged = await createListing(app, user, { title: 'Réplique montre AAA+', description: 'Copie parfaite, appelez le 06 12 34 56 78.' });
    expect(flagged.status).toBe('en_attente');
    expect(flagged.moderationReason).toMatch(/contrefaçon/);
    await request(server).get(`/listings/${flagged.id}`).expect(404);
    const asOwner = await request(server).get(`/listings/${flagged.id}`).set(user.auth).expect(200);
    expect(asOwner.body.isOwner).toBe(true);
    const search = await request(server).get('/listings?q=AAA').expect(200);
    expect(search.body.items.find((l: any) => l.id === flagged.id)).toBeUndefined();
  });

  it('brouillon : non publié, publiable ensuite ; duplication ; renouvellement', async () => {
    const user = await login(app);
    const draft = await createListing(app, user, { draft: true, title: 'Table basse chêne', attributes: {} });
    expect(draft.status).toBe('brouillon');
    await request(server).get(`/listings/${draft.id}`).expect(404);
    const pub = await request(server).patch(`/listings/${draft.id}`).set(user.auth).send({ status: 'en_ligne' }).expect(200);
    expect(pub.body.status).toBe('en_ligne');
    expect(pub.body.publishedAt).toBeDefined();
    const dup = await request(server).post(`/listings/${draft.id}/duplicate`).set(user.auth).expect(201);
    expect(dup.body.status).toBe('brouillon');
    expect(dup.body.id).not.toBe(draft.id);
    await request(server).patch(`/listings/${draft.id}`).set(user.auth).send({ status: 'desactivee' }).expect(200);
    const renewed = await request(server).post(`/listings/${draft.id}/renew`).set(user.auth).expect(201);
    expect(renewed.body.status).toBe('en_ligne');
  });

  it('contrôle d\'accès : seul le propriétaire modifie / supprime ; vues non comptées pour lui', async () => {
    const owner = await login(app);
    const other = await login(app);
    const listing = await createListing(app, owner);
    await request(server).patch(`/listings/${listing.id}`).set(other.auth).send({ title: 'Piraté' }).expect(403);
    await request(server).delete(`/listings/${listing.id}`).set(other.auth).expect(403);
    await request(server).post(`/listings/${listing.id}/renew`).set(other.auth).expect(403);
    await request(server).patch(`/listings/${listing.id}`).set(owner.auth).send({ title: 'Canapé trois places (modifié)' }).expect(200);

    await request(server).get(`/listings/${listing.id}`).set(owner.auth).expect(200);
    await request(server).get(`/listings/${listing.id}`).expect(200);
    await request(server).get(`/listings/${listing.id}`).set(other.auth).expect(200);
    const mine = await request(server).get('/listings/mine').set(owner.auth).expect(200);
    expect(mine.body.find((l: any) => l.id === listing.id).viewsCount).toBe(2);

    await request(server).delete(`/listings/${listing.id}`).set(owner.auth).expect(204);
    await request(server).get(`/listings/${listing.id}`).expect(404);
  });

  it('recherche : famille + sous-catégorie, état, prix, livraison, type de vendeur, photo, date, tri, pagination', async () => {
    const seller = await login(app);
    const pro = await login(app);
    await request(server).post('/users/me/become-pro').set(pro.auth).send({ siret: '73282932000074', shopName: 'Meubles Durand' }).expect(201);

    const a = await createListing(app, seller, { title: 'Fauteuil vintage scandinave', price: 120, condition: 'bon_etat', deliveryAvailable: false, city: 'Villeurbanne', postalCode: '69100' });
    const b = await createListing(app, pro, { title: 'Bureau en chêne massif', price: 480, condition: 'neuf', deliveryAvailable: true, city: 'Paris', postalCode: '75011' });
    const c = await createListing(app, seller, { title: 'iPhone 13 128 Go', categorySlug: 'telephonie', price: 400, condition: 'tres_bon_etat', attributes: { marque: 'Apple', modele: 'iPhone 13', stockage: '128 Go' }, deliveryAvailable: true });
    await request(server).post(`/listings/${b.id}/photos`).set(pro.auth).attach('files', PNG_1x1, { filename: 'bureau.png', contentType: 'image/png' }).expect(201);

    const trio = [a.id, b.id, c.id];
    // Les autres tests du fichier laissent des annonces en ligne : on ne juge que les trois créées ici.
    const ids = (res: any) => res.body.items.map((l: any) => l.id).filter((id: string) => trio.includes(id));
    expect(ids(await request(server).get('/listings?category=maison-jardin').expect(200))).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids(await request(server).get('/listings?category=maison-jardin'))).not.toContain(c.id);
    expect(ids(await request(server).get('/listings?category=telephonie'))).toEqual([c.id]);
    expect(ids(await request(server).get('/listings?condition=neuf'))).toEqual([b.id]);
    expect(ids(await request(server).get('/listings?price_min=300&price_max=450'))).toEqual([c.id]);
    expect(ids(await request(server).get('/listings?delivery=true&category=maison-jardin'))).toEqual([b.id]);
    expect(ids(await request(server).get('/listings?seller_type=professionnel'))).toEqual([b.id]);
    expect(ids(await request(server).get('/listings?with_photo=true'))).toEqual([b.id]);
    expect(ids(await request(server).get('/listings?postal_code=69'))).toContain(a.id);
    expect(ids(await request(server).get('/listings?postal_code=69'))).not.toContain(b.id);
    expect(ids(await request(server).get('/listings?attr.marque=apple'))).toEqual([c.id]);
    const sorted = ids(await request(server).get('/listings?sort=price_asc&category=maison-jardin'));
    expect(sorted.indexOf(a.id)).toBeLessThan(sorted.indexOf(b.id));
    const page = await request(server).get('/listings?page_size=1&page=1').expect(200);
    expect(page.body.items.length).toBe(1);
    expect(page.body.total).toBeGreaterThanOrEqual(3);
    await request(server).get('/listings?price_min=abc').expect(400);
    await request(server).get('/listings?sort=hack').expect(400);

    // rayon : autour de Lyon (45.76, 4.84) 30 km -> Villeurbanne oui, Paris non
    const near = await request(server).get('/listings?lat=45.76&lng=4.84&radius=30').expect(200);
    expect(ids(near)).toContain(a.id);
    expect(ids(near)).not.toContain(b.id);
    expect(near.body.items[0].distanceKm).toBeDefined();
    const card = near.body.items.find((l: any) => l.id === a.id);
    expect(card.seller.accountType).toBe('particulier');
    expect(card.coverUrl).toBeNull();

    const similar = await request(server).get(`/listings/${a.id}/similar`).expect(200);
    expect(similar.body.map((l: any) => l.id)).toContain(b.id);
  });

  it('photos : signature réelle vérifiée, extension dérivée du contenu, non-propriétaire bloqué avant écriture', async () => {
    const owner = await login(app);
    const other = await login(app);
    const listing = await createListing(app, owner);
    const before = (await fs.readdir(UPLOAD_DIR)).length;

    // HTML déguisé en image/png avec extension .png -> rejeté, aucun fichier conservé
    const fake = await request(server)
      .post(`/listings/${listing.id}/photos`)
      .set(owner.auth)
      .attach('files', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'evil.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    expect(fake.body.message).toMatch(/pas une image/);
    expect((await fs.readdir(UPLOAD_DIR)).length).toBe(before);

    // Mauvais type MIME déclaré
    await request(server).post(`/listings/${listing.id}/photos`).set(owner.auth)
      .attach('files', PNG_1x1, { filename: 'x.png', contentType: 'text/html' }).expect(400);
    expect((await fs.readdir(UPLOAD_DIR)).length).toBe(before);

    // Non-propriétaire : 403 et rien n'est écrit sur le disque
    await request(server).post(`/listings/${listing.id}/photos`).set(other.auth)
      .attach('files', PNG_1x1, { filename: 'x.png', contentType: 'image/png' }).expect(403);
    expect((await fs.readdir(UPLOAD_DIR)).length).toBe(before);

    // Vrai PNG nommé .html avec MIME image/png : accepté mais renommé en .png (jamais servi comme HTML)
    const ok = await request(server).post(`/listings/${listing.id}/photos`).set(owner.auth)
      .attach('files', PNG_1x1, { filename: '../../evil.html', contentType: 'image/png' }).expect(201);
    expect(ok.body[0].url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    // Deux fichiers par photo : l'original et sa vignette (-min)
    expect(ok.body[0].thumbUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}-min\.png$/);
    expect((await fs.readdir(UPLOAD_DIR)).length).toBe(before + 2);
    const stored = join(UPLOAD_DIR, ok.body[0].url.replace('/uploads/', ''));
    const storedThumb = join(UPLOAD_DIR, ok.body[0].thumbUrl.replace('/uploads/', ''));
    await fs.access(stored);
    await fs.access(storedThumb);

    // Réordonnancement et suppression (le fichier disparaît du disque)
    const second = await request(server).post(`/listings/${listing.id}/photos`).set(owner.auth)
      .attach('files', PNG_1x1, { filename: 'b.png', contentType: 'image/png' }).expect(201);
    const reordered = await request(server).patch(`/listings/${listing.id}/photos/order`).set(owner.auth)
      .send({ photoIds: [second.body[0].id, ok.body[0].id] }).expect(200);
    expect(reordered.body[0].id).toBe(second.body[0].id);
    await request(server).patch(`/listings/${listing.id}/photos/order`).set(owner.auth).send({ photoIds: [ok.body[0].id] }).expect(400);
    await request(server).delete(`/listings/${listing.id}/photos/${ok.body[0].id}`).set(other.auth).expect(403);
    await request(server).delete(`/listings/${listing.id}/photos/${ok.body[0].id}`).set(owner.auth).expect(204);
    await expect(fs.access(stored)).rejects.toBeDefined();
    await expect(fs.access(storedThumb)).rejects.toBeDefined();
    const detail = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(detail.body.photos.length).toBe(1);
    // nettoyage
    await request(server).delete(`/listings/${listing.id}`).set(owner.auth).expect(204);
    expect((await fs.readdir(UPLOAD_DIR)).length).toBe(before);
  });

  it('favoris : ajout, liste enrichie, ids, retrait', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller);
    await request(server).post(`/listings/${listing.id}/favorite`).set(buyer.auth).expect(201);
    await request(server).post(`/listings/${listing.id}/favorite`).set(buyer.auth).expect(201);
    const favs = await request(server).get('/users/me/favorites').set(buyer.auth).expect(200);
    expect(favs.body.length).toBe(1);
    expect(favs.body[0].seller.id).toBe(seller.id);
    const ids = await request(server).get('/users/me/favorites/ids').set(buyer.auth).expect(200);
    expect(ids.body).toEqual([listing.id]);
    const detail = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(detail.body.favoritesCount).toBe(1);
    await request(server).delete(`/listings/${listing.id}/favorite`).set(buyer.auth).expect(200);
    expect((await request(server).get('/users/me/favorites').set(buyer.auth)).body.length).toBe(0);
    await request(server).post('/listings/00000000-0000-4000-8000-000000000000/favorite').set(buyer.auth).expect(404);
  });

  it('profil : DTO strict, SIRET Luhn, profil public sans données sensibles', async () => {
    const user = await login(app);
    const bad = await request(server).patch('/users/me').set(user.auth).send({ displayName: '<script>', accountType: 'admin' });
    expect(bad.status).toBe(400);
    const ok = await request(server).patch('/users/me').set(user.auth).send({ displayName: 'Camille', city: 'Nantes', postalCode: '44000', accountType: 'admin', phoneNumber: '+33600000000' }).expect(200);
    expect(ok.body.displayName).toBe('Camille');
    expect(ok.body.accountType).toBe('particulier');
    expect(ok.body.phoneNumber).toBe(user.phone);
    await request(server).post('/users/me/become-pro').set(user.auth).send({ siret: '12345678901234', shopName: 'Test' }).expect(400);
    await request(server).post('/users/me/become-pro').set(user.auth).send({ siret: '44306184100047', shopName: 'Atelier Camille' }).expect(201);
    const pub = await request(server).get(`/users/${user.id}/profile`).expect(200);
    expect(pub.body.accountType).toBe('professionnel');
    expect(pub.body.phoneNumber).toBeUndefined();
    expect(pub.body.siret).toBeUndefined();
    expect(pub.body.activeListingsCount).toBe(0);
    await request(server).get('/users/not-a-uuid/profile').expect(400);
  });
});
