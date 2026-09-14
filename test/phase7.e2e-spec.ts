import { INestApplication } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { UPLOAD_DIR } from '../src/common/upload/image-upload';
import { createApp, createListing, login, nextPhone } from './utils';

/**
 * Phase 7 : traitement des images (redimensionnement ≤ 1600 px, purge EXIF/GPS),
 * changement de mot de passe depuis les paramètres.
 */
describe('Phase 7 : images retraitées, changement de mot de passe', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('une photo 3000 px avec EXIF (orientation, GPS) est réduite à 1600 px, réorientée et débarrassée de ses métadonnées', async () => {
    const user = await login(app);
    const listing = await createListing(app, user);
    // JPEG 3000×2000 « tourné » (orientation 6 = 90° horaire) avec des données GPS
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'test', Copyright: 'x' }, GPS: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 45/1 0/1' } } as any })
      .toBuffer();
    const inMeta = await sharp(big).metadata();
    expect(inMeta.orientation).toBe(6);
    expect(inMeta.exif).toBeDefined();
    expect(big.length).toBeGreaterThan(20_000);

    const res = await request(server).post(`/listings/${listing.id}/photos`).set(user.auth).attach('files', big, { filename: 'grande.jpg', contentType: 'image/jpeg' }).expect(201);
    const url: string = res.body[0].url;
    expect(url).toMatch(/\.jpg$/);
    const stored = await fs.readFile(join(UPLOAD_DIR, url.replace('/uploads/', '')));
    const out = await sharp(stored).metadata();
    // Orientation appliquée (image devenue verticale) puis supprimée ; plus grand côté 1600
    expect(out.width).toBe(1067);
    expect(out.height).toBe(1600);
    expect(out.orientation).toBeUndefined();
    expect(out.exif).toBeUndefined();
    expect(out.icc).toBeUndefined();
    expect(stored.length).toBeLessThan(big.length);
    // (le service statique /uploads est monté dans main.ts, hors du module de test : lecture directe sur disque ci-dessus)
  });

  it('un fichier corrompu qui commence comme un JPEG est rejeté sans rien conserver', async () => {
    const user = await login(app);
    const listing = await createListing(app, user);
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000, 7)]);
    const res = await request(server).post(`/listings/${listing.id}/photos`).set(user.auth).attach('files', fake, { filename: 'faux.jpg', contentType: 'image/jpeg' }).expect(400);
    expect(res.body.message).toMatch(/illisible|corrompue/);
    const detail = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(detail.body.photos).toHaveLength(0);
  });

  it('changement de mot de passe : ancien requis, confirmation, nouveau différent, autres sessions révoquées', async () => {
    const tag = `${String(Date.now()).slice(-6)}`;
    const dto = { accountType: 'particulier', firstName: 'Paul', lastName: 'Roux', username: `paul_${tag}`, email: `paul.${tag}@example.org`, phoneNumber: nextPhone(), password: 'AncienMdp!2026', passwordConfirmation: 'AncienMdp!2026' };
    const created = await request(server).post('/auth/register').send(dto).expect(201);
    const auth = { Authorization: `Bearer ${created.body.accessToken}` };
    const other = await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(200);

    const bad = await request(server).post('/auth/password/change').set(auth).send({ currentPassword: 'faux', newPassword: 'NouveauMdp!2026', newPasswordConfirmation: 'NouveauMdp!2026' }).expect(400);
    expect(bad.body.message).toBe('Mot de passe actuel incorrect.');
    await request(server).post('/auth/password/change').set(auth).send({ currentPassword: dto.password, newPassword: 'NouveauMdp!2026', newPasswordConfirmation: 'autre' }).expect(400);
    await request(server).post('/auth/password/change').set(auth).send({ currentPassword: dto.password, newPassword: dto.password, newPasswordConfirmation: dto.password }).expect(400);
    await request(server).post('/auth/password/change').send({ currentPassword: dto.password, newPassword: 'NouveauMdp!2026', newPasswordConfirmation: 'NouveauMdp!2026' }).expect(401);

    await request(server).post('/auth/password/change').set(auth).send({ currentPassword: dto.password, newPassword: 'NouveauMdp!2026', newPasswordConfirmation: 'NouveauMdp!2026' }).expect(200);
    await request(server).post('/auth/login').send({ identifier: dto.email, password: dto.password }).expect(401);
    await request(server).post('/auth/login').send({ identifier: dto.email, password: 'NouveauMdp!2026' }).expect(200);
    // L'autre session ne peut plus se rafraîchir
    await request(server).post('/auth/refresh').send({ refreshToken: other.body.refreshToken }).expect(401);

    // Compte OTP sans mot de passe : message d'orientation
    const legacy = await login(app);
    const noPw = await request(server).post('/auth/password/change').set(legacy.auth).send({ currentPassword: 'x', newPassword: 'NouveauMdp!2026', newPasswordConfirmation: 'NouveauMdp!2026' }).expect(400);
    expect(noPw.body.message).toMatch(/Mot de passe oublié/);
  });
});
