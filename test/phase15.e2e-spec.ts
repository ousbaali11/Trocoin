import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import { totpCode, totpStep } from '../src/auth/totp';
import { createApp, nextPhone } from './utils';

/**
 * Phase 15 : changement d'adresse e-mail confirmé depuis la nouvelle adresse (avertissement à
 * l'ancienne), double authentification TOTP (activation, connexion en deux temps, rejeu refusé,
 * codes de récupération à usage unique, désactivation), historique des localisations par compte.
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
    password: 'MotDePasse!2026',
    passwordConfirmation: 'MotDePasse!2026',
  };
};
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

describe('Phase 15 : changement d\'e-mail, double authentification, localisations récentes', () => {
  let app: INestApplication;
  let server: any;
  let email: EmailService;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    email = app.get(EmailService);
  });
  afterAll(() => app.close());

  it("changement d'adresse : mot de passe exigé, adresse libre, lien à la nouvelle adresse, avertissement à l'ancienne, effectif au clic", async () => {
    const dto = account();
    const other = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    await request(server).post('/auth/register').send(other).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    const newEmail = `nouvelle.${dto.username}@example.org`;

    // Refus : mauvais mot de passe, adresse déjà prise, adresse identique, sans session
    await request(server).post('/auth/email/change').send({ newEmail, password: dto.password }).expect(401);
    const badPw = await request(server).post('/auth/email/change').set(auth).send({ newEmail, password: 'faux-mot-de-passe' }).expect(400);
    expect(badPw.body.message).toMatch(/Mot de passe incorrect/);
    await request(server).post('/auth/email/change').set(auth).send({ newEmail: other.email.toUpperCase(), password: dto.password }).expect(409);
    await request(server).post('/auth/email/change').set(auth).send({ newEmail: dto.email, password: dto.password }).expect(400);
    await request(server).post('/auth/email/change').set(auth).send({ newEmail: 'pas-un-email', password: dto.password }).expect(400);

    const ok = await request(server).post('/auth/email/change').set(auth).send({ newEmail, password: dto.password }).expect(200);
    expect(ok.body).toEqual({ ok: true, email: newEmail });
    // Lien envoyé à la NOUVELLE adresse, avertissement envoyé à l'ANCIENNE
    const link = email.getLastVerificationLinkForDev(newEmail)!;
    expect(link).toMatch(/\/confirmer-email\?token=/);
    expect(email.getLastNoticeForDev(dto.email)).toMatch(/demande de changement/);
    // Rien n'a changé tant que le lien n'est pas ouvert
    expect((await request(server).get('/users/me').set(auth)).body.email).toBe(dto.email);

    const verified = await request(server).post('/auth/email/verify').send({ token: tokenOf(link) }).expect(200);
    expect(verified.body).toEqual({ ok: true, email: newEmail, changed: true });
    const me = await request(server).get('/users/me').set(auth).expect(200);
    expect(me.body.email).toBe(newEmail);
    expect(me.body.emailVerified).toBe(true);
    expect(email.getLastNoticeForDev(dto.email)).toMatch(/a été changée/);
    // Ancienne adresse libérée pour la connexion : la nouvelle sert d'identifiant
    await request(server).post('/auth/login').send({ identifier: newEmail, password: dto.password }).expect(200);
    await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(401);
    // Lien réutilisé refusé
    await request(server).post('/auth/email/verify').send({ token: tokenOf(link) }).expect(400);
  });

  it("changement d'adresse : le lien d'inscription de l'ancienne adresse ne vaut plus rien une fois l'adresse remplacée", async () => {
    const dto = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    const registrationLink = email.getLastVerificationLinkForDev(dto.email)!;
    const newEmail = `bis.${dto.username}@example.org`;
    await request(server).post('/auth/email/change').set(auth).send({ newEmail, password: dto.password }).expect(200);
    await request(server).post('/auth/email/verify').send({ token: tokenOf(email.getLastVerificationLinkForDev(newEmail)!) }).expect(200);
    // Le lien reçu à l'inscription (ancienne adresse) ne peut pas ramener l'ancienne adresse
    await request(server).post('/auth/email/verify').send({ token: tokenOf(registrationLink) }).expect(400);
    expect((await request(server).get('/users/me').set(auth)).body.email).toBe(newEmail);
  });

  it('double authentification : activation par code, connexion en deux temps, rejeu refusé, code de récupération à usage unique, désactivation', async () => {
    const dto = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    expect(created.body.user.twoFactorEnabled).toBe(false);

    // Activer sans avoir généré de secret : refusé
    await request(server).post('/auth/2fa/enable').set(auth).send({ code: '123456' }).expect(400);
    const setup = await request(server).post('/auth/2fa/setup').set(auth).expect(200);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Trocoin:.*secret=[A-Z2-7]{32}&issuer=Trocoin/);
    expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    // Tant que le code n'est pas confirmé, la connexion reste simple et /users/me ne montre rien
    expect((await request(server).get('/users/me').set(auth)).body.twoFactorEnabled).toBe(false);
    expect((await request(server).get('/users/me').set(auth)).body.totpSecret).toBeUndefined();
    await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);

    // Mauvais code refusé, bon code accepté → codes de récupération renvoyés une seule fois.
    // (Code du pas précédent, accepté grâce à la tolérance ± 30 s : le code courant reste alors
    // disponible pour la connexion qui suit, un code déjà servi n'étant jamais rejoué.)
    await request(server).post('/auth/2fa/enable').set(auth).send({ code: '000000' }).expect(400);
    const enabled = await request(server).post('/auth/2fa/enable').set(auth).send({ code: totpCode(setup.body.secret, totpStep() - 1) }).expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(8);
    expect(enabled.body.recoveryCodes[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    const me = await request(server).get('/users/me').set(auth).expect(200);
    expect(me.body.twoFactorEnabled).toBe(true);
    expect(me.body.totpRecoveryCodes).toBeUndefined();
    await request(server).post('/auth/2fa/setup').set(auth).expect(400);

    // Connexion : le mot de passe seul ne suffit plus
    const step1 = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);
    expect(step1.body).toEqual({ twoFactorRequired: true, challengeToken: expect.any(String), expiresIn: '5m' });
    expect(step1.body.accessToken).toBeUndefined();
    // Le jeton intermédiaire n'est pas une session
    await request(server).get('/users/me').set({ Authorization: `Bearer ${step1.body.challengeToken}` }).expect(401);
    // Mauvais code → 401 ; jeton bidon → 401
    await request(server).post('/auth/login/2fa').send({ challengeToken: step1.body.challengeToken, code: '000000' }).expect(401);
    await request(server).post('/auth/login/2fa').send({ challengeToken: 'x'.repeat(40), code: totpCode(setup.body.secret) }).expect(401);
    // Bon code → session ouverte
    const step2 = await request(server).post('/auth/login/2fa').send({ challengeToken: step1.body.challengeToken, code: totpCode(setup.body.secret) }).expect(200);
    expect(step2.body.accessToken).toBeTruthy();
    expect(step2.body.user.twoFactorEnabled).toBe(true);
    await request(server).get('/users/me').set({ Authorization: `Bearer ${step2.body.accessToken}` }).expect(200);
    // Le même code ne peut pas être rejoué dans sa fenêtre de 30 s
    const again = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);
    await request(server).post('/auth/login/2fa').send({ challengeToken: again.body.challengeToken, code: totpCode(setup.body.secret) }).expect(401);
    // … mais le code du pas suivant, lui, passe (tolérance ± 1 pas)
    const next = await request(server).post('/auth/login/2fa').send({ challengeToken: again.body.challengeToken, code: totpCode(setup.body.secret, totpStep() + 1) }).expect(200);
    expect(next.body.accessToken).toBeTruthy();

    // Code de récupération : accepté une fois, pas deux
    const recovery = enabled.body.recoveryCodes[3] as string;
    const c1 = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);
    await request(server).post('/auth/login/2fa').send({ challengeToken: c1.body.challengeToken, code: recovery.toUpperCase() }).expect(200);
    const c2 = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);
    await request(server).post('/auth/login/2fa').send({ challengeToken: c2.body.challengeToken, code: recovery }).expect(401);

    // Désactivation : mot de passe + code ; ensuite la connexion redevient simple
    await request(server).post('/auth/2fa/disable').set(auth).send({ password: 'faux', code: enabled.body.recoveryCodes[0] }).expect(400);
    await request(server).post('/auth/2fa/disable').set(auth).send({ password: dto.password, code: '000000' }).expect(401);
    await request(server).post('/auth/2fa/disable').set(auth).send({ password: dto.password, code: enabled.body.recoveryCodes[0] }).expect(200);
    expect((await request(server).get('/users/me').set(auth)).body.twoFactorEnabled).toBe(false);
    const simple = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);
    expect(simple.body.accessToken).toBeTruthy();
  });

  it('localisations récentes : enregistrées sur le compte (5 au plus, sans doublon, entrées invalides ignorées)', async () => {
    const dto = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    expect((await request(server).get('/users/me').set(auth)).body.recentLocations).toEqual([]);
    const list = [
      { city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.84 },
      { city: 'Paris', postalCode: '75011', latitude: 48.86, longitude: 2.38 },
      { city: 'lyon', postalCode: '69003' }, // doublon (insensible à la casse)
      { city: '<script>', postalCode: '00000' }, // ignoré
      { city: 'Annecy', postalCode: 'abc', latitude: 999 }, // code postal et latitude invalides écartés
      { city: 'Nantes' },
      { city: 'Lille' },
      { city: 'Nice' },
    ];
    const res = await request(server).patch('/users/me').set(auth).send({ recentLocations: list }).expect(200);
    expect(res.body.recentLocations).toEqual([
      { city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.84 },
      { city: 'Paris', postalCode: '75011', latitude: 48.86, longitude: 2.38 },
      { city: 'Annecy' },
      { city: 'Nantes' },
      { city: 'Lille' },
    ]);
    await request(server).patch('/users/me').set(auth).send({ recentLocations: 'pas-une-liste' }).expect(400);
  });

  it('véhicules : marque et modèle en listes dépendantes, modèle hors liste refusé, filtre par marque', async () => {
    const schema = await request(server).get('/categories/voitures/schema').expect(200);
    const marque = schema.body.fields.find((f: any) => f.key === 'marque');
    const modele = schema.body.fields.find((f: any) => f.key === 'modele');
    expect(marque.type).toBe('select');
    expect(marque.options).toEqual(expect.arrayContaining(['Peugeot', 'Renault', 'Tesla', 'Autre']));
    expect(marque.options[marque.options.length - 1]).toBe('Autre');
    expect(modele.dependsOn).toBe('marque');
    expect(modele.optionsByParent.Peugeot).toEqual(expect.arrayContaining(['208', '3008', 'Autre']));
    expect(modele.optionsByParent.Renault).not.toContain('208');
    const motos = await request(server).get('/categories/motos/schema').expect(200);
    expect(motos.body.fields.find((f: any) => f.key === 'modele').optionsByParent.Yamaha).toContain('MT-07');
    const utilitaires = await request(server).get('/categories/utilitaires/schema').expect(200);
    expect(utilitaires.body.fields.find((f: any) => f.key === 'modele').optionsByParent.Renault).toContain('Master');

    const dto = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    const base = { title: 'Peugeot 208 essence', description: 'Voiture bien entretenue, contrôle technique OK.', categorySlug: 'voitures', price: 8900, condition: 'bon_etat', city: 'Lyon', postalCode: '69003' };
    const attrs = { annee: 2018, kilometrage: 64000, carburant: 'Essence', boite: 'Manuelle' };
    // Modèle d'une autre marque refusé, marque inconnue refusée
    const wrong = await request(server).post('/listings').set(auth).send({ ...base, attributes: { ...attrs, marque: 'Peugeot', modele: 'Clio' } }).expect(400);
    expect(JSON.stringify(wrong.body.message)).toMatch(/Modèle/);
    await request(server).post('/listings').set(auth).send({ ...base, attributes: { ...attrs, marque: 'Marque-inconnue', modele: '208' } }).expect(400);
    // Couple cohérent accepté, « Autre » accepté
    const ok = await request(server).post('/listings').set(auth).send({ ...base, attributes: { ...attrs, marque: 'Peugeot', modele: '208' } }).expect(201);
    await request(server).post('/listings').set(auth).send({ ...base, title: 'Voiture rare', attributes: { ...attrs, marque: 'Autre', modele: 'Autre' } }).expect(201);
    const found = await request(server).get('/listings?category=voitures&attr.marque=Peugeot&attr.modele=208').expect(200);
    expect(found.body.items.map((l: any) => l.id)).toContain(ok.body.id);
    const none = await request(server).get('/listings?category=voitures&attr.marque=Renault').expect(200);
    expect(none.body.items.map((l: any) => l.id)).not.toContain(ok.body.id);
  });
});
