import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { PaypalPaymentProvider } from '../src/payments/paypal-payment.provider';
import { SettingsService } from '../src/settings/settings.service';
import { createApp, createListing, login, makeAdmin, PNG_1x1, TestUser } from './utils';

async function becomePro(app: INestApplication, user: TestUser, siret: string, shopName: string) {
  await request(app.getHttpServer()).post('/users/me/become-pro').set(user.auth).send({ siret, shopName }).expect(201);
}

describe('Phase 2 : monétisation désactivable, catégories, import, multi-utilisateurs, messagerie enrichie, CMS', () => {
  let app: INestApplication;
  let server: any;
  let settings: SettingsService;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    settings = app.get(SettingsService);
  });
  afterAll(() => app.close());

  // ------------------------------------------------------------ §0 gratuité

  it('monétisation désactivée par défaut : réglage public, formules listées, aucun paiement demandé', async () => {
    const pub = await request(server).get('/settings/public').expect(200);
    expect(pub.body.monetizationEnabled).toBe(false);
    const plans = await request(server).get('/plans').expect(200);
    expect(plans.body.map((p: any) => p.slug)).toEqual(['gratuit', 'boutique', 'boutique-premium']);
  });

  it('flag désactivé : un compte pro SANS abonnement publie sans limite et met en avant gratuitement', async () => {
    const pro = await login(app);
    await becomePro(app, pro, '73282932000074', 'Garage Test');
    const ent = await request(server).get('/users/me/entitlements').set(pro.auth).expect(200);
    expect(ent.body).toMatchObject({ monetizationEnabled: false, listingsLimit: null, boostsLimit: null, boostPrice: 0, urgentPrice: 0 });

    // 25 annonces (> quota particulier de 20 et > "gratuit" 20) sans aucune erreur
    for (let i = 0; i < 25; i++) await createListing(app, pro, { title: `Article numéro ${i + 1} en vente` });
    const mine = await request(server).get('/listings/mine').set(pro.auth).expect(200);
    expect(mine.body.filter((l: any) => l.status === 'en_ligne').length).toBe(25);

    // Boost + urgent gratuits, plusieurs fois
    for (const l of mine.body.slice(0, 3)) {
      const b = await request(server).post(`/listings/${l.id}/promote`).set(pro.auth).send({ type: 'boost' }).expect(201);
      expect(b.body).toMatchObject({ charged: 0, monetizationEnabled: false });
      const u = await request(server).post(`/listings/${l.id}/promote`).set(pro.auth).send({ type: 'urgent' }).expect(201);
      expect(u.body.charged).toBe(0);
    }
    // Un particulier aussi : 22 annonces > 20, et boost gratuit
    const part = await login(app);
    for (let i = 0; i < 22; i++) await createListing(app, part, { title: `Objet particulier ${i + 1}` });
    const pl = await request(server).get('/listings/mine').set(part.auth).expect(200);
    expect(pl.body.length).toBe(22);
    await request(server).post(`/listings/${pl.body[0].id}/promote`).set(part.auth).send({ type: 'boost' }).expect(201);
  });

  it('les annonces boostées passent en tête des résultats et portent le badge', async () => {
    const seller = await login(app);
    const older = await createListing(app, seller, { title: 'Chaise ancienne en bois', categorySlug: 'ameublement' });
    await new Promise((r) => setTimeout(r, 20));
    const newer = await createListing(app, seller, { title: 'Chaise moderne design', categorySlug: 'ameublement' });
    await request(server).post(`/listings/${older.id}/promote`).set(seller.auth).send({ type: 'boost' }).expect(201);
    const res = await request(server).get('/listings?q=chaise').expect(200);
    const ids = res.body.items.map((l: any) => l.id);
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));
    expect(res.body.items.find((l: any) => l.id === older.id).isBoosted).toBe(true);
    const urgent = await request(server).get('/listings?q=chaise&urgent=true').expect(200);
    expect(urgent.body.items.length).toBe(0);
  });

  it('flag activé par l\'admin : quotas et limites de mise en avant s\'appliquent, puis tout redevient libre à la désactivation', async () => {
    const admin = await login(app);
    await makeAdmin(app, admin);
    const part = await login(app);
    await request(server).patch('/admin/settings').set(part.auth).send({ monetization_enabled: true }).expect(403);

    const on = await request(server).patch('/admin/settings').set(admin.auth).send({ monetization_enabled: true, free_listings_per_30_days: 2 }).expect(200);
    expect(on.body.settings.monetization_enabled).toBe(true);
    expect((await request(server).get('/settings/public')).body.monetizationEnabled).toBe(true);

    await createListing(app, part, { title: 'Première annonce payante' });
    await createListing(app, part, { title: 'Deuxième annonce payante' });
    const third = await request(server).post('/listings').set(part.auth).send({ title: 'Troisième annonce', description: 'Ne doit pas passer le quota.', categorySlug: 'ameublement', price: 5 });
    expect(third.status).toBe(400);
    expect(third.body.message).toMatch(/Limite de 2 annonces/);
    const mine = await request(server).get('/listings/mine').set(part.auth);
    const boost = await request(server).post(`/listings/${mine.body[0].id}/promote`).set(part.auth).send({ type: 'boost' });
    expect(boost.status).toBe(400);
    expect(boost.body.message).toMatch(/2\.99 €/);

    // Abonnement "boutique-premium" (illimité) : enregistré sans paiement réel (provider mock) puis quota levé
    const plans = (await request(server).get('/plans')).body;
    const premium = plans.find((p: any) => p.slug === 'boutique-premium');
    const sub = await request(server).post(`/users/me/subscription/${premium.id}`).set(part.auth).expect(201);
    expect(sub.body.charged).toBe(79);
    await createListing(app, part, { title: 'Troisième annonce avec abonnement' });
    await request(server).post(`/listings/${mine.body[0].id}/promote`).set(part.auth).send({ type: 'boost' }).expect(201);

    // Journal d'audit
    const audit = await request(server).get('/admin/audit-log?action=settings').set(admin.auth).expect(200);
    expect(audit.body.items[0].details.monetization_enabled).toEqual({ from: false, to: true });

    // Désactivation : tout redevient gratuit et illimité pour un autre particulier sans abonnement
    await request(server).patch('/admin/settings').set(admin.auth).send({ monetization_enabled: false }).expect(200);
    const other = await login(app);
    for (let i = 0; i < 3; i++) await createListing(app, other, { title: `Libre ${i + 1}` });
    const ent = await request(server).get('/users/me/entitlements').set(other.auth).expect(200);
    expect(ent.body.listingsLimit).toBeNull();
    expect(settings.isMonetizationEnabled()).toBe(false);
  });

  it('PayPal est un fournisseur sélectionnable (mock, sans réseau) avec le même contrat que Stripe', async () => {
    const provider = new PaypalPaymentProvider(app.get(ConfigService));
    const intent = await provider.createPaymentIntent({ amountEuros: 42, applicationFeeEuros: 5.5, metadata: {} });
    expect(intent.providerPaymentId).toMatch(/^paypal_auth_/);
    expect(intent.status).toBe('requires_capture');
    expect(await provider.capture(intent.providerPaymentId)).toEqual({ status: 'succeeded' });
    expect(await provider.refund(intent.providerPaymentId)).toEqual({ status: 'rembourse' });
  });

  // ---------------------------------------------------------- §4 catégories

  it('arborescence de référence : 12 racines dans l\'ordre, Électronique renommée, Services 15 sous-catégories, Animaux 5, Locations de vacances sans enfant', async () => {
    const tree = (await request(server).get('/categories/tree').expect(200)).body;
    expect(tree.map((c: any) => c.name)).toEqual([
      'Immobilier', 'Véhicules', 'Matériel pro', 'Emploi', 'Mode', 'Maison & Jardin', 'Famille', 'Électronique', 'Loisirs', 'Locations de vacances', 'Services', 'Animaux',
    ]);
    const services = tree.find((c: any) => c.slug === 'services');
    expect(services.children.map((c: any) => c.name)).toEqual([
      'Services de déménagement', 'Services de réparations mécaniques', 'Services de jardinerie & bricolage', 'Services à la personne', 'Services aux animaux',
      'Baby-Sitting', 'Artistes & Musiciens', 'Services évènementiels', 'Services de réparations électroniques', 'Entraide entre voisins', 'Billetterie',
      'Évènements', 'Covoiturage', 'Cours particuliers', 'Autres services',
    ]);
    expect(tree.find((c: any) => c.slug === 'animaux').children.map((c: any) => c.name)).toEqual(['Animaux', 'Accessoires animaux', 'Animaux perdus', 'Dons', 'Autres']);
    expect(tree.find((c: any) => c.slug === 'vacances').children).toEqual([]);
    // Les 46 sous-catégories historiques des autres familles sont conservées
    expect(tree.find((c: any) => c.slug === 'multimedia').children.length).toBe(4);
    expect(tree.find((c: any) => c.slug === 'loisirs').children.length).toBe(6);
    const schema = (await request(server).get('/categories/vacances/schema').expect(200)).body;
    const keys = schema.fields.map((f: any) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['type_hebergement', 'voyageurs', 'piscine', 'jardin', 'animaux_acceptes']));
    expect(schema.fields.find((f: any) => f.key === 'type_hebergement').options).toEqual(['Maisons et villas', 'Appartements', 'Chalets', 'Chambres d\'hôtes', 'Campings']);
    expect(schema.fields.filter((f: any) => f.filterable).map((f: any) => f.key)).toEqual(expect.arrayContaining(['piscine', 'jardin', 'animaux_acceptes', 'voyageurs', 'type_hebergement']));
  });

  it('dépôt direct sous « Locations de vacances » avec les nouveaux champs, filtres piscine / voyageurs ; une famille avec enfants refuse le dépôt direct', async () => {
    const host = await login(app);
    const bad = await request(server).post('/listings').set(host.auth).send({ title: 'Villa sans type', description: 'Manque le type d\'hébergement obligatoire.', categorySlug: 'vacances', price: 900 });
    expect(bad.status).toBe(400);
    const villa = await createListing(app, host, { title: 'Villa avec piscine à Hyères', categorySlug: 'vacances', price: 1200, attributes: { type_hebergement: 'Maisons et villas', voyageurs: 'À six', piscine: true, jardin: true } });
    const flat = await createListing(app, host, { title: 'Studio vue mer', categorySlug: 'vacances', price: 400, attributes: { type_hebergement: 'Appartements', voyageurs: 'À deux', piscine: false } });
    expect(villa.status).toBe('en_ligne');
    const pool = await request(server).get('/listings?category=vacances&attr.piscine=true').expect(200);
    expect(pool.body.items.map((l: any) => l.id)).toEqual([villa.id]);
    const two = await request(server).get('/listings?category=vacances&attr.voyageurs=%C3%80%20deux').expect(200);
    expect(two.body.items.map((l: any) => l.id)).toEqual([flat.id]);
    const chalet = await request(server).get('/listings?category=vacances&attr.type_hebergement=Chalets').expect(200);
    expect(chalet.body.items.length).toBe(0);
    const root = await request(server).post('/listings').set(host.auth).send({ title: 'Annonce sous racine', description: 'Services a des sous-catégories.', categorySlug: 'services', price: 10 });
    expect(root.status).toBe(400);
    expect(root.body.message).toMatch(/sous-catégorie/);
    // Nouvelles sous-catégories Services / Animaux utilisables
    await createListing(app, host, { title: 'Covoiturage Lyon Paris vendredi', categorySlug: 'covoiturage', price: 25, attributes: { depart: 'Lyon', arrivee: 'Paris', places: 3 } });
    await createListing(app, host, { title: 'Chat gris trouvé à Villeurbanne', categorySlug: 'animaux-perdus', priceType: 'gratuit', price: undefined, attributes: { situation: 'Trouvé', type_animal: 'Chat' } });
  });

  // -------------------------------------------------------------- §1 import

  it('import CSV/XML réservé aux pros : création, mise à jour par référence, erreurs par ligne', async () => {
    const part = await login(app);
    const csv = 'reference;titre;description;categorie;prix;etat;ville;code_postal;livraison;attr_marque;attr_modele;attr_stockage\n';
    await request(server).post('/listings/import').set(part.auth).attach('file', Buffer.from(csv), 'catalogue.csv').expect(400);

    const pro = await login(app);
    await becomePro(app, pro, '44306184100047', 'Boutique Import');
    const rows = csv +
      'TEL-1;Samsung Galaxy S23 128 Go;Reconditionné grade A, garantie 12 mois.;telephonie;349;tres_bon_etat;Lille;59000;oui;Samsung;Galaxy S23;128 Go\n' +
      'TEL-2;"iPhone 12, 64 Go";"Écran neuf, batterie 100 %";telephonie;299;bon_etat;Lille;59000;non;Apple;iPhone 12;64 Go\n' +
      'BAD-1;Sans catégorie valide;Description assez longue.;categorie-inexistante;10;;;;;;;\n' +
      'BAD-2;Réplique montre AAA+ copie parfaite;Contrefaçon qui doit passer en attente.;montres-bijoux;50;;Paris;75001;non;;;\n';
    const r1 = await request(server).post('/listings/import').set(pro.auth).attach('file', Buffer.from(rows), 'catalogue.csv').expect(201);
    expect(r1.body).toMatchObject({ total: 4, created: 3, updated: 0, pending: 1 });
    expect(r1.body.errors.length).toBe(1);
    expect(r1.body.errors[0].reference).toBe('BAD-1');

    const mine = await request(server).get('/listings/mine').set(pro.auth).expect(200);
    const tel1 = mine.body.find((l: any) => l.externalRef === 'TEL-1');
    expect(tel1.attributes).toMatchObject({ marque: 'Samsung', stockage: '128 Go' });
    expect(tel1.deliveryAvailable).toBe(true);

    // Mise à jour du prix par référence via XML
    const xml = `<?xml version="1.0"?><annonces><annonce><reference>TEL-1</reference><titre>Samsung Galaxy S23 128 Go</titre><description><![CDATA[Reconditionné grade A, garantie 12 mois. Prix baissé.]]></description><categorie>telephonie</categorie><prix>329</prix><attr_marque>Samsung</attr_marque><attr_modele>Galaxy S23</attr_modele></annonce></annonces>`;
    const r2 = await request(server).post('/listings/import').set(pro.auth).attach('file', Buffer.from(xml), 'flux.xml').expect(201);
    expect(r2.body).toMatchObject({ total: 1, created: 0, updated: 1 });
    const after = await request(server).get(`/listings/${tel1.id}`).set(pro.auth).expect(200);
    expect(after.body.price).toBe(329);
    expect(after.body.description).toMatch(/Prix baissé/);
  });

  // ----------------------------------------------------- §1 multi-utilisateurs

  it('multi-utilisateurs : le pro invite par numéro, le membre gère les annonces de la boutique, un tiers non', async () => {
    const owner = await login(app);
    await becomePro(app, owner, '55208131766522', 'Agence Multi');
    const member = await login(app);
    const stranger = await login(app);
    await request(server).post('/users/me/shop/members').set(stranger.auth).send({ phoneNumber: member.phone }).expect(400); // pas pro
    await request(server).post('/users/me/shop/members').set(owner.auth).send({ phoneNumber: '+33699999999' }).expect(404); // inconnu
    const list = await request(server).post('/users/me/shop/members').set(owner.auth).send({ phoneNumber: member.phone }).expect(201);
    expect(list.body[0].user.id).toBe(member.id);
    expect(list.body[0].user.phoneMasked).toMatch(/••/);

    const shops = await request(server).get('/users/me/shops').set(member.auth).expect(200);
    expect(shops.body[0]).toMatchObject({ ownerId: owner.id, shopName: 'Agence Multi' });

    // Le membre publie au nom de la boutique : l'annonce appartient au pro
    const created = await request(server).post('/listings').set(member.auth).send({ title: 'Annonce postée par un membre', description: 'Publiée pour la boutique Agence Multi.', categorySlug: 'ameublement', price: 40, onBehalfOf: owner.id }).expect(201);
    expect(created.body.userId).toBe(owner.id);
    expect(created.body.createdBy).toBe(member.id);
    await request(server).post('/listings').set(stranger.auth).send({ title: 'Tentative tiers', description: 'Ne doit pas pouvoir publier ici.', categorySlug: 'ameublement', price: 40, onBehalfOf: owner.id }).expect(403);

    // Le membre modifie / photo / met en pause ; le tiers non ; "mes annonces" du membre inclut la boutique
    await request(server).patch(`/listings/${created.body.id}`).set(member.auth).send({ title: 'Annonce modifiée par le membre' }).expect(200);
    await request(server).post(`/listings/${created.body.id}/photos`).set(member.auth).attach('files', PNG_1x1, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    await request(server).patch(`/listings/${created.body.id}`).set(stranger.auth).send({ title: 'Piraté' }).expect(403);
    const mine = await request(server).get('/listings/mine').set(member.auth).expect(200);
    expect(mine.body.find((l: any) => l.id === created.body.id).shopOwnerId).toBe(owner.id);
    const detail = await request(server).get(`/listings/${created.body.id}`).set(member.auth).expect(200);
    expect(detail.body.isOwner).toBe(true);
    expect(detail.body.seller.id).toBe(owner.id);

    // Retrait du membre : plus d'accès
    await request(server).delete(`/users/me/shop/members/${member.id}`).set(owner.auth).expect(200);
    await request(server).patch(`/listings/${created.body.id}`).set(member.auth).send({ title: 'Plus membre' }).expect(403);
  });

  // ------------------------------------------------------------ §1 historique

  it('historique de consultation : enregistré pour un connecté (hors ses propres annonces), effaçable', async () => {
    const seller = await login(app);
    const viewer = await login(app);
    const a = await createListing(app, seller, { title: 'Vélo de course carbone' });
    const b = await createListing(app, seller, { title: 'Casque vélo neuf' });
    await request(server).get(`/listings/${a.id}`).expect(200); // anonyme : rien
    await request(server).get(`/listings/${a.id}`).set(viewer.auth).expect(200);
    await request(server).get(`/listings/${b.id}`).set(viewer.auth).expect(200);
    await request(server).get(`/listings/${a.id}`).set(viewer.auth).expect(200); // remonte a en premier
    await request(server).get(`/listings/${a.id}`).set(seller.auth).expect(200); // propriétaire : rien
    const h = await request(server).get('/listings/history').set(viewer.auth).expect(200);
    expect(h.body.map((l: any) => l.id)).toEqual([a.id, b.id]);
    expect((await request(server).get('/listings/history').set(seller.auth)).body.length).toBe(0);
    await request(server).delete('/listings/history').set(viewer.auth).expect(200);
    expect((await request(server).get('/listings/history').set(viewer.auth)).body.length).toBe(0);
  });

  // ------------------------------------------------- §1 messagerie enrichie

  it('messagerie : photo (signature vérifiée) et proposition de prix (acheteur propose, vendeur répond)', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 100 });
    const conv = (await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id }).expect(201)).body;

    const fake = await request(server).post(`/conversations/${conv.id}/images`).set(buyer.auth).attach('file', Buffer.from('<html>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const img = await request(server).post(`/conversations/${conv.id}/images`).set(buyer.auth).field('caption', 'Voici l\'état').attach('file', PNG_1x1, { filename: 'p.png', contentType: 'image/png' }).expect(201);
    expect(img.body.type).toBe('image');
    expect(img.body.attachmentUrl).toMatch(/^\/uploads\/.+\.png$/);
    const stranger = await login(app);
    await request(server).post(`/conversations/${conv.id}/images`).set(stranger.auth).attach('file', PNG_1x1, { filename: 'p.png', contentType: 'image/png' }).expect(403);

    await new Promise((r) => setTimeout(r, 1100)); // createdAt à la seconde en SQLite : garantit l'ordre photo < offre
    await request(server).post(`/conversations/${conv.id}/offers`).set(seller.auth).send({ amount: 80 }).expect(400); // seul l'acheteur
    await request(server).post(`/conversations/${conv.id}/offers`).set(buyer.auth).send({ amount: -5 }).expect(400);
    const o1 = await request(server).post(`/conversations/${conv.id}/offers`).set(buyer.auth).send({ amount: 80 }).expect(201);
    expect(o1.body).toMatchObject({ type: 'offer', offerAmount: 80, offerStatus: 'en_attente' });
    const o2 = await request(server).post(`/conversations/${conv.id}/offers`).set(buyer.auth).send({ amount: 85 }).expect(201);
    const msgs = await request(server).get(`/conversations/${conv.id}/messages`).set(seller.auth).expect(200);
    expect(msgs.body.find((m: any) => m.id === o1.body.id).offerStatus).toBe('retiree');
    await request(server).post(`/conversations/${conv.id}/offers/${o2.body.id}`).set(buyer.auth).send({ decision: 'acceptee' }).expect(403);
    const accepted = await request(server).post(`/conversations/${conv.id}/offers/${o2.body.id}`).set(seller.auth).send({ decision: 'acceptee' }).expect(201);
    expect(accepted.body.offerStatus).toBe('acceptee');
    await request(server).post(`/conversations/${conv.id}/offers/${o2.body.id}`).set(seller.auth).send({ decision: 'refusee' }).expect(400);
    const inbox = await request(server).get('/conversations').set(buyer.auth).expect(200);
    expect(inbox.body[0].lastMessage.content).toMatch(/Proposition/);
    const notifs = await request(server).get('/notifications').set(buyer.auth).expect(200);
    expect(notifs.body.some((n: any) => /acceptée/.test(n.title))).toBe(true);
  });

  // --------------------------------------------------------------- §1 CMS

  it('CMS pages légales : lecture publique, modification admin journalisée, dépublication = 404', async () => {
    const cgu = await request(server).get('/pages/cgu').expect(200);
    expect(cgu.body.title).toMatch(/Conditions générales/);
    const list = await request(server).get('/pages').expect(200);
    expect(list.body.map((p: any) => p.slug).sort()).toEqual(['a-propos', 'cgu', 'confidentialite', 'mentions-legales']);
    const user = await login(app);
    await request(server).patch('/admin/pages/cgu').set(user.auth).send({ content: 'x' }).expect(403);
    const admin = await login(app);
    await makeAdmin(app, admin);
    await request(server).patch('/admin/pages/cgu').set(admin.auth).send({ content: '## Nouvelle version\nTexte modifié par l\'admin.' }).expect(200);
    expect((await request(server).get('/pages/cgu')).body.content).toMatch(/Nouvelle version/);
    await request(server).patch('/admin/pages/mentions-legales').set(admin.auth).send({ published: false }).expect(200);
    await request(server).get('/pages/mentions-legales').expect(404);
    await request(server).get('/admin/pages/mentions-legales').set(admin.auth).expect(200);
    await request(server).patch('/admin/pages/mentions-legales').set(admin.auth).send({ published: true }).expect(200);
    const audit = await request(server).get('/admin/audit-log?action=page').set(admin.auth).expect(200);
    expect(audit.body.items.some((a: any) => a.targetId === 'cgu')).toBe(true);
  });

  // -------------------------------------------------------- §1 suggestions

  it('suggestions de recherche : titres et catégories, correction simple d\'une faute', async () => {
    const seller = await login(app);
    await createListing(app, seller, { title: 'Trottinette électrique Xiaomi', categorySlug: 'sports-hobbies', price: 250 });
    const s = await request(server).get('/listings/suggest?q=trott').expect(200);
    expect(s.body.suggestions.some((x: any) => x.type === 'titre' && /Trottinette/.test(x.label))).toBe(true);
    const cat = await request(server).get('/listings/suggest?q=%C3%A9lectro').expect(200);
    expect(cat.body.suggestions.some((x: any) => x.type === 'categorie' && x.label === 'Électronique')).toBe(true);
    const typo = await request(server).get('/listings/suggest?q=trotinette').expect(200);
    expect(typo.body.suggestions.length).toBe(0);
    expect(typo.body.correction).toBe('trottinette');
    expect((await request(server).get('/listings/suggest?q=a')).body.suggestions).toEqual([]);
  });
});
