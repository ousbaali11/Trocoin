import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login } from './utils';
import { estimateShipping } from '../src/shipping/indicative-rates';

/**
 * Phase 30 (AUDIT §52) : informations de livraison exposées par la fiche, base des données structurées
 * `shippingDetails` — délais réels, coût estimé seulement si le vendeur a déclaré le poids du colis.
 */
describe('Phase 30 : livraison déclarée sur la fiche (données structurées sans valeur inventée)', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('estimation : fourchette de la grille pour le poids déclaré, rien sans poids ni au-delà de 30 kg', () => {
    expect(estimateShipping(800)).toEqual({ minCents: 549, maxCents: 795, weightGrams: 800 });
    expect(estimateShipping(200)).toEqual({ minCents: 445, maxCents: 495, weightGrams: 200 });
    expect(estimateShipping(undefined)).toBeNull();
    expect(estimateShipping(0)).toBeNull();
    expect(estimateShipping(30001)).toBeNull();
  });

  it('fiche : main propre seule → pas de livraison ; livrable avec poids → délais et fourchette ; livrable sans poids → délais sans coût', async () => {
    const seller = await login(app);
    const handOnly = await createListing(app, seller, { price: 40, deliveryAvailable: false });
    const withWeight = await createListing(app, seller, { price: 40, deliveryAvailable: true, weightGrams: 800 });
    const noWeight = await createListing(app, seller, { price: 40, deliveryAvailable: true });

    const a = (await request(server).get(`/listings/${handOnly.id}`).expect(200)).body;
    expect(a.delivery).toEqual({ available: false, shipWithinDays: 7, transitDaysMin: 2, transitDaysMax: 4, estimate: null });

    const b = (await request(server).get(`/listings/${withWeight.id}`).expect(200)).body;
    expect(b.delivery).toEqual({ available: true, shipWithinDays: 7, transitDaysMin: 2, transitDaysMax: 4, estimate: { minCents: 549, maxCents: 795, weightGrams: 800 } });

    const c = (await request(server).get(`/listings/${noWeight.id}`).expect(200)).body;
    expect(c.delivery).toEqual({ available: true, shipWithinDays: 7, transitDaysMin: 2, transitDaysMax: 4, estimate: null });
  });
});
