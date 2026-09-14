import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import { createApp, login, makeAdmin, nextPhone } from './utils';

/**
 * Phase 6 : mot de passe oublié (e-mail simulé), réinitialisation, réinitialisation
 * par l'admin, filtres de catégorie ajoutés après le relevé leboncoin.
 */
let n = 0;
const account = () => {
  n += 1;
  const tag = `${String(Date.now()).slice(-5)}${n}`;
  return {
    accountType: 'particulier' as const,
    firstName: 'Léa',
    lastName: 'Martin',
    username: `lea_${tag}`,
    email: `lea.${tag}@example.org`,
    phoneNumber: nextPhone(),
    password: 'AncienMdp!2026',
    passwordConfirmation: 'AncienMdp!2026',
  };
};
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

describe('Phase 6 : mot de passe oublié, réinitialisation, filtres par catégorie', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('mot de passe oublié : lien à usage unique (1 h) envoyé via le fournisseur mock, réinitialisation, sessions révoquées', async () => {
    const dto = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);

    // Réponse identique que le compte existe ou non (pas d'énumération)
    await request(server).post('/auth/password/forgot').send({ identifier: 'personne@example.org' }).expect(200);
    const req = await request(server).post('/auth/password/forgot').send({ identifier: dto.username }).expect(200);
    expect(req.body).toEqual({ ok: true });

    const link = app.get(EmailService).getLastResetLinkForDev(dto.email)!;
    expect(link).toMatch(/\/reinitialiser\?token=/);
    const dev = await request(server).get(`/dev/last-reset-link/${encodeURIComponent(dto.email)}`).expect(200);
    expect(dev.body.link).toBe(link);
    const token = tokenOf(link);

    // Confirmation différente refusée, jeton inconnu refusé
    await request(server).post('/auth/password/reset').send({ token, password: 'NouveauMdp!2026', passwordConfirmation: 'autre-chose' }).expect(400);
    await request(server).post('/auth/password/reset').send({ token: 'x'.repeat(43), password: 'NouveauMdp!2026', passwordConfirmation: 'NouveauMdp!2026' }).expect(400);

    await request(server).post('/auth/password/reset').send({ token, password: 'NouveauMdp!2026', passwordConfirmation: 'NouveauMdp!2026' }).expect(200);

    // Jeton consommé : réutilisation refusée
    const reuse = await request(server).post('/auth/password/reset').send({ token, password: 'Encore!2026x', passwordConfirmation: 'Encore!2026x' }).expect(400);
    expect(reuse.body.message).toMatch(/invalide ou expiré/);

    // Ancien mot de passe refusé, nouveau accepté, ancienne session révoquée
    await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(401);
    await request(server).post('/auth/login').send({ identifier: dto.email, password: 'NouveauMdp!2026' }).expect(200);
    await request(server).post('/auth/refresh').send({ refreshToken: created.body.refreshToken }).expect(401);
  });

  it("réinitialisation par l'admin : mot de passe temporaire affiché une fois, journalisé, sessions révoquées", async () => {
    const dto = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const admin = await login(app);
    await makeAdmin(app, admin);

    const res = await request(server).post(`/admin/users/${created.body.user.id}/reset-password`).set(admin.auth).expect(200);
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    await request(server).post('/auth/login').send({ identifier: dto.username, password: dto.password }).expect(401);
    await request(server).post('/auth/login').send({ identifier: dto.username, password: res.body.temporaryPassword }).expect(200);
    await request(server).post('/auth/refresh').send({ refreshToken: created.body.refreshToken }).expect(401);

    const log = await request(server).get('/admin/audit-log?page_size=5').set(admin.auth).expect(200);
    expect(JSON.stringify(log.body)).toMatch(/user\.reset_password/);

    // Un simple membre ne peut pas
    const member = await login(app);
    await request(server).post(`/admin/users/${created.body.user.id}/reset-password`).set(member.auth).expect(403);
  });

  it('filtres ajoutés après le relevé leboncoin : type de véhicule et couleur (liste), exposition, pièce ; filtrables', async () => {
    const voitures = await request(server).get('/categories/voitures/schema').expect(200);
    const keys = voitures.body.fields.map((f: any) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['type_vehicule', 'puissance_din', 'couleur', 'portes', 'places']));
    const couleur = voitures.body.fields.find((f: any) => f.key === 'couleur');
    expect(couleur.type).toBe('select');
    expect(couleur.filterable).toBe(true);

    const ventes = await request(server).get('/categories/ventes-immobilieres/schema').expect(200);
    expect(ventes.body.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(['type_vente', 'exposition', 'etat_bien', 'chambres', 'etage', 'ascenseur']));
    const emploi = await request(server).get('/categories/offres-emploi/schema').expect(200);
    expect(emploi.body.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(['contrat', 'fonction', 'niveau_etudes', 'experience', 'temps']));
    const meubles = await request(server).get('/categories/ameublement/schema').expect(200);
    expect(meubles.body.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(['piece', 'matiere', 'couleur', 'marque']));

    // Le nouveau filtre fonctionne en recherche
    const user = await login(app);
    const base = { categorySlug: 'voitures', price: 9000, description: 'Voiture bien entretenue, contrôle technique OK.', attributes: { marque: 'Peugeot', modele: '3008', annee: 2019, kilometrage: 70000, carburant: 'Diesel', boite: 'Automatique' } };
    const suv = await request(server).post('/listings').set(user.auth).send({ ...base, title: 'Peugeot 3008 SUV', attributes: { ...base.attributes, type_vehicule: '4x4 / SUV / Crossover', couleur: 'Gris' } }).expect(201);
    const berline = await request(server).post('/listings').set(user.auth).send({ ...base, title: 'Peugeot 508 berline', attributes: { ...base.attributes, modele: '508', type_vehicule: 'Berline', couleur: 'Noir' } }).expect(201);
    const res = await request(server).get(`/listings?category=voitures&attr.type_vehicule=${encodeURIComponent('4x4 / SUV / Crossover')}`).expect(200);
    const ids = res.body.items.map((l: any) => l.id);
    expect(ids).toContain(suv.body.id);
    expect(ids).not.toContain(berline.body.id);
    const noirs = await request(server).get('/listings?category=voitures&attr.couleur=Noir').expect(200);
    expect(noirs.body.items.map((l: any) => l.id)).toContain(berline.body.id);
    // Valeur hors liste refusée au dépôt
    await request(server).post('/listings').set(user.auth).send({ ...base, title: 'Peugeot 208', attributes: { ...base.attributes, couleur: 'Turquoise pailleté' } }).expect(400);
  });
});
