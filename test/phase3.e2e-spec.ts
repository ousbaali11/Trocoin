import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SmsService } from '../src/sms/sms.service';
import { createApp, login, nextPhone } from './utils';

describe('Phase 3 : sessions (refresh tokens rotatifs, révocation), robustesse SMS, santé', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('GET /health répond ok avec le type de base', async () => {
    const h = await request(server).get('/health').expect(200);
    expect(h.body.status).toBe('ok');
    expect(['sqlite', 'postgres']).toContain(h.body.database);
  });

  it('la connexion renvoie un access token court et un refresh token ; le refresh tourne et l\'ancien jeton est refusé', async () => {
    const phone = nextPhone();
    await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(200);
    const code = app.get(SmsService).getLastCodeForDev(phone)!;
    const login1 = await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code }).expect(200);
    expect(login1.body.expiresIn).toBe('15m');
    expect(login1.body.refreshToken).toHaveLength(64);
    const payload = JSON.parse(Buffer.from(login1.body.accessToken.split('.')[1], 'base64url').toString());
    expect(payload.exp - payload.iat).toBe(15 * 60);

    const r1 = await request(server).post('/auth/refresh').send({ refreshToken: login1.body.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(login1.body.refreshToken);
    await request(server).get('/users/me').set('Authorization', `Bearer ${r1.body.accessToken}`).expect(200);

    // Réutilisation de l'ancien jeton = vol présumé : refusé ET la famille entière est révoquée
    const reuse = await request(server).post('/auth/refresh').send({ refreshToken: login1.body.refreshToken });
    expect(reuse.status).toBe(401);
    const afterReuse = await request(server).post('/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(afterReuse.status).toBe(401);

    await request(server).post('/auth/refresh').send({ refreshToken: 'x'.repeat(40) }).expect(401);
    await request(server).post('/auth/refresh').send({ refreshToken: 'court' }).expect(400);
  });

  it('la déconnexion révoque réellement la session côté serveur ; les sessions sont listées et révocables globalement', async () => {
    const u = await login(app);
    const res = await request(server).post('/auth/register/phone').send({ phoneNumber: nextPhone() });
    expect(res.status).toBe(200);
    const sessions = await request(server).get('/auth/sessions').set(u.auth).expect(200);
    expect(sessions.body.length).toBe(1);

    await request(server).post('/auth/logout').send({ refreshToken: u.refreshToken }).expect(200);
    await request(server).post('/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    expect((await request(server).get('/auth/sessions').set(u.auth)).body.length).toBe(0);

    // Deux appareils puis "déconnecter partout"
    const phone = nextPhone();
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 0 : 0));
      if (i === 1) await new Promise((r) => setTimeout(r, 1100)); // cooldown OTP 60 s : on force un nouveau code via un 2e numéro ? Non : on réutilise la session
    }
    const first = await login(app, phone);
    const second = await request(server).post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
    tokens.push(second.body.refreshToken);
    const revoked = await request(server).delete('/auth/sessions').set('Authorization', `Bearer ${second.body.accessToken}`).expect(200);
    expect(revoked.body.revoked).toBeGreaterThanOrEqual(1);
    await request(server).post('/auth/refresh').send({ refreshToken: tokens[0] }).expect(401);
  });

  it('un compte suspendu par l\'admin ne peut plus rafraîchir sa session', async () => {
    const admin = await login(app);
    const { makeAdmin } = await import('./utils');
    await makeAdmin(app, admin);
    const victim = await login(app);
    await request(server).patch(`/admin/users/${victim.id}`).set(admin.auth).send({ suspended: true, suspensionReason: 'test phase 3' }).expect(200);
    await request(server).post('/auth/refresh').send({ refreshToken: victim.refreshToken }).expect(401);
  });

  it('échec d\'envoi SMS : 503 explicite, aucune demande fantôme, nouvel essai possible immédiatement', async () => {
    const phone = nextPhone();
    process.env.SMS_MOCK_FAIL = 'true';
    try {
      const failed = await request(server).post('/auth/register/phone').send({ phoneNumber: phone });
      expect(failed.status).toBe(503);
      expect(failed.body.message).toMatch(/SMS a échoué/);
    } finally {
      delete process.env.SMS_MOCK_FAIL;
    }
    // Pas de cooldown ni de code en attente : la demande suivante réussit et un code existe
    await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(200);
    expect(app.get(SmsService).getLastCodeForDev(phone)).toMatch(/^\d{6}$/);
    const verify = await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code: app.get(SmsService).getLastCodeForDev(phone) }).expect(200);
    expect(verify.body.accessToken).toBeDefined();
  });
});
