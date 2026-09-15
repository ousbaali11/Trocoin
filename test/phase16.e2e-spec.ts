import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login } from './utils';

/**
 * Phase 16 : panneau « Tous les filtres » généralisé (étendre à la livraison, tri « plus
 * anciennes », compteurs par type de vendeur), sections de découverte des pages de catégorie,
 * suppression de conversations côté utilisateur (masquage par participant), note du vendeur
 * sur les cartes.
 */
describe('Phase 16 : filtres généralisés, découverte, suppression de conversations', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('« Étendre à la livraison » : les annonces livrables s\'ajoutent aux annonces proches (commune, rayon)', async () => {
    const seller = await login(app);
    const tag = String(Date.now()).slice(-6);
    const lyon = await createListing(app, seller, { title: `Canapé Lyon ${tag}`, city: 'Lyon', postalCode: '69003', latitude: 45.764, longitude: 4.8357, deliveryAvailable: false });
    const parisLivrable = await createListing(app, seller, { title: `Canapé Paris livrable ${tag}`, city: 'Paris', postalCode: '75011', latitude: 48.859, longitude: 2.38, deliveryAvailable: true });
    const parisNonLivrable = await createListing(app, seller, { title: `Canapé Paris sur place ${tag}`, city: 'Paris', postalCode: '75011', latitude: 48.859, longitude: 2.38, deliveryAvailable: false });
    const ids = (res: any) => res.body.items.map((l: any) => l.id);

    // Par commune
    const cityOnly = await request(server).get(`/listings?q=${tag}&city=Lyon`).expect(200);
    expect(ids(cityOnly)).toEqual([lyon.id]);
    const cityAnywhere = await request(server).get(`/listings?q=${tag}&city=Lyon&delivery_anywhere=true`).expect(200);
    expect(ids(cityAnywhere).sort()).toEqual([lyon.id, parisLivrable.id].sort());
    expect(ids(cityAnywhere)).not.toContain(parisNonLivrable.id);

    // Par rayon : les annonces proches d'abord, les livrables lointaines ensuite
    const radiusOnly = await request(server).get(`/listings?q=${tag}&lat=45.764&lng=4.8357&radius=5`).expect(200);
    expect(ids(radiusOnly)).toEqual([lyon.id]);
    const radiusAnywhere = await request(server).get(`/listings?q=${tag}&lat=45.764&lng=4.8357&radius=5&delivery_anywhere=true&sort=distance`).expect(200);
    expect(ids(radiusAnywhere)).toEqual([lyon.id, parisLivrable.id]);
    expect(radiusAnywhere.body.items[1].distanceKm).toBeGreaterThan(300);
    // Sans localisation, le paramètre n'a pas d'effet
    const noPlace = await request(server).get(`/listings?q=${tag}&delivery_anywhere=true`).expect(200);
    expect(ids(noPlace).length).toBe(3);
  });

  it('tri « plus anciennes » et compteurs par type de vendeur (/listings/facets)', async () => {
    const part = await login(app);
    const tag = String(Date.now()).slice(-6) + 'f';
    const first = await createListing(app, part, { title: `Lampe ancienne ${tag}`, price: 10 });
    await new Promise((r) => setTimeout(r, 20));
    const second = await createListing(app, part, { title: `Lampe récente ${tag}`, price: 20 });
    const oldest = await request(server).get(`/listings?q=${tag}&sort=oldest`).expect(200);
    expect(oldest.body.items.map((l: any) => l.id)).toEqual([first.id, second.id]);
    const recent = await request(server).get(`/listings?q=${tag}&sort=recent`).expect(200);
    expect(recent.body.items.map((l: any) => l.id)).toEqual([second.id, first.id]);
    await request(server).get(`/listings?q=${tag}&sort=inconnu`).expect(400);

    const facets = await request(server).get(`/listings?q=${tag}`).expect(200);
    expect(facets.body.total).toBe(2);
    const f = await request(server).get(`/listings/facets?q=${tag}&seller_type=professionnel`).expect(200);
    // Le compteur ignore le filtre vendeur courant : il compte chaque type pour les autres critères
    expect(f.body).toEqual({ total: 2, particulier: 2, professionnel: 0 });
    // Les filtres spécifiques (attr.*) sont pris en compte aussi
    const f2 = await request(server).get(`/listings/facets?q=${tag}&price_max=15`).expect(200);
    expect(f2.body).toEqual({ total: 1, particulier: 1, professionnel: 0 });
  });

  it('découverte d\'une catégorie : fil d\'Ariane, recherches suggérées issues des critères, villes des annonces puis grandes villes', async () => {
    const seller = await login(app);
    const tag = String(Date.now()).slice(-6) + 'd';
    await createListing(app, seller, { title: `VTT Annecy ${tag}`, categorySlug: 'velos', city: 'Annecy', postalCode: '74000', attributes: { type_velo: 'VTT' } });
    await createListing(app, seller, { title: `VTT Annecy bis ${tag}`, categorySlug: 'velos', city: 'Annecy', postalCode: '74000', attributes: { type_velo: 'VTT' } });
    const d = await request(server).get('/listings/discover?category=velos').expect(200);
    expect(d.body.breadcrumb).toEqual([{ slug: 'loisirs', name: 'Loisirs' }, { slug: 'velos', name: 'Vélos' }]);
    expect(d.body.suggestions).toEqual(expect.arrayContaining([{ label: 'Vélos VTT', href: '/recherche?category=velos&attr.type_velo=VTT' }]));
    expect(d.body.suggestions.length).toBeLessThanOrEqual(24);
    expect(d.body.suggestions.some((s: any) => s.label.endsWith(' Autre'))).toBe(false);
    // Annecy (2 annonces) en tête, puis les grandes villes pour compléter jusqu'à 24
    expect(d.body.cities[0]).toEqual({ city: 'Annecy', count: 2 });
    expect(d.body.cities.length).toBe(24);
    expect(d.body.cities.map((c: any) => c.city)).toContain('Paris');
    // Une famille : ses sous-catégories en suggestions
    const root = await request(server).get('/listings/discover?category=loisirs').expect(200);
    expect(root.body.breadcrumb).toEqual([{ slug: 'loisirs', name: 'Loisirs' }]);
    expect(root.body.suggestions).toEqual(expect.arrayContaining([{ label: 'Vélos', href: '/recherche?category=velos' }]));
    await request(server).get('/listings/discover?category=inconnue').expect(404);
    // Le lien « ville » renvoie bien les annonces de cette ville
    const byCity = await request(server).get(`/listings?category=velos&city=Annecy&q=${tag}`).expect(200);
    expect(byCity.body.total).toBe(2);
  });

  it('cartes : la note du vendeur est renvoyée à tout le monde, connecté ou non', async () => {
    const seller = await login(app);
    const tag = String(Date.now()).slice(-6) + 'n';
    await createListing(app, seller, { title: `Table ${tag}` });
    const res = await request(server).get(`/listings?q=${tag}`).expect(200);
    expect(res.body.items[0].seller).toMatchObject({ id: seller.id, ratingAvg: 0, ratingCount: 0 });
    expect(res.body.items[0].seller.phoneNumber).toBeUndefined();
  });

  it('suppression de conversations : masquée pour celui qui supprime seulement, réapparaît quand l\'autre écrit', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const l1 = await createListing(app, seller, { title: 'Vélo à vendre' });
    const l2 = await createListing(app, seller, { title: 'Chaise à vendre' });
    const l3 = await createListing(app, seller, { title: 'Lampe à vendre' });
    const c1 = (await request(server).post('/conversations').set(buyer.auth).send({ listingId: l1.id, message: 'Bonjour, toujours disponible ?' }).expect(201)).body;
    const c2 = (await request(server).post('/conversations').set(buyer.auth).send({ listingId: l2.id, message: 'Bonjour pour la chaise' }).expect(201)).body;
    const c3 = (await request(server).post('/conversations').set(buyer.auth).send({ listingId: l3.id, message: 'Bonjour pour la lampe' }).expect(201)).body;
    expect((await request(server).get('/conversations').set(buyer.auth)).body).toHaveLength(3);
    expect((await request(server).get('/conversations/unread-count').set(seller.auth)).body.unread).toBe(3);

    // Suppression unitaire par l'acheteur : disparue pour lui, toujours là pour le vendeur
    expect((await request(server).delete(`/conversations/${c1.id}`).set(buyer.auth).expect(200)).body).toEqual({ deleted: 1 });
    expect((await request(server).get('/conversations').set(buyer.auth)).body.map((c: any) => c.id).sort()).toEqual([c2.id, c3.id].sort());
    await request(server).get(`/conversations/${c1.id}`).set(buyer.auth).expect(404);
    expect((await request(server).get('/conversations').set(seller.auth)).body).toHaveLength(3);
    await request(server).get(`/conversations/${c1.id}`).set(seller.auth).expect(200);
    // Supprimer deux fois ne change rien ; une conversation d'un tiers est ignorée
    const other = await login(app);
    expect((await request(server).post('/conversations/bulk-delete').set(other.auth).send({ ids: [c1.id, c2.id] }).expect(200)).body).toEqual({ deleted: 0 });
    expect((await request(server).delete(`/conversations/${c1.id}`).set(buyer.auth).expect(200)).body).toEqual({ deleted: 0 });
    await request(server).post('/conversations/bulk-delete').set(buyer.auth).send({ ids: [] }).expect(400);
    await request(server).post('/conversations/bulk-delete').set(buyer.auth).send({ ids: ['pas-un-uuid'] }).expect(400);

    // Le vendeur répond : la conversation revient chez l'acheteur, avec le message non lu
    await request(server).post(`/conversations/${c1.id}/messages`).set(seller.auth).send({ content: 'Oui, toujours disponible !' }).expect(201);
    const back = await request(server).get('/conversations').set(buyer.auth).expect(200);
    expect(back.body.map((c: any) => c.id)).toContain(c1.id);
    expect(back.body.find((c: any) => c.id === c1.id).unreadCount).toBe(1);

    // Suppression groupée côté vendeur : ses compteurs ne comptent plus ces conversations
    expect((await request(server).post('/conversations/bulk-delete').set(seller.auth).send({ ids: [c2.id, c3.id] }).expect(200)).body).toEqual({ deleted: 2 });
    expect((await request(server).get('/conversations').set(seller.auth)).body.map((c: any) => c.id)).toEqual([c1.id]);
    // (le message de c1 a été lu quand le vendeur a ouvert la conversation plus haut)
    expect((await request(server).get('/conversations/unread-count').set(seller.auth)).body.unread).toBe(0);
    // L'acheteur recontacte le vendeur sur la chaise : la conversation existante réapparaît chez le vendeur
    await request(server).post('/conversations').set(buyer.auth).send({ listingId: l2.id, message: 'Toujours intéressé par la chaise' }).expect(201);
    expect((await request(server).get('/conversations').set(seller.auth)).body.map((c: any) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    // … avec ses messages non lus comptés à nouveau (le premier message de c2 n'avait jamais été lu, plus le nouveau)
    expect((await request(server).get('/conversations/unread-count').set(seller.auth)).body.unread).toBe(2);
    // Sans session
    await request(server).delete(`/conversations/${c1.id}`).expect(401);
  });
});
