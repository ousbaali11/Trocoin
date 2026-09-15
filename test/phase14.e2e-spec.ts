import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { EmailVerificationToken } from '../src/auth/email-verification-token.entity';
import { EmailService } from '../src/email/email.service';
import { createApp, nextPhone } from './utils';

/**
 * Phase 14 : confirmation de l'adresse e-mail à l'inscription.
 * Lien à usage unique (24 h) envoyé via le fournisseur d'e-mail (mock ici, Resend en production),
 * endpoint POST /auth/email/verify, renvoi limité depuis les paramètres, statut visible sur /users/me.
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

describe("Phase 14 : confirmation de l'adresse e-mail", () => {
  let app: INestApplication;
  let server: any;
  let tokens: Repository<EmailVerificationToken>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    tokens = app.get(getRepositoryToken(EmailVerificationToken));
  });
  afterAll(() => app.close());

  it('inscription → lien reçu → validation → emailVerified = true → jeton réutilisé refusé', async () => {
    const dto = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    expect(created.body.user.emailVerified).toBe(false);
    expect(created.body.verificationEmailSent).toBe(true);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };

    const me0 = await request(server).get('/users/me').set(auth).expect(200);
    expect(me0.body.emailVerified).toBe(false);

    // Le lien est celui envoyé par le fournisseur d'e-mail (mock : conservé pour le dev)
    const link = app.get(EmailService).getLastVerificationLinkForDev(dto.email)!;
    expect(link).toMatch(/\/confirmer-email\?token=/);
    const dev = await request(server).get(`/dev/last-verification-link/${encodeURIComponent(dto.email)}`).expect(200);
    expect(dev.body.link).toBe(link);
    const token = tokenOf(link);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 octets aléatoires en base64url : non devinable

    // Seul le hash est stocké, jamais le jeton en clair
    const stored = await tokens.findOne({ where: { userId: created.body.user.id } });
    expect(stored).toBeTruthy();
    expect(stored!.tokenHash).not.toBe(token);
    expect(stored!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);

    // Jeton inconnu / trop court refusés
    await request(server).post('/auth/email/verify').send({ token: 'x'.repeat(43) }).expect(400);
    await request(server).post('/auth/email/verify').send({ token: 'court' }).expect(400);

    // Validation sans session (le lien peut être ouvert sur un autre appareil)
    const ok = await request(server).post('/auth/email/verify').send({ token }).expect(200);
    expect(ok.body).toEqual({ ok: true, email: dto.email, changed: false });

    const me1 = await request(server).get('/users/me').set(auth).expect(200);
    expect(me1.body.emailVerified).toBe(true);
    expect(me1.body.emailVerifiedAt).toBeTruthy();

    // Jeton consommé : réutilisation refusée avec un message clair
    const reuse = await request(server).post('/auth/email/verify').send({ token }).expect(400);
    expect(reuse.body.message).toMatch(/invalide ou expiré/);

    // Adresse déjà confirmée : le renvoi est refusé
    const resend = await request(server).post('/auth/email/resend').set(auth).expect(400);
    expect(resend.body.message).toMatch(/déjà confirmée/);

    // La connexion expose aussi le statut
    const login = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);
    expect(login.body.user.emailVerified).toBe(true);
  });

  it('jeton expiré (24 h dépassées) : refus, puis renvoi depuis les paramètres avec délai minimum', async () => {
    const dto = account();
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    const first = tokenOf(app.get(EmailService).getLastVerificationLinkForDev(dto.email)!);

    // On recule l'expiration en base : le lien reçu ne vaut plus rien
    await tokens.update({ userId: created.body.user.id }, { expiresAt: new Date(Date.now() - 1000) });
    const expired = await request(server).post('/auth/email/verify').send({ token: first }).expect(400);
    expect(expired.body.message).toMatch(/invalide ou expiré/);
    expect((await request(server).get('/users/me').set(auth)).body.emailVerified).toBe(false);

    // Renvoi trop rapproché (moins de 60 s après l'e-mail d'inscription) : refusé
    const tooSoon = await request(server).post('/auth/email/resend').set(auth).expect(400);
    expect(tooSoon.body.message).toMatch(/Patientez/);

    // Une fois le délai passé (on antidate le jeton précédent), le renvoi émet un nouveau lien
    await tokens.update({ userId: created.body.user.id }, { createdAt: new Date(Date.now() - 120_000) });
    const resent = await request(server).post('/auth/email/resend').set(auth).expect(200);
    expect(resent.body).toEqual({ ok: true, email: dto.email });
    const second = tokenOf(app.get(EmailService).getLastVerificationLinkForDev(dto.email)!);
    expect(second).not.toBe(first);

    await request(server).post('/auth/email/verify').send({ token: second }).expect(200);
    expect((await request(server).get('/users/me').set(auth)).body.emailVerified).toBe(true);

    // Renvoi sans session refusé
    await request(server).post('/auth/email/resend').expect(401);
  });
});
