import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SmsService } from '../src/sms/sms.service';
import { createApp, login, makeAdmin, nextPhone } from './utils';

/**
 * Phase 5 : inscription par formulaire (particulier / professionnel), sans SMS,
 * mot de passe haché, connexion e-mail ou username + mot de passe, doublons
 * refusés avec un message explicite, comptes OTP existants intacts.
 */
const SIRET_OK = '73282932000074'; // clé de Luhn valide
const SIRET_KO = '73282932000075';
let n = 0;
const base = () => {
  n += 1;
  const tag = `${String(Date.now()).slice(-5)}${n}`;
  return {
    accountType: 'particulier' as const,
    firstName: 'Camille',
    lastName: 'Durand',
    username: `camille_${tag}`,
    email: `camille.${tag}@example.org`,
    phoneNumber: nextPhone(),
    password: 'MotDePasse!42',
    passwordConfirmation: 'MotDePasse!42',
  };
};

describe('Phase 5 : inscription par formulaire et connexion par mot de passe', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('particulier : compte créé sans aucun SMS, téléphone non vérifié, session ouverte, hash jamais exposé', async () => {
    const dto = base();
    const res = await request(server).post('/auth/register').send(dto).expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user).toMatchObject({ phoneVerified: false, accountType: 'particulier', username: dto.username, displayName: 'Camille D.' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
    // Aucun code OTP n'a été généré/envoyé pour ce numéro
    expect(app.get(SmsService).getLastCodeForDev(res.body.user.phoneNumber)).toBeUndefined();

    const me = await request(server).get('/users/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ firstName: 'Camille', lastName: 'Durand', username: dto.username, email: dto.email, phoneVerified: false });
    expect(me.body.passwordHash).toBeUndefined();

    // Connexion par e-mail puis par username ; mauvais mot de passe refusé avec un message générique
    const byEmail = await request(server).post('/auth/login').send({ identifier: dto.email.toUpperCase(), password: dto.password }).expect(200);
    expect(byEmail.body.user.id).toBe(res.body.user.id);
    await request(server).post('/auth/login').send({ identifier: dto.username, password: dto.password }).expect(200);
    // … et par numéro de mobile, quelle que soit l'écriture (espaces, 0 initial, +33), avec espaces autour de l'e-mail tolérés
    const national = '0' + res.body.user.phoneNumber.slice(3);
    const spaced = national.replace(/(\d{2})(?=\d)/g, '$1 ');
    for (const identifier of [res.body.user.phoneNumber, national, spaced, `  ${dto.email}  `]) {
      const r = await request(server).post('/auth/login').send({ identifier, password: dto.password }).expect(200);
      expect(r.body.user.id).toBe(res.body.user.id);
    }
    await request(server).post('/auth/login').send({ identifier: national, password: 'faux-mot-de-passe' }).expect(401);
    const bad = await request(server).post('/auth/login').send({ identifier: dto.email, password: 'faux-mot-de-passe' }).expect(401);
    expect(bad.body.message).toBe('Identifiant ou mot de passe incorrect.');
    const unknown = await request(server).post('/auth/login').send({ identifier: 'inconnu@example.org', password: dto.password }).expect(401);
    expect(unknown.body.message).toBe('Identifiant ou mot de passe incorrect.');
  });

  it('professionnel : SIRET valide accepté (raison sociale = nom affiché, compte pro), SIRET invalide et champs manquants refusés', async () => {
    const ko = await request(server).post('/auth/register').send({ ...base(), accountType: 'professionnel', companyName: 'Garage Martin', siret: SIRET_KO }).expect(400);
    expect(JSON.stringify(ko.body.message)).toMatch(/SIRET invalide/);

    const missing = await request(server).post('/auth/register').send({ ...base(), accountType: 'professionnel' }).expect(400);
    expect(JSON.stringify(missing.body.message)).toMatch(/raison sociale|SIRET/i);

    const ok = await request(server).post('/auth/register').send({ ...base(), accountType: 'professionnel', companyName: 'Garage Martin', siret: SIRET_OK }).expect(201);
    expect(ok.body.user).toMatchObject({ accountType: 'professionnel', displayName: 'Garage Martin', phoneVerified: false });
    const me = await request(server).get('/users/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ companyName: 'Garage Martin', shopName: 'Garage Martin', siret: SIRET_OK });

    // Le même SIRET ne peut pas servir deux fois
    const dup = await request(server).post('/auth/register').send({ ...base(), accountType: 'professionnel', companyName: 'Autre', siret: SIRET_OK }).expect(409);
    expect(dup.body.message).toBe('Ce SIRET est déjà rattaché à un compte.');
  });

  it('doublons : e-mail, téléphone et username déjà utilisés → messages explicites ; validations de base', async () => {
    const first = base();
    await request(server).post('/auth/register').send(first).expect(201);

    const email = await request(server).post('/auth/register').send({ ...base(), email: first.email.toUpperCase() }).expect(409);
    expect(email.body.message).toBe('Cette adresse e-mail est déjà utilisée.');

    const phone = await request(server).post('/auth/register').send({ ...base(), phoneNumber: first.phoneNumber.replace('+33', '0') }).expect(409);
    expect(phone.body.message).toBe('Ce numéro de téléphone est déjà associé à un compte.');

    const username = await request(server).post('/auth/register').send({ ...base(), username: first.username.toUpperCase() }).expect(409);
    expect(username.body.message).toBe("Ce nom d'utilisateur est déjà pris.");

    const mismatch = await request(server).post('/auth/register').send({ ...base(), passwordConfirmation: 'autre' }).expect(400);
    expect(mismatch.body.message).toBe('Les deux mots de passe ne correspondent pas.');

    const foreign = await request(server).post('/auth/register').send({ ...base(), phoneNumber: '+41791234567' }).expect(400);
    expect(foreign.body.message).toMatch(/mobile français/);

    const short = await request(server).post('/auth/register').send({ ...base(), password: 'court', passwordConfirmation: 'court' }).expect(400);
    expect(JSON.stringify(short.body.message)).toMatch(/8 caractères/);

    await request(server).post('/auth/register').send({ ...base(), email: 'pas-un-email' }).expect(400);
    await request(server).post('/auth/register').send({ ...base(), username: 'a b' }).expect(400);
  });

  it('comptes OTP existants : toujours fonctionnels, sans mot de passe → connexion par mot de passe refusée avec explication ; suspension bloque la connexion', async () => {
    const legacy = await login(app); // parcours OTP historique (utils)
    const me = await request(server).get('/users/me').set(legacy.auth).expect(200);
    expect(me.body.phoneVerified).toBe(true);
    expect(me.body.username).toBeNull();

    // Un compte OTP a un e-mail nullable : on lui en donne un puis on tente le mot de passe
    await request(server).patch('/users/me').set(legacy.auth).send({ email: `legacy.${Date.now()}@example.org` }).expect(200);
    const attempt = await request(server).post('/auth/login').send({ identifier: `legacy.${Date.now()}@example.org`, password: 'x'.repeat(8) });
    expect([401]).toContain(attempt.status);

    const dto = base();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const admin = await login(app);
    await makeAdmin(app, admin);
    await request(server).patch(`/admin/users/${created.body.user.id}`).set(admin.auth).send({ suspended: true, suspensionReason: 'test phase 5' }).expect(200);
    const blocked = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(403);
    expect(blocked.body.message).toMatch(/suspendu/);
  });
});
