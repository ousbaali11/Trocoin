import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login, PNG_1x1 } from './utils';

/**
 * Phase 8 : recherche plein texte (PostgreSQL) et plafond de photos par compte.
 */
describe('Phase 8 : plein texte Postgres, plafond de photos', () => {
  let app: INestApplication;
  let server: any;
  const isPostgres = process.env.E2E_DB === 'postgres';

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => {
    delete process.env.MAX_PHOTOS_PER_DAY;
    return app.close();
  });

  (isPostgres ? it : it.skip)('plein texte français : pluriels, accents et ordre des mots trouvent l\'annonce ; les codes courts passent toujours', async () => {
    const user = await login(app);
    const velo = await createListing(app, user, { title: 'Vélo électrique de ville', description: 'Batterie neuve, freins hydrauliques révisés, parfait pour les trajets quotidiens.' });
    const clio = await createListing(app, user, { title: 'Clio 4 essence', categorySlug: 'voitures', price: 6500, attributes: { marque: 'Renault', modele: 'Clio', annee: 2016, kilometrage: 98000, carburant: 'Essence', boite: 'Manuelle' } });
    const ids = async (q: string) => (await request(server).get(`/listings?q=${encodeURIComponent(q)}`).expect(200)).body.items.map((l: any) => l.id);
    expect(await ids('velos electriques')).toContain(velo.id); // pluriel + sans accents
    expect(await ids('freins hydraulique')).toContain(velo.id); // mot de la description, singulier
    expect(await ids('ville vélo')).toContain(velo.id); // ordre inversé
    expect(await ids('velos electriques')).not.toContain(clio.id);
    expect(await ids('clio')).toContain(clio.id); // code court via LIKE
  });

  it('au-delà du plafond quotidien de photos du compte, l\'envoi est refusé et rien n\'est conservé', async () => {
    process.env.MAX_PHOTOS_PER_DAY = '3';
    const user = await login(app);
    const a = await createListing(app, user, { title: 'Annonce A' });
    const b = await createListing(app, user, { title: 'Annonce B' });
    const upload = (id: string, n: number) => {
      let req = request(server).post(`/listings/${id}/photos`).set(user.auth);
      for (let i = 0; i < n; i++) req = req.attach('files', PNG_1x1, { filename: `p${i}.png`, contentType: 'image/png' });
      return req;
    };
    await upload(a.id, 2).expect(201);
    await upload(b.id, 1).expect(201); // 3/3
    const over = await upload(b.id, 1).expect(400);
    expect(over.body.message).toMatch(/Limite de 3 photos par 24 h/);
    const detail = await request(server).get(`/listings/${b.id}`).expect(200);
    expect(detail.body.photos).toHaveLength(1);
    // Un autre compte n'est pas concerné
    const other = await login(app);
    const c = await createListing(app, other, { title: 'Annonce C' });
    await upload(c.id, 1).set(other.auth).expect(201);
  });
});
