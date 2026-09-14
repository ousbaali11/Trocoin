import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { LegalPage } from '../src/pages/legal-page.entity';
import { PagesService } from '../src/pages/pages.service';
import { createApp, login } from './utils';

/**
 * Phase 11 : préférences de notification granulaires (famille × canal) et
 * pages légales resynchronisées tant qu'un admin ne les a pas éditées.
 */
describe('Phase 11 : préférences de notification', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('expose des préférences par défaut cohérentes dans /users/me', async () => {
    const u = await login(app);
    const me = await request(server).get('/users/me').set(u.auth).expect(200);
    expect(me.body.notificationPrefs).toBeDefined();
    expect(me.body.notificationPrefs.message).toEqual({ push: true, sms: false, email: true });
    expect(me.body.notificationPrefs.systeme.email).toBe(false);
    // Le JSON brut n'est jamais renvoyé tel quel
    expect(typeof me.body.notificationPrefs).toBe('object');
  });

  it('enregistre une préférence par famille et la relit ; le SMS reste réservé aux évènements critiques', async () => {
    const u = await login(app);
    await request(server)
      .patch('/users/me')
      .set(u.auth)
      .send({ notifySms: true, notificationPrefs: { message: { push: false, sms: true }, transaction: { sms: true, email: false } } })
      .expect(200);
    const me = await request(server).get('/users/me').set(u.auth).expect(200);
    expect(me.body.notificationPrefs.message.push).toBe(false);
    // « message » n'est pas critique : le SMS y est ignoré même demandé
    expect(me.body.notificationPrefs.message.sms).toBe(false);
    expect(me.body.notificationPrefs.transaction).toEqual({ push: true, sms: true, email: false });
    // Familles non citées : défauts conservés
    expect(me.body.notificationPrefs.alerte_recherche).toEqual({ push: true, sms: false, email: true });
  });

  it("l'interrupteur global notifyPush coupe le push de toutes les familles", async () => {
    const u = await login(app);
    await request(server).patch('/users/me').set(u.auth).send({ notifyPush: false }).expect(200);
    const me = await request(server).get('/users/me').set(u.auth).expect(200);
    for (const fam of Object.values(me.body.notificationPrefs) as Array<{ push: boolean }>) expect(fam.push).toBe(false);
  });

  it('refuse une famille ou un canal inconnu, ou une valeur non booléenne', async () => {
    const u = await login(app);
    await request(server).patch('/users/me').set(u.auth).send({ notificationPrefs: { spam: { push: true } } }).expect(400);
    await request(server).patch('/users/me').set(u.auth).send({ notificationPrefs: { message: { pigeon: true } } }).expect(400);
    await request(server).patch('/users/me').set(u.auth).send({ notificationPrefs: { message: { push: 'oui' } } }).expect(400);
  });

  it("l'export RGPD contient les préférences effectives", async () => {
    const u = await login(app);
    const exp = await request(server).get('/users/me/export').set(u.auth).expect(200);
    expect(exp.body.profile.notificationPrefs.message).toBeDefined();
    expect(exp.body.profile.passwordHash).toBeUndefined();
  });
});

describe('Phase 11 : pages légales', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it("les CGU par défaut ne promettent plus une vérification SMS à l'inscription", async () => {
    // Base persistante (PostgreSQL) : une autre suite a pu éditer la page en tant qu'admin ;
    // on la remet dans l'état « jamais éditée, contenu périmé » pour tester la resynchronisation.
    const repo = app.get<Repository<LegalPage>>(getRepositoryToken(LegalPage));
    await repo.update('cgu', { updatedBy: null as unknown as string, content: 'Ancien texte : vérifié par code SMS.' });
    await repo.update('mentions-legales', { updatedBy: null as unknown as string, content: "Ancien texte : données hébergées dans l'Union européenne." });
    await app.get(PagesService).onModuleInit();

    const cgu = await request(server).get('/pages/cgu').expect(200);
    expect(cgu.body.content).not.toMatch(/vérifié par code SMS/);
    expect(cgu.body.content).toMatch(/adresse e-mail et un mot de passe/);
    const ml = await request(server).get('/pages/mentions-legales').expect(200);
    expect(ml.body.content).not.toMatch(/hébergées dans l'Union européenne/);
  });

  it("une page éditée par un administrateur n'est jamais écrasée par le texte par défaut", async () => {
    const repo = app.get<Repository<LegalPage>>(getRepositoryToken(LegalPage));
    await repo.update('a-propos', { updatedBy: 'admin-test', content: 'Texte personnalisé par un administrateur.' });
    await app.get(PagesService).onModuleInit();
    const page = await request(server).get('/pages/a-propos').expect(200);
    expect(page.body.content).toBe('Texte personnalisé par un administrateur.');
    await repo.update('a-propos', { updatedBy: null as unknown as string });
  });
});
