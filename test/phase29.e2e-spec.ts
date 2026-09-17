import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login, makeAdmin } from './utils';

/**
 * Phase 29 (AUDIT §51) : commission vendeur et frais de protection acheteur réglables par l'admin.
 * Un changement ne vaut que pour les nouvelles transactions ; il est tracé (ancienne et nouvelle valeur).
 */
describe('Phase 29 : barème du paiement sécurisé configurable, non rétroactif, journalisé', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('barème par défaut : article à 10 € → acheteur 11,00 €, vendeur 9,20 €, Trocoin 1,80 € ; exposé publiquement', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 10 });
    const quote = (await request(server).get(`/transactions/quote?listingId=${listing.id}`).set(buyer.auth).expect(200)).body;
    expect(quote).toMatchObject({ eligible: true, price: 10, buyerFee: 1, buyerTotal: 11, commission: 0.8, sellerPayout: 9.2 });
    expect(quote.rates).toEqual({ commissionPercent: 8, buyerFeePercent: 5, buyerFeeFixed: 0.5, buyerFeeCap: 15 });
    const pub = (await request(server).get('/settings/public').expect(200)).body;
    expect(pub.fees).toEqual({ commissionPercent: 8, buyerFeePercent: 5, buyerFeeFixed: 0.5, buyerFeeCap: 15 });
  });

  it('changement par l\'admin : nouvelles transactions seulement, transaction existante intacte, total affiché protégé (409), journal avec ancienne et nouvelle valeur', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);
    const first = await createListing(app, seller, { price: 10 });
    const second = await createListing(app, seller, { price: 10 });

    // Vente conclue AVANT le changement : 8 % et 5 % + 0,50 €
    const before = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: first.id, expectedTotal: 11 }).expect(201)).body;
    expect(before.transaction).toMatchObject({ amount: 10, commission: 0.8, buyerFee: 1 });
    expect(before.transaction.feeRates).toEqual({ commissionPercent: 8, buyerFeePercent: 5, buyerFeeFixed: 0.5, buyerFeeCap: 15 });

    // L'acheteur a déjà sous les yeux le devis de la seconde annonce (11,00 €)…
    const shown = (await request(server).get(`/transactions/quote?listingId=${second.id}`).set(buyer.auth).expect(200)).body;
    expect(shown.buyerTotal).toBe(11);

    // … quand l'admin change le barème
    const patched = (await request(server).patch('/admin/settings').set(admin.auth).send({ commission_percent: 10, buyer_fee_percent: 6, buyer_fee_fixed_eur: 0.7 }).expect(200)).body;
    expect(patched.fees.rates).toEqual({ commissionPercent: 10, buyerFeePercent: 6, buyerFeeFixed: 0.7, buyerFeeCap: 15 });
    expect(patched.fees.lastChangedBy).toBe(admin.id);
    expect(patched.fees.lastChangedAt).toBeTruthy();

    // La transaction existante garde ses montants et son barème, y compris dans son devis détaillé
    const detail = (await request(server).get(`/transactions/${before.transaction.id}`).set(seller.auth).expect(200)).body;
    expect(detail).toMatchObject({ amount: 10, commission: 0.8, buyerFee: 1 });
    expect(detail.quote).toMatchObject({ price: 10, commission: 0.8, buyerFee: 1, buyerTotal: 11, sellerPayout: 9.2 });
    expect(detail.rates).toEqual({ commissionPercent: 8, buyerFeePercent: 5, buyerFeeFixed: 0.5, buyerFeeCap: 15 });

    // Le total déjà affiché (11,00 €) n'est plus le bon : refus, avec le nouveau devis, rien n'est créé
    const refused = await request(server).post('/transactions').set(buyer.auth).send({ listingId: second.id, expectedTotal: 11 }).expect(409);
    expect(refused.body.code).toBe('QUOTE_CHANGED');
    expect(refused.body.message).toMatch(/11,30 € au lieu de 11,00 €/);
    expect(refused.body.quote).toMatchObject({ buyerFee: 1.3, buyerTotal: 11.3, commission: 1, sellerPayout: 9 });
    const mine = (await request(server).get('/transactions/mine').set(buyer.auth).expect(200)).body;
    expect((mine.items ?? mine).filter((t: any) => t.listingId === second.id)).toHaveLength(0);

    // Nouveau devis puis achat au nouveau barème : 10 % et 6 % + 0,70 €
    const fresh = (await request(server).get(`/transactions/quote?listingId=${second.id}`).set(buyer.auth).expect(200)).body;
    expect(fresh).toMatchObject({ buyerFee: 1.3, buyerTotal: 11.3, commission: 1, sellerPayout: 9 });
    const after = (await request(server).post('/transactions').set(buyer.auth).send({ listingId: second.id, expectedTotal: fresh.buyerTotal }).expect(201)).body;
    expect(after.transaction).toMatchObject({ amount: 10, commission: 1, buyerFee: 1.3 });
    expect(after.transaction.feeRates).toMatchObject({ commissionPercent: 10, buyerFeePercent: 6, buyerFeeFixed: 0.7 });

    // Journal d'audit : qui, quoi, ancienne et nouvelle valeur
    const log = (await request(server).get('/admin/audit-log?action=settings.update').set(admin.auth).expect(200)).body;
    const entry = log.items.find((e: any) => JSON.stringify(e).includes('commission_percent'));
    expect(entry).toBeTruthy();
    expect(entry.adminId ?? entry.admin?.id).toBe(admin.id);
    const details = JSON.stringify(entry);
    expect(details).toContain('"commission_percent":{"from":8,"to":10}');
    expect(details).toContain('"buyer_fee_percent":{"from":5,"to":6}');
    expect(details).toContain('"buyer_fee_fixed_eur":{"from":0.5,"to":0.7}');

    // Remise au barème d'origine (tracée elle aussi)
    await request(server).patch('/admin/settings').set(admin.auth).send({ commission_percent: 8, buyer_fee_percent: 5, buyer_fee_fixed_eur: 0.5 }).expect(200);
  });

  it('garde-fous : valeurs hors bornes ou à plus de deux décimales refusées, réservé aux admins, plafond des frais respecté', async () => {
    const member = await login(app);
    const admin = await login(app);
    await makeAdmin(app, admin);
    await request(server).patch('/admin/settings').set(member.auth).send({ commission_percent: 1 }).expect(403);
    await request(server).patch('/admin/settings').set(admin.auth).send({ commission_percent: 45 }).expect(400);
    await request(server).patch('/admin/settings').set(admin.auth).send({ commission_percent: -1 }).expect(400);
    await request(server).patch('/admin/settings').set(admin.auth).send({ buyer_fee_percent: 5.555 }).expect(400);
    await request(server).patch('/admin/settings').set(admin.auth).send({ buyer_fee_fixed_eur: 25 }).expect(400);
    // Plafond : 5 % + 0,50 € de 1 000 € = 50,50 € → plafonné à 15 €
    const seller = await login(app);
    const big = await createListing(app, seller, { price: 1000 });
    const quote = (await request(server).get(`/transactions/quote?listingId=${big.id}`).set(member.auth).expect(200)).body;
    expect(quote).toMatchObject({ buyerFee: 15, buyerTotal: 1015, commission: 80, sellerPayout: 920 });
  });
});
