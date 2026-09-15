import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CANONICAL_SITE_URL, resolveCorsOrigins, resolveSiteUrl } from '../src/config/env.validation';
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
