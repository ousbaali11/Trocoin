import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { SmsService } from '../src/sms/sms.service';
import { User } from '../src/users/user.entity';
import { createApp, login, nextPhone } from './utils';

describe('Authentification (téléphone français + OTP)', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it.each(['+4915112345678', '+32470123456', '+1 555 123 4567', '+33123456789', '0123456789', '+21612345678'])(
    'rejette le numéro non-mobile-français %s',
    async (phone) => {
      const res = await request(server).post('/auth/register/phone').send({ phoneNumber: phone });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/français/);
    },
  );

  it.each(['06 12 34 56 78', '0798765432', '0033655443322', '+33 7 11 22 33 44'])(
    'accepte et normalise le format français %s',
    async (phone) => {
      const res = await request(server).post('/auth/register/phone').send({ phoneNumber: phone });
      expect(res.status).toBe(200);
      expect(res.body.phoneNumber).toMatch(/^\+33[67]\d{8}$/);
    },
  );

  it('rejette un code mal formé (validation DTO)', async () => {
    const phone = nextPhone();
    await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(200);
    await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code: 'abc' }).expect(400);
    await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code: '12345' }).expect(400);
  });

  it('flux OTP complet : mauvais code, bon code, JWT, /users/me, code non réutilisable', async () => {
    const phone = nextPhone();
    await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(200);
    const code = app.get(SmsService).getLastCodeForDev(phone)!;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = (Number(code) + 1) % 1_000_000;
    const bad = await request(server)
      .post('/auth/otp/verify')
      .send({ phoneNumber: phone, code: String(wrong).padStart(6, '0') });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/incorrect/);

    const ok = await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code }).expect(200);
    expect(ok.body.accessToken).toBeDefined();
    expect(ok.body.user.phoneNumber).toBe(phone);

    const me = await request(server).get('/users/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    expect(me.body.phoneVerified).toBe(true);
    expect(me.body.accountType).toBe('particulier');
    expect(me.body.stripeAccountId).toBeUndefined();

    const reuse = await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code });
    expect(reuse.status).toBe(400);
    expect(reuse.body.message).toMatch(/déjà été utilisé/);
  });

  it('bloque après 5 tentatives sur le même code', async () => {
    const phone = nextPhone();
    await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(200);
    for (let i = 0; i < 5; i++) {
      await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code: '000000' });
    }
    const res = await request(server).post('/auth/otp/verify').send({ phoneNumber: phone, code: '000000' });
    expect(res.status).toBe(429);
  });

  it('applique le cooldown de 60 s entre deux demandes pour le même numéro', async () => {
    const phone = nextPhone();
    await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(200);
    await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(429);
  });

  it('un JWT sans utilisateur ou un token altéré est refusé', async () => {
    await request(server).get('/users/me').expect(401);
    await request(server).get('/users/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
  });

  it('un compte suspendu perd immédiatement l\'accès, même avec un JWT valide', async () => {
    const user = await login(app);
    await request(server).get('/users/me').set(user.auth).expect(200);
    const repo = app.get<Repository<User>>(getRepositoryToken(User));
    await repo.update(user.id, { suspendedAt: new Date(), suspensionReason: 'test' });
    const res = await request(server).get('/users/me').set(user.auth);
    expect(res.status).toBe(403);
    // et ne peut pas se reconnecter
    await request(server).post('/auth/register/phone').send({ phoneNumber: user.phone }).expect(429); // cooldown
  });

  it('endpoint de dev : 404 en production quelle que soit la config SMS', async () => {
    const phone = nextPhone();
    await request(server).post('/auth/register/phone').send({ phoneNumber: phone }).expect(200);
    await request(server).get(`/dev/last-otp/${encodeURIComponent(phone)}`).expect(200);
    process.env.NODE_ENV = 'production';
    try {
      await request(server).get(`/dev/last-otp/${encodeURIComponent(phone)}`).expect(404);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('CORS : origine inconnue refusée, origine autorisée acceptée', async () => {
    const bad = await request(server).get('/categories').set('Origin', 'https://site-malveillant.example');
    expect(bad.status).toBe(403);
    const good = await request(server).get('/categories').set('Origin', 'http://localhost:3001').expect(200);
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:3001');
  });
});
