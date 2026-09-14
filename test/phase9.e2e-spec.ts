import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import sharp from 'sharp';
import request from 'supertest';
import { RedisThrottlerStorage } from '../src/common/throttler/redis-throttler.storage';
import { LocalDiskStorage, S3Storage, setStorageForTests } from '../src/common/upload/storage.service';
import { SiretVerificationService } from '../src/users/siret-verification.service';
import { createApp, createListing, login, nextPhone, PNG_1x1 } from './utils';

/**
 * Phase 9 : stockage objet S3/R2 (faux serveur S3 en mémoire), vérification
 * SIRET au registre (mode mock + client HTTP simulé), rate limiting Redis
 * (ioredis-mock).
 */
describe('Phase 9 : stockage S3, SIRET vérifié au registre, Redis pour le rate limiting', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => {
    setStorageForTests(null);
    return app.close();
  });

  describe('stockage S3 compatible (faux serveur en mémoire)', () => {
    let s3: Server;
    let endpoint: string;
    const objects = new Map<string, { body: Buffer; contentType: string }>();
    const log: string[] = [];

    beforeAll(async () => {
      s3 = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const key = decodeURIComponent((req.url || '').split('?')[0]);
          log.push(`${req.method} ${key}`);
          if (req.method === 'PUT') {
            objects.set(key, { body: Buffer.concat(chunks), contentType: String(req.headers['content-type']) });
            res.writeHead(200, { ETag: '"abc"' });
            return res.end();
          }
          if (req.method === 'DELETE') {
            objects.delete(key);
            res.writeHead(204);
            return res.end();
          }
          if (req.method === 'GET' && objects.has(key)) {
            res.writeHead(200, { 'content-type': objects.get(key)!.contentType });
            return res.end(objects.get(key)!.body);
          }
          res.writeHead(404);
          res.end();
        });
      });
      await new Promise<void>((r) => s3.listen(0, '127.0.0.1', r));
      endpoint = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
      setStorageForTests(new S3Storage({ endpoint, region: 'auto', bucket: 'trocoin-test', accessKeyId: 'k', secretAccessKey: 's', publicUrl: 'https://cdn.example.test', forcePathStyle: true }));
    });
    afterAll(async () => {
      setStorageForTests(new LocalDiskStorage());
      await new Promise<void>((r) => s3.close(() => r()));
    });

    it('une photo est ré-encodée puis envoyée dans le bucket ; son URL publique pointe vers le CDN ; la suppression retire l\'objet', async () => {
      const user = await login(app);
      const listing = await createListing(app, user);
      const res = await request(server).post(`/listings/${listing.id}/photos`).set(user.auth).attach('files', PNG_1x1, { filename: 'p.png', contentType: 'image/png' }).expect(201);
      const url: string = res.body[0].url;
      expect(url).toMatch(/^https:\/\/cdn\.example\.test\/uploads\/[0-9a-f-]{36}\.png$/);
      const key = '/trocoin-test/' + url.replace('https://cdn.example.test/', '');
      expect(log).toContain(`PUT ${key}`);
      const stored = objects.get(key)!;
      expect(stored.contentType).toBe('image/png');
      expect((await sharp(stored.body).metadata()).format).toBe('png');
      // L'annonce publique expose l'URL absolue, le détail aussi
      const detail = await request(server).get(`/listings/${listing.id}`).expect(200);
      expect(detail.body.photos[0].url).toBe(url);
      // Suppression → DELETE sur le bucket
      await request(server).delete(`/listings/${listing.id}/photos/${res.body[0].id}`).set(user.auth).expect(204);
      expect(log).toContain(`DELETE ${key}`);
      expect(objects.has(key)).toBe(false);
    });

    it('un fichier corrompu n\'est jamais envoyé au bucket', async () => {
      const user = await login(app);
      const listing = await createListing(app, user);
      const before = log.filter((l) => l.startsWith('PUT')).length;
      const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 9)]);
      await request(server).post(`/listings/${listing.id}/photos`).set(user.auth).attach('files', fake, { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(400);
      expect(log.filter((l) => l.startsWith('PUT')).length).toBe(before);
    });
  });

  describe('SIRET vérifié au registre des entreprises', () => {
    const base = () => {
      const tag = `${String(Date.now()).slice(-5)}${Math.floor(Math.random() * 1000)}`;
      return { accountType: 'professionnel', firstName: 'Léa', lastName: 'Pro', username: `pro_${tag}`, email: `pro.${tag}@example.org`, phoneNumber: nextPhone(), password: 'MotDePasse!42', passwordConfirmation: 'MotDePasse!42', companyName: 'Ma Société' };
    };

    it('SIRET actif → compte pro « SIRET vérifié » ; inconnu → refusé ; établissement fermé → refusé', async () => {
      const ok = await request(server).post('/auth/register').send({ ...base(), siret: '44306184100047' }).expect(201);
      const me = await request(server).get('/users/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
      expect(me.body.siretVerified).toBe(true);
      expect(me.body.siretVerifiedAt).toBeTruthy();

      const unknown = await request(server).post('/auth/register').send({ ...base(), siret: '88800012300008' }).expect(400);
      expect(unknown.body.message).toMatch(/introuvable dans le registre/);
      const closed = await request(server).post('/auth/register').send({ ...base(), siret: '99900012300003' }).expect(400);
      expect(closed.body.message).toMatch(/fermé/);
      // Clé de Luhn fausse : refusé avant même l'appel au registre
      const luhn = await request(server).post('/auth/register').send({ ...base(), siret: '44306184100048' }).expect(400);
      expect(luhn.body.message).toMatch(/clé de contrôle/);
    });

    it('registre indisponible → compte accepté mais SIRET marqué non vérifié (jamais bloquer sur une panne tierce)', async () => {
      process.env.SIRENE_MOCK_FAIL = 'true';
      try {
        const res = await request(server).post('/auth/register').send({ ...base(), siret: '73282932000074' }).expect(201);
        const me = await request(server).get('/users/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
        expect(me.body.siretVerified).toBe(false);
        expect(me.body.accountType).toBe('professionnel');
      } finally {
        delete process.env.SIRENE_MOCK_FAIL;
      }
    });

    it('client HTTP réel : la réponse du registre est interprétée (actif, fermé, inconnu, panne)', async () => {
      const config = { get: (k: string) => (k === 'SIRENE_PROVIDER' ? 'api' : undefined) } as unknown as ConfigService;
      const withBody = (status: number, body: unknown) => async () => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
      const svc = (f: (input: string, init: RequestInit) => Promise<Response>) => { const s = new SiretVerificationService(config); s.fetchImpl = f; return s; };
      const active = svc(withBody(200, { results: [{ nom_complet: 'GOOGLE FRANCE', siren: '443061841', etat_administratif: 'A', siege: { siret: '44306184100047', etat_administratif: 'A', libelle_commune: 'PARIS' } }] }));
      expect(await active.check('44306184100047')).toEqual({ status: 'verified', companyName: 'GOOGLE FRANCE', siren: '443061841', city: 'PARIS' });
      const closed = svc(withBody(200, { results: [{ nom_complet: 'X SAS', siren: '552081317', etat_administratif: 'A', siege: { siret: '55208131700011', etat_administratif: 'A' }, matching_etablissements: [{ siret: '55208131766522', etat_administratif: 'F' }] }] }));
      expect(await closed.check('55208131766522')).toEqual({ status: 'closed', companyName: 'X SAS' });
      const unknown = svc(withBody(200, { results: [] }));
      expect(await unknown.check('88800012300008')).toEqual({ status: 'unknown' });
      const down = svc(async () => { throw new Error('ECONNRESET'); });
      expect((await down.check('44306184100047')).status).toBe('unavailable');
      const http500 = svc(withBody(503, {}));
      expect((await http500.check('44306184100047')).status).toBe('unavailable');
    });
  });

  describe('rate limiting partagé via Redis (ioredis-mock)', () => {
    it('compte les appels, expire, et bloque au-delà de la limite', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RedisMock = require('ioredis-mock');
      const redis = new RedisMock();
      const storage = new RedisThrottlerStorage(redis);
      const r1 = await storage.increment('ip1', 60_000, 3, 30_000, 'default');
      const r2 = await storage.increment('ip1', 60_000, 3, 30_000, 'default');
      const r3 = await storage.increment('ip1', 60_000, 3, 30_000, 'default');
      expect([r1.totalHits, r2.totalHits, r3.totalHits]).toEqual([1, 2, 3]);
      expect(r3.isBlocked).toBe(false);
      expect(r3.timeToExpire).toBeGreaterThan(0);
      const r4 = await storage.increment('ip1', 60_000, 3, 30_000, 'default');
      expect(r4.isBlocked).toBe(true);
      expect(r4.timeToBlockExpire).toBeGreaterThan(0);
      // Une autre IP n'est pas affectée ; un autre throttler non plus
      expect((await storage.increment('ip2', 60_000, 3, 30_000, 'default')).totalHits).toBe(1);
      expect((await storage.increment('ip1', 60_000, 3, 30_000, 'otp')).totalHits).toBe(1);
      // Redis en panne : on laisse passer (journalisé), pas de 500
      const broken = new RedisThrottlerStorage({ eval: async () => { throw new Error('ECONNREFUSED'); } } as any);
      expect((await broken.increment('ip3', 60_000, 3, 30_000, 'default')).isBlocked).toBe(false);
      redis.disconnect();
    });
  });
});
