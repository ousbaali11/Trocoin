import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login, PNG_1x1 } from './utils';

/**
 * Phase 33 (AUDIT §56) : plus de plafond de photos par annonce. Les garde-fous qui restent sont techniques
 * (10 fichiers par envoi) et anti-abus (plafond quotidien par compte, testé en phase 8).
 */
describe('Phase 33 : photos sans plafond par annonce', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  const upload = (id: string, auth: Record<string, string>, n: number, from = 0) => {
    let req = request(server).post(`/listings/${id}/photos`).set(auth);
    for (let i = 0; i < n; i++) req = req.attach('files', PNG_1x1, { filename: `p${from + i}.png`, contentType: 'image/png' });
    return req;
  };

  it('une annonce accepte plus de 10 photos, envoyées par lots de 10 ; leur ordre suit l\'envoi', async () => {
    const user = await login(app);
    const listing = await createListing(app, user, { title: 'Buffet en chêne massif' });
    await upload(listing.id, user.auth, 10).expect(201);
    await upload(listing.id, user.auth, 10, 10).expect(201);
    const last = await upload(listing.id, user.auth, 3, 20).expect(201);
    expect(last.body).toHaveLength(3); // la réponse porte les photos de cet envoi
    const detail = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(detail.body.photos).toHaveLength(23);
    expect(detail.body.photos.map((p: any) => p.sortOrder)).toEqual([...Array(23).keys()]);
  });

  it('un seul envoi reste limité à 10 fichiers : au-delà, refus sans rien conserver', async () => {
    const user = await login(app);
    const listing = await createListing(app, user, { title: 'Lot de vinyles années 70' });
    const res = await upload(listing.id, user.auth, 11);
    expect(res.status).toBe(400);
    const detail = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(detail.body.photos).toHaveLength(0);
  });
});
