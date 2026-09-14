import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login, PNG_1x1 } from './utils';

/**
 * Phase 4 : différenciateurs de l'accueil
 *  - filtre rapide « Dons » / « Échanges » (price_type)
 *  - « prix moyen constaté » au dépôt (GET /listings/price-estimate)
 *  - badge « Fiche complète » calculé automatiquement (isComplete / completeness)
 */
describe('Phase 4 : filtre dons/échanges, estimation de prix, fiche complète', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('price_type filtre les dons et les échanges ; valeur inconnue refusée', async () => {
    const user = await login(app);
    const don = await createListing(app, user, { title: 'Donne canapé convertible', priceType: 'gratuit', price: undefined });
    const troc = await createListing(app, user, { title: 'Échange table basse contre étagère', priceType: 'echange', price: undefined });
    const vente = await createListing(app, user, { title: 'Table basse chêne', priceType: 'fixe', price: 90 });

    const dons = await request(server).get('/listings?price_type=gratuit').expect(200);
    const ids = (r: any) => r.body.items.map((l: any) => l.id);
    expect(ids(dons)).toContain(don.id);
    expect(ids(dons)).not.toContain(troc.id);
    expect(ids(dons)).not.toContain(vente.id);

    const trocs = await request(server).get('/listings?price_type=echange').expect(200);
    expect(ids(trocs)).toContain(troc.id);
    expect(ids(trocs)).not.toContain(don.id);

    await request(server).get('/listings?price_type=cadeau').expect(400);
  });

  it('price-estimate : médiane et fourchette des annonces similaires, repli sur la catégorie, rien sous 3 annonces', async () => {
    const user = await login(app);
    // Catégorie sans historique : pas d'estimation
    const empty = await request(server).get('/listings/price-estimate?category=telephonie&q=iPhone').expect(200);
    expect(empty.median).toBeUndefined();
    expect(empty.body.median).toBeNull();

    for (const price of [300, 350, 400, 900]) {
      await createListing(app, user, { title: `iPhone 13 ${price} reconditionné`, categorySlug: 'telephonie', price, condition: 'tres_bon_etat', attributes: { marque: 'Apple', modele: 'iPhone 13', stockage: '128 Go' } });
    }
    await createListing(app, user, { title: 'Coque silicone', categorySlug: 'telephonie', price: 5, attributes: { marque: 'Autre', modele: 'Coque', stockage: '128 Go' } });

    // Mots du titre partagés : seules les 4 annonces « iPhone » comptent
    const est = await request(server).get('/listings/price-estimate?category=telephonie&q=iPhone 13 128 Go').expect(200);
    expect(est.body.basis).toBe('mots');
    expect(est.body.count).toBe(4);
    expect(est.body.median).toBeGreaterThanOrEqual(350);
    expect(est.body.median).toBeLessThanOrEqual(400);
    expect(est.body.low).toBeLessThanOrEqual(est.body.median);
    expect(est.body.high).toBeGreaterThanOrEqual(est.body.median);

    // Aucun mot en commun : repli sur toute la catégorie (5 annonces)
    const fallback = await request(server).get('/listings/price-estimate?category=telephonie&q=zzzz').expect(200);
    expect(fallback.body.basis).toBe('categorie');
    expect(fallback.body.count).toBe(5);

    // Sans catégorie : rien
    const none = await request(server).get('/listings/price-estimate?q=iPhone').expect(200);
    expect(none.body.count).toBe(0);
  });

  it('fiche complète : badge uniquement avec 3 photos, description longue et tous les champs de la catégorie', async () => {
    const user = await login(app);
    const minimal = await createListing(app, user, {
      title: 'Peugeot 208 essence',
      description: 'Voiture bien entretenue, contrôle technique OK.',
      categorySlug: 'voitures',
      price: 8900,
      attributes: { marque: 'Peugeot', modele: '208', annee: 2018, kilometrage: 64000, carburant: 'Essence', boite: 'Manuelle' },
    });
    const d1 = await request(server).get(`/listings/${minimal.id}`).expect(200);
    expect(d1.body.completeness.complete).toBe(false);
    expect(d1.body.completeness.score).toBeLessThan(100);
    expect(d1.body.completeness.missing.join(' | ')).toMatch(/3 photos/);
    expect(d1.body.completeness.missing.join(' | ')).toMatch(/120 caractères/);
    expect(d1.body.completeness.missing.join(' | ')).toMatch(/Renseigner : .*Puissance fiscale/);

    const full = await createListing(app, user, {
      title: 'Renault Clio V TCe 100 Zen',
      description: 'Clio V de 2021, première main, carnet d\'entretien complet chez Renault, pneus neufs, distribution faite, aucun frais à prévoir. Visible sur Lyon en semaine et le week-end.',
      categorySlug: 'voitures',
      price: 13900,
      attributes: { marque: 'Renault', modele: 'Clio V', annee: 2021, kilometrage: 38000, type_vehicule: 'Citadine', carburant: 'Essence', boite: 'Manuelle', puissance_fiscale: 5, puissance_din: 100, portes: '5', places: 5, couleur: 'Gris', sellerie: 'Tissu', critair: '1', controle_technique: true, premiere_main: true },
    });
    for (let i = 0; i < 3; i++) {
      await request(server).post(`/listings/${full.id}/photos`).set(user.auth).attach('files', PNG_1x1, { filename: `p${i}.png`, contentType: 'image/png' }).expect(201);
    }
    const d2 = await request(server).get(`/listings/${full.id}`).expect(200);
    expect(d2.body.completeness).toEqual({ complete: true, score: 100, missing: [] });

    // Le badge est aussi porté par les cartes de résultats
    const cards = await request(server).get('/listings?category=voitures').expect(200);
    const byId = new Map(cards.body.items.map((l: any) => [l.id, l.isComplete]));
    expect(byId.get(full.id)).toBe(true);
    expect(byId.get(minimal.id)).toBe(false);

    // Année postérieure à l'année courante (mais dans les bornes du schéma) = incohérent : badge retiré
    const nextYear = new Date().getFullYear() + 1;
    if (nextYear <= 2027) {
      await request(server).patch(`/listings/${full.id}`).set(user.auth).send({ attributes: { ...d2.body.attributes, annee: nextYear } }).expect(200);
      const d3 = await request(server).get(`/listings/${full.id}`).expect(200);
      expect(d3.body.completeness.complete).toBe(false);
      expect(d3.body.completeness.missing.join(' | ')).toMatch(/Vérifier la valeur de : Année/);
    }
  });
});
