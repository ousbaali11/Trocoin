import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { EmailService } from '../src/email/email.service';
import { CANONICAL_SITE_URL, resolveCorsOrigins, resolveSiteUrl, validateEnv } from '../src/config/env.validation';
import { createApp } from './utils';

/**
 * Bascule vers trocoin.fr : origines CORS de production intégrées, URL publique canonique pour les
 * liens des e-mails (même si SITE_URL pointe encore vers un ancien hébergeur), exposée par /health.
 */
describe('Domaine trocoin.fr', () => {
  const prod = { NODE_ENV: 'production' } as Record<string, unknown>;

  it('CORS en production : trocoin.fr et www.trocoin.fr toujours autorisés, CORS_ORIGINS conservée en plus', () => {
    expect(resolveCorsOrigins({ ...prod })).toEqual(['https://www.trocoin.fr', 'https://trocoin.fr']);
    expect(resolveCorsOrigins({ ...prod, CORS_ORIGINS: 'https://trocoin.vercel.app/, https://www.trocoin.fr' })).toEqual([
      'https://www.trocoin.fr',
      'https://trocoin.fr',
      'https://trocoin.vercel.app',
    ]);
    // En dev, rien n'est ajouté
    expect(resolveCorsOrigins({ NODE_ENV: 'development', CORS_ORIGINS: 'http://localhost:3011' })).toEqual(['http://localhost:3011']);
  });

  it("URL du site en production : canonique si SITE_URL est absente ou sur vercel.app / onrender.com, respectée sinon", () => {
    expect(resolveSiteUrl({ ...prod })).toBe(CANONICAL_SITE_URL);
    expect(resolveSiteUrl({ ...prod, SITE_URL: 'https://trocoin.vercel.app' })).toBe(CANONICAL_SITE_URL);
    expect(resolveSiteUrl({ ...prod, SITE_URL: 'https://trocoin.onrender.com/' })).toBe(CANONICAL_SITE_URL);
    expect(resolveSiteUrl({ ...prod, SITE_URL: 'pas une url' })).toBe(CANONICAL_SITE_URL);
    expect(resolveSiteUrl({ ...prod, SITE_URL: 'https://www.trocoin.fr/' })).toBe('https://www.trocoin.fr');
    expect(resolveSiteUrl({ ...prod, SITE_URL: 'https://staging.trocoin.fr' })).toBe('https://staging.trocoin.fr');
    // En dev : SITE_URL puis première origine CORS
    expect(resolveSiteUrl({ NODE_ENV: 'development', SITE_URL: 'http://localhost:3011/' })).toBe('http://localhost:3011');
    expect(resolveSiteUrl({ NODE_ENV: 'development', CORS_ORIGINS: 'http://localhost:3011' })).toBe('http://localhost:3011');
  });

  it('SHIPPING_PROVIDER=boxtal : accepté, les quatre identifiants sont exigés au démarrage, BOXTAL_ENV contrôlée', () => {
    const base = { NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40) };
    const full = { ...base, SHIPPING_PROVIDER: 'boxtal', BOXTAL_V3_ACCESS_KEY: 'ak', BOXTAL_V3_SECRET_KEY: 'sk', BOXTAL_V1_LOGIN: 'login', BOXTAL_V1_PASSWORD: 'pw' };
    expect(() => validateEnv(full)).not.toThrow();
    expect(() => validateEnv({ ...full, BOXTAL_ENV: 'production' })).not.toThrow();
    expect(() => validateEnv({ ...full, BOXTAL_ENV: 'staging' })).toThrow(/BOXTAL_ENV/);
    const { BOXTAL_V3_SECRET_KEY, BOXTAL_V1_PASSWORD, ...partial } = full;
    void BOXTAL_V3_SECRET_KEY;
    void BOXTAL_V1_PASSWORD;
    expect(() => validateEnv(partial)).toThrow(/BOXTAL_V3_SECRET_KEY, BOXTAL_V1_PASSWORD/);
    expect(() => validateEnv({ ...base, SHIPPING_PROVIDER: 'colissimo' })).toThrow(/mock, none ou boxtal/);
  });

  it("les liens des e-mails suivent la même règle que /health : SITE_URL sur vercel.app en production → domaine canonique", () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, SITE_URL: process.env.SITE_URL };
    try {
      process.env.NODE_ENV = 'production';
      process.env.SITE_URL = 'https://trocoin.vercel.app';
      const email = new EmailService(new ConfigService({ SITE_URL: 'https://trocoin.vercel.app', EMAIL_PROVIDER: 'none' }));
      expect(email.siteUrl()).toBe(CANONICAL_SITE_URL);
      expect(email.siteUrl()).toBe(resolveSiteUrl());
    } finally {
      process.env.NODE_ENV = saved.NODE_ENV;
      if (saved.SITE_URL === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = saved.SITE_URL;
    }
  });

  describe('/health', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp();
    });
    afterAll(() => app.close());

    it('expose la base des liens e-mail (siteUrl) sans rien de sensible', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.siteUrl).toBe(resolveSiteUrl());
      expect(res.body.siteUrl).toMatch(/^https?:\/\//);
      // Aucune clé de configuration (origines, secrets, hôte de base) : seulement l'état, la version et la base des liens
      expect(Object.keys(res.body).filter((k) => k !== 'databaseRegion').sort()).toEqual(['database', 'siteUrl', 'status', 'uptimeSeconds', 'version'].sort());
    });
  });
});
