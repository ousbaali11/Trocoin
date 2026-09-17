import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createListing, login, TEST_ADDRESS } from './utils';

/**
 * Phase 36 (AUDIT §59) : la livraison est payée par l'acheteur avec son achat (tarif réel coté pour le colis de
 * l'annonce, le transporteur et le lieu de réception choisis) ; le vendeur ne paie rien : il confirme la
 * disponibilité, puis génère le bon d'envoi (PDF, pour lui seul) ; l'acheteur reçoit le numéro de suivi.
 */
describe("Phase 36 : frais de livraison payés par l'acheteur, bon d'envoi généré par le vendeur", () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  const sender = { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', phone: '06 11 22 33 44' };
  const options = (auth: Record<string, string>, listingId: string) => request(server).get(`/shipping/pickup-options?listingId=${listingId}&postalCode=75017&city=Paris`).set(auth);

  it('options de réception : un prix réel par option ; annonce sans poids déclaré → envoi non proposé, achat avec envoi refusé', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 60, weightGrams: 900 });
    const res = await options(buyer.auth, listing.id).expect(200);
    const [colissimo, mondial] = res.body.carriers;
    expect(colissimo).toMatchObject({ carrier: 'colissimo', domicile: true, pointRelais: true, domicilePriceCents: 795, pickupPriceCents: 735 });
    expect(mondial).toMatchObject({ carrier: 'mondial_relay', domicile: false, pointRelais: true, pickupPriceCents: 549 });
    expect(mondial.domicilePriceCents).toBeUndefined();

    const noWeight = await createListing(app, seller, { price: 60, weightGrams: undefined });
    const none = await options(buyer.auth, noWeight.id).expect(200);
    expect(none.body.carriers).toEqual([]);
    expect(none.body.unavailableReason).toMatch(/n'a pas indiqué le poids du colis/);
    const refused = await request(server).post('/transactions').set(buyer.auth).send({ listingId: noWeight.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: TEST_ADDRESS }).expect(400);
    expect(refused.body.message).toMatch(/n'a pas indiqué le poids du colis/);
    // La remise en main propre reste possible
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: noWeight.id }).expect(201);
  });

  it('achat : frais de livraison ajoutés au total et figés ; total affiché sans la livraison → refus avec le nouveau devis ; adresse et point exigés ; le vendeur touche toujours prix − commission', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 100, weightGrams: 900, title: 'Platine vinyle Audio-Technica' });
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile' }).expect(400); // adresse
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'mondial_relay', deliveryMode: 'point_relais', shippingAddress: TEST_ADDRESS }).expect(400); // point de retrait
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'mondial_relay', deliveryMode: 'domicile', shippingAddress: TEST_ADDRESS }).expect(400); // mode non proposé par ce transporteur

    const stale = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: TEST_ADDRESS, expectedTotal: 105.5 }).expect(409);
    expect(stale.body).toMatchObject({ code: 'QUOTE_CHANGED', quote: { price: 100, buyerFee: 5.5, shippingFee: 7.95, buyerTotal: 113.45, sellerPayout: 92 } });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: TEST_ADDRESS, expectedTotal: 113.45 }).expect(201);
    const tx = created.body.transaction ?? created.body;
    expect(tx).toMatchObject({ amount: 100, commission: 8, buyerFee: 5.5, shippingFee: 7.95, shippingQuote: { priceCents: 795, mode: 'domicile', weightGrams: 900 } });
    const view = (await request(server).get(`/transactions/${tx.id}`).set(seller.auth).expect(200)).body;
    expect(view.quote).toMatchObject({ buyerTotal: 113.45, shippingFee: 7.95, sellerPayout: 92 });
  });

  it("bon d'envoi : après la confirmation de disponibilité, généré avec le mode, le colis, le destinataire et le point de la vente ; PDF au vendeur seul, numéro de suivi à l'acheteur", async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 45, weightGrams: 1800, title: 'Lot de 12 verres à pied' });
    const locker = (await options(buyer.auth, listing.id).expect(200)).body.carriers[1].points.find((p: any) => p.type === 'consigne');
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'mondial_relay', deliveryMode: 'point_relais', pickupPoint: locker, shippingAddress: { ...TEST_ADDRESS, phone: '06 12 34 56 78' } }).expect(201);
    const tx = created.body.transaction ?? created.body;
    expect(tx.shippingFee).toBe(6.99); // Mondial Relay en point de retrait, tranche 2 kg

    // Pas de bon d'envoi avant la confirmation de disponibilité ; l'acheteur ne peut pas le générer
    expect((await request(server).post(`/transactions/${tx.id}/shipment`).set(seller.auth).send({ sender }).expect(400)).body.message).toMatch(/Confirmez d'abord/);
    await request(server).post(`/transactions/${tx.id}/confirm-availability`).set(seller.auth).expect(200);
    await request(server).post(`/transactions/${tx.id}/shipment`).set(buyer.auth).send({ sender }).expect(403);
    // Le vendeur n'envoie que son adresse ; tout autre champ envoyé est ignoré au profit de la vente
    const label = await request(server).post(`/transactions/${tx.id}/shipment`).set(seller.auth).send({ sender, mode: 'domicile', parcel: { weightGrams: 25000 }, relayPointId: 'AUTRE' }).expect(201);
    expect(label.body).toMatchObject({ status: 'etiquette_prete', carrier: 'mondial_relay', mode: 'point_relais', relayPointId: locker.id, weightGrams: 1800, priceCents: 699 });
    expect(label.body.recipient).toMatchObject({ name: TEST_ADDRESS.name, postalCode: '75017' });
    const tracking = label.body.trackingNumber as string;

    // PDF : vendeur seul ; l'acheteur a le numéro de suivi (fiche d'expédition et conversation), jamais le PDF
    const pdf = await request(server).get(`/transactions/${tx.id}/shipment/label.pdf`).set(seller.auth).expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    await request(server).get(`/transactions/${tx.id}/shipment/label.pdf`).set(buyer.auth).expect(403);
    const buyerView = (await request(server).get(`/transactions/${tx.id}/shipment`).set(buyer.auth).expect(200)).body;
    expect(buyerView.trackingNumber).toBe(tracking);
    expect(JSON.stringify(buyerView)).not.toMatch(/labelPdf/);
    const conv = (await request(server).get('/conversations').set(buyer.auth).expect(200)).body[0];
    const detail = (await request(server).get(`/conversations/${conv.id}`).set(buyer.auth).expect(200)).body;
    expect(detail.messages.map((m: any) => m.systemEvent)).toEqual(['achat_confirme', 'disponibilite_confirmee', 'etiquette_generee']);
    expect(detail.messages[2].meta).toMatchObject({ trackingNumber: tracking, carrier: 'mondial_relay' });
    expect(detail.transaction).toMatchObject({ shippingPaid: true, shippingFee: 6.99, labelReady: true, trackingNumber: tracking });

    // Expédition confirmée sans ressaisie, réception, versement : le vendeur touche prix − commission, la livraison n'y entre pas
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({}).expect(201);
    await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(buyer.auth).expect(201);
    const done = (await request(server).get(`/conversations/${conv.id}`).set(seller.auth).expect(200)).body;
    expect(done.messages.find((m: any) => m.systemEvent === 'reception_confirmee').meta).toMatchObject({ payout: 41.4 }); // 45 − 8 %
  });

  it("annulation avant l'expédition : remboursement intégral, livraison comprise", async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 30, weightGrams: 400 });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: TEST_ADDRESS }).expect(201);
    const tx = created.body.transaction ?? created.body;
    expect(tx.shippingFee).toBe(6.45);
    await request(server).post(`/transactions/${tx.id}/confirm-availability`).set(seller.auth).expect(200);
    await request(server).post(`/transactions/${tx.id}/shipment`).set(seller.auth).send({ sender }).expect(201);
    const cancelled = await request(server).post(`/transactions/${tx.id}/cancel`).set(buyer.auth).expect(201);
    expect(cancelled.body.status).toBe('annulee');
    // Le remboursement du fournisseur porte sur le paiement entier (prix + protection + livraison) : un seul paiement, un seul remboursement
    expect((await request(server).get(`/transactions/${tx.id}`).set(buyer.auth).expect(200)).body.quote.buyerTotal).toBe(38.45);
  });
});
