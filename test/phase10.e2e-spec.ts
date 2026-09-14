import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, login, nextPhone } from './utils';

/**
 * Phase 10 : suppression d'un compte à mot de passe — identifiants libérés,
 * connexion impossible, sessions révoquées, données anonymisées.
 */
describe('Phase 10 : suppression d\'un compte à mot de passe', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('après suppression : login refusé, refresh révoqué, e-mail / username / téléphone réutilisables, profil anonymisé', async () => {
    const tag = `${String(Date.now()).slice(-6)}`;
    const dto = { accountType: 'particulier', firstName: 'Nora', lastName: 'Bex', username: `nora_${tag}`, email: `nora.${tag}@example.org`, phoneNumber: nextPhone(), password: 'MotDePasse!42', passwordConfirmation: 'MotDePasse!42' };
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    const other = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);

    await request(server).delete('/users/me').set(auth).expect(204);

    await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(401);
    await request(server).post('/auth/login').send({ identifier: dto.username, password: dto.password }).expect(401);
    await request(server).post('/auth/refresh').send({ refreshToken: other.body.refreshToken }).expect(401);
    await request(server).get('/users/me').set(auth).expect(401);

    // Le profil public ne révèle plus l'identité
    const profile = await request(server).get(`/users/${created.body.user.id}/profile`);
    if (profile.status === 200) {
      expect(profile.body.displayName).toBe('Compte supprimé');
      expect(JSON.stringify(profile.body)).not.toMatch(/Nora|Bex|nora_/);
    }

    // Les identifiants sont libres pour une nouvelle inscription
    const again = await request(server).post('/auth/register').send({ ...dto, firstName: 'Nora2' }).expect(201);
    expect(again.body.user.id).not.toBe(created.body.user.id);
    expect(again.body.user.username).toBe(dto.username);
  });

  it('un compte OTP historique se supprime toujours', async () => {
    const legacy = await login(app);
    await request(server).delete('/users/me').set(legacy.auth).expect(204);
    await request(server).get('/users/me').set(legacy.auth).expect(401);
  });
});
