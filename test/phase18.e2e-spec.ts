import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buyShipped, createApp, createListing, login, TestUser } from './utils';

/**
 * Étiquettes transporteur, phase 1 (mode simulation, SHIPPING_PROVIDER=mock) :
 * cotation par poids, étiquette PDF + numéro de suivi, droits vendeur / acheteur / tiers,
 * échec du prestataire sans blocage de la transaction, suivi côté acheteur, expédition
 * confirmée sans ressaisir le numéro.
 */
describe('Étiquettes transporteur (simulation)', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());
  afterEach(() => {
    delete process.env.SHIPPING_MOCK_FAIL;
  });

  const sender = { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', phone: '0612345678' };
  const recipient = { name: 'Alex Acheteur', line1: '5 avenue des Ternes', line2: 'Bât. B', postalCode: '75017', city: 'Paris' };

  async function paidSale(deliveryMethod: 'colissimo' | 'mondial_relay' | 'main_propre' = 'colissimo') {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 120, deliveryAvailable: true, title: 'Enceinte Bluetooth JBL Flip 6' });
    // Parcours d'étiquette d'origine : vente antérieure au paiement de la livraison par l'acheteur (AUDIT §59)
    const created = { body: deliveryMethod === 'main_propre' ? (await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod }).expect(201)).body : await buyShipped(app, buyer, listing.id, deliveryMethod, { legacy: true }) };
    const tx = created.body.transaction ?? created.body;
    expect(tx.status).toBe('sequestre');
    return { seller, buyer, listing, txId: tx.id as string };
  }

  it('cotation : tarifs par tranche de poids pour le transporteur choisi à l\'achat, mode relais et domicile', async () => {
    const { seller, buyer, txId } = await paidSale('colissimo');
    const light = await request(server).post(`/transactions/${txId}/shipment/quote`).set(seller.auth).send({ parcel: { weightGrams: 400 }, fromPostalCode: '69003', toPostalCode: '75017' }).expect(200);
    expect(light.body.carrier).toBe('colissimo');
    expect(light.body.rates.map((r: any) => r.mode).sort()).toEqual(['domicile', 'point_relais']);
    const heavy = await request(server).post(`/transactions/${txId}/shipment/quote`).set(seller.auth).send({ parcel: { weightGrams: 4500 }, fromPostalCode: '69003', toPostalCode: '75017' }).expect(200);
    const price = (b: any, mode: string) => b.rates.find((r: any) => r.mode === mode).priceCents;
    expect(price(heavy.body, 'domicile')).toBeGreaterThan(price(light.body, 'domicile'));
    expect(price(light.body, 'point_relais')).toBeLessThan(price(light.body, 'domicile'));
    // Poids invalide, acheteur, tiers
    await request(server).post(`/transactions/${txId}/shipment/quote`).set(seller.auth).send({ parcel: { weightGrams: 40000 } }).expect(400);
    await request(server).post(`/transactions/${txId}/shipment/quote`).set(buyer.auth).send({ parcel: { weightGrams: 400 } }).expect(403);
    await request(server).post(`/transactions/${txId}/shipment/quote`).send({ parcel: { weightGrams: 400 } }).expect(401);
    // Points relais autour d'un code postal
    const points = await request(server).get(`/transactions/${txId}/shipment/relay-points?postalCode=75017`).set(seller.auth).expect(200);
    expect(points.body.length).toBeGreaterThanOrEqual(3);
    expect(points.body[0]).toMatchObject({ postalCode: '75017' });
  });

  it('étiquette : PDF téléchargeable par le vendeur seul, numéro de suivi visible des deux, expédition confirmée sans ressaisie', async () => {
    const { seller, buyer, txId } = await paidSale('mondial_relay');
    const points = await request(server).get(`/transactions/${txId}/shipment/relay-points?postalCode=75017`).set(seller.auth).expect(200);
    await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'point_relais', parcel: { weightGrams: 900 }, sender, recipient }).expect(400); // point relais manquant
    const created = await request(server)
      .post(`/transactions/${txId}/shipment`)
      .set(seller.auth)
      .send({ mode: 'point_relais', parcel: { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 15 }, sender, recipient, relayPointId: points.body[1].id })
      .expect(201);
    expect(created.body.status).toBe('etiquette_prete');
    expect(created.body.trackingNumber).toMatch(/^SIM\d{10}$/);
    expect(created.body.trackingUrl).toContain('mondialrelay');
    expect(created.body.priceCents).toBe(549);
    expect(created.body.labelAvailable).toBe(true);
    expect(created.body.labelPdfBase64).toBeUndefined();

    // Une seule étiquette par vente
    await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 900 }, sender, recipient }).expect(409);

    // Le PDF : vendeur oui, acheteur non, tiers non
    const pdf = await request(server).get(`/transactions/${txId}/shipment/label.pdf`).set(seller.auth).expect(200).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('etiquette-');
    const bytes = pdf.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString('latin1')).toContain('SIMULATION');
    expect(bytes.toString('latin1')).toContain(created.body.trackingNumber);
    expect(bytes.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    await request(server).get(`/transactions/${txId}/shipment/label.pdf`).set(buyer.auth).expect(403);
    const stranger = await login(app);
    await request(server).get(`/transactions/${txId}/shipment/label.pdf`).set(stranger.auth).expect(403);
    await request(server).get(`/transactions/${txId}/shipment`).set(stranger.auth).expect(403);

    // L'acheteur voit l'expédition et le suivi, sans le PDF ni le numéro de téléphone inutile
    const asBuyer = await request(server).get(`/transactions/${txId}/shipment`).set(buyer.auth).expect(200);
    expect(asBuyer.body.trackingNumber).toBe(created.body.trackingNumber);
    expect(asBuyer.body.mode).toBe('point_relais');
    expect(asBuyer.body.labelPdfBase64).toBeUndefined();
    const tracking = await request(server).get(`/transactions/${txId}/shipment/tracking`).set(buyer.auth).expect(200);
    expect(tracking.body.state).toBe('etiquette_creee');
    expect(tracking.body.events[0].label).toBe('Étiquette créée');

    // La transaction porte déjà le numéro : « Confirmer l'expédition » sans saisie
    const tx = await request(server).get(`/transactions/${txId}`).set(seller.auth).expect(200);
    expect(tx.body.deliveryTrackingNumber).toBe(created.body.trackingNumber);
    const shipped = await request(server).post(`/transactions/${txId}/ship`).set(seller.auth).send({}).expect(201);
    expect(shipped.body.status).toBe('livree');
    expect(shipped.body.deliveryTrackingNumber).toBe(created.body.trackingNumber);
    const after = await request(server).get(`/transactions/${txId}/shipment`).set(buyer.auth).expect(200);
    expect(after.body.status).toBe('expediee');
    // Plus d'étiquette possible une fois expédié
    await request(server).post(`/transactions/${txId}/shipment/quote`).set(seller.auth).send({ parcel: { weightGrams: 900 } }).expect(400);
  });

  it('échec du prestataire : expédition en « echec » avec la raison, transaction intacte, nouvel essai possible, saisie manuelle toujours acceptée', async () => {
    const { seller, buyer, txId } = await paidSale('colissimo');
    process.env.SHIPPING_MOCK_FAIL = 'etiquette';
    const failed = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 1500 }, sender, recipient }).expect(502);
    expect(failed.body.code).toBe('transporteur_indisponible');
    expect(failed.body.message).toContain('panne simulée');
    const view = await request(server).get(`/transactions/${txId}/shipment`).set(seller.auth).expect(200);
    expect(view.body.status).toBe('echec');
    expect(view.body.error).toContain('transporteur_indisponible');
    expect(view.body.labelAvailable).toBe(false);
    const tx = await request(server).get(`/transactions/${txId}`).set(buyer.auth).expect(200);
    expect(tx.body.status).toBe('sequestre');
    expect(tx.body.deliveryTrackingNumber).toBeNull();
    await request(server).get(`/transactions/${txId}/shipment/tracking`).set(buyer.auth).expect(404);

    // Adresse refusée par le transporteur : 400 avec le code, même expédition mise à jour
    delete process.env.SHIPPING_MOCK_FAIL;
    const bad = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 1500 }, sender, recipient: { ...recipient, postalCode: '99999' } }).expect(400);
    expect(bad.body.code).toBe('adresse_invalide');

    // Nouvel essai réussi après correction : même ligne d'expédition, plus d'erreur
    const ok = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 1500 }, sender, recipient }).expect(201);
    expect(ok.body.id).toBe(view.body.id);
    expect(ok.body.status).toBe('etiquette_prete');
    expect(ok.body.error).toBeNull();
    expect(ok.body.priceCents).toBe(895);
    expect(ok.body.trackingUrl).toContain('laposte.fr');
  });

  it('remise en main propre : pas d\'étiquette ; saisie manuelle d\'un numéro : suivi minimal pour l\'acheteur', async () => {
    const hand = await paidSale('main_propre');
    await request(server).post(`/transactions/${hand.txId}/shipment/quote`).set(hand.seller.auth).send({ parcel: { weightGrams: 500 } }).expect(400);
    const none = await request(server).get(`/transactions/${hand.txId}/shipment`).set(hand.buyer.auth).expect(200); // pas d'étiquette : réponse vide, pas une erreur (audit §42)
    expect(none.body).toEqual({});

    const manual = await paidSale('colissimo');
    await request(server).post(`/transactions/${manual.txId}/ship`).set(manual.seller.auth).send({ trackingNumber: '6A12345678901' }).expect(201);
    const tracking = await request(server).get(`/transactions/${manual.txId}/shipment/tracking`).set(manual.buyer.auth).expect(200);
    expect(tracking.body).toMatchObject({ trackingNumber: '6A12345678901', state: 'pris_en_charge', events: [] });
  });
});

// Évite l'avertissement « unused » si TestUser n'est pas référencé directement
export type _T = TestUser;
