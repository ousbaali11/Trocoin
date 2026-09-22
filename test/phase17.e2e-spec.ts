import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login } from './utils';

/**
 * Phase 17 : catégorie suggérée d'après le titre, actions groupées sur ses annonces,
 * liste des appareils connectés.
 */
describe('Phase 17 : suggestion de catégorie, actions groupées, appareils', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('GET /categories/suggest : propose la bonne sous-catégorie d\'après les mots du titre', async () => {
    const cases: Array<[string, string]> = [
      ['Peugeot 208 1.2 PureTech 2019 45 000 km', 'voitures'],
      ['VTT Rockrider 540 taille M', 'velos'],
      ['iPhone 13 Pro 128 Go avec facture', 'telephonie'],
      ['Canapé trois places en velours vert', 'ameublement'],
      ['Chiot chow-chow mâle LOF vacciné', 'animaux-vente-don'],
      ['Poussette Yoyo noire avec habillage pluie', 'puericulture'],
      ['Cours particuliers de mathématiques niveau lycée', 'cours-particuliers'],
      ['Tracteur Kubota 60 ch 2015', 'agricole'],
      ['Appartement T3 65 m² à louer Lyon', 'locations'],
      // « bureau » seul tirait vers Bureaux & commerces (relevé lors du passage en production) : l'expression complète l'emporte
      ['Lampe de bureau articulée bras métal', 'decoration'],
      ['PlayStation 5 édition standard avec deux manettes', 'consoles-jeux-video'],
    ];
    for (const [title, slug] of cases) {
      const res = await request(server).get(`/categories/suggest?q=${encodeURIComponent(title)}`).expect(200);
      expect(res.body.suggestions.length > 0 ? title : 'aucune suggestion pour : ' + title).toBe(title);
      expect(res.body.suggestions.length).toBeLessThanOrEqual(3);
      expect(`${title} → ${res.body.suggestions[0]?.slug}`).toBe(`${title} → ${slug}`);
      expect(res.body.suggestions[0].rootName).toBeTruthy();
    }
    // Titre trop court ou sans mot connu : aucune suggestion, jamais d'erreur
    expect((await request(server).get('/categories/suggest?q=ab').expect(200)).body.suggestions).toEqual([]);
    expect((await request(server).get('/categories/suggest?q=zzzz%20qqqq').expect(200)).body.suggestions).toEqual([]);
  });

  it('POST /listings/bulk : pause, remise en ligne et renouvellement de plusieurs annonces ; annonces des autres ignorées', async () => {
    const pro = await login(app);
    const other = await login(app);
    const a = await createListing(app, pro, { title: 'Annonce A' });
    const b = await createListing(app, pro, { title: 'Annonce B' });
    const c = await createListing(app, pro, { title: 'Annonce C' });
    const foreign = await createListing(app, other, { title: 'Annonce d\'un autre' });

    const pause = await request(server).post('/listings/bulk').set(pro.auth).send({ ids: [a.id, b.id, foreign.id], action: 'pause' }).expect(200);
    expect(pause.body.done).toBe(2);
    expect(pause.body.failed).toHaveLength(1);
    expect(pause.body.failed[0].id).toBe(foreign.id);
    const mine = await request(server).get('/listings/mine').set(pro.auth).expect(200);
    const status = (id: string) => mine.body.find((l: any) => l.id === id).status;
    expect(status(a.id)).toBe('desactivee');
    expect(status(b.id)).toBe('desactivee');
    expect(status(c.id)).toBe('en_ligne');
    expect((await request(server).get(`/listings/${foreign.id}`)).body.status).toBe('en_ligne');

    const republish = await request(server).post('/listings/bulk').set(pro.auth).send({ ids: [a.id, b.id], action: 'republish' }).expect(200);
    expect(republish.body).toEqual({ done: 2, failed: [] });
    // AUDIT §63 : une annonce en ligne depuis moins de sept jours ne se renouvelle pas (remontée gratuite) — aucune ici
    const renew = await request(server).post('/listings/bulk').set(pro.auth).send({ ids: [a.id, c.id], action: 'renew' }).expect(200);
    expect(renew.body.done).toBe(0);
    expect(renew.body.failed).toHaveLength(2);
    const after = await request(server).get('/listings/mine').set(pro.auth).expect(200);
    expect(after.body.filter((l: any) => l.status === 'en_ligne')).toHaveLength(3);

    await request(server).post('/listings/bulk').set(pro.auth).send({ ids: [], action: 'pause' }).expect(400);
    await request(server).post('/listings/bulk').set(pro.auth).send({ ids: [a.id], action: 'supprimer' }).expect(400);
    await request(server).post('/listings/bulk').send({ ids: [a.id], action: 'pause' }).expect(401);
  });

  it('GET /auth/sessions : appareils connectés visibles, DELETE ferme tout', async () => {
    const u = await login(app);
    const s1 = await request(server).get('/auth/sessions').set(u.auth).expect(200);
    expect(s1.body.length).toBeGreaterThanOrEqual(1);
    expect(s1.body[0]).toEqual(expect.objectContaining({ familyId: expect.any(String), createdAt: expect.any(String), expiresAt: expect.any(String) }));
    await request(server).delete('/auth/sessions').set(u.auth).expect(200);
    await request(server).post('/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
  });
});
