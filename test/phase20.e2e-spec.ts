import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import request from 'supertest';
import { AddressInfo } from 'net';
import { BoxtalShippingProvider } from '../src/shipping/boxtal-shipping.provider';
import { ShippingProviderError } from '../src/shipping/shipping-provider.interface';
import { createApp, createListing, login } from './utils';

/**
 * Étiquettes transporteur, phase 2 :
 *  - BoxtalShippingProvider contre un faux Boxtal (v1 XML + v3 JSON) : jeton, cotation, points relais,
 *    étiquette (commande → documents → PDF → suivi), erreurs typées (identifiants refusés, adresse
 *    refusée, indisponibilité) ;
 *  - adresse de livraison de l'acheteur au paiement (vue des deux parties, ignorée en main propre) ;
 *  - colis déclaré au dépôt (poids et dimensions, facultatifs, bornés).
 */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

function fakeBoxtal() {
  const calls: Array<{ method: string; url: string; auth?: string; body: string }> = [];
  const state = { failToken: false, failV1Auth: false, rejectAddress: false, down: false };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method || '', url: req.url || '', auth: req.headers.authorization, body });
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const url = req.url || '';
      if (state.down) return json(503, { message: 'maintenance' });
      if (url === '/iam/account-app/token') {
        if (state.failToken || req.headers.authorization !== `Basic ${Buffer.from('AK:SK').toString('base64')}`) return json(401, { message: 'invalid credentials' });
        return json(200, { accessToken: 'tok-123', expiresIn: 600 });
      }
      if (url.startsWith('/api/v1/cotation?')) {
        if (state.failV1Auth || !(req.headers.authorization || '').includes(Buffer.from('login:pw').toString('base64'))) return json(401, {});
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><cotation><shipment><offer><mode>PICKUP</mode><operator><code>MONR</code><label>Mondial Relay</label></operator><service><code>CpourToi</code><label>Point Relais</label></service><price><currency>EUR</currency><tax-exclusive>4.58</tax-exclusive><tax-inclusive>5.49</tax-inclusive></price><delivery><type><code>PICKUP_POINT</code><label>Point relais</label></type><date>2026-09-19</date></delivery></offer><offer><mode>HOME</mode><operator><code>POFR</code><label>Colissimo</label></operator><service><code>ColissimoAccess</code><label>Colissimo Domicile</label></service><price><currency>EUR</currency><tax-exclusive>7.42</tax-exclusive><tax-inclusive>8.90</tax-inclusive></price><delivery><type><code>HOME</code><label>Domicile</label></type><date>2026-09-18</date></delivery></offer><offer><mode>PICKUP</mode><operator><code>POFR</code><label>Colissimo</label></operator><service><code>ColissimoPickup</code><label>Colissimo Point Retrait</label></service><price><currency>EUR</currency><tax-inclusive>7.35</tax-inclusive></price><delivery><type><code>PICKUP_POINT</code><label>Point retrait</label></type></delivery></offer></shipment></cotation>`);
      }
      if (req.headers.authorization !== 'Bearer tok-123') return json(401, { message: 'no token' });
      if (url.startsWith('/shipping/v3.1/parcel-point?')) {
        return json(200, { content: [{ parcelPoint: { code: 'MR-001', name: 'Boulangerie Martin', network: { code: 'MONR' }, location: { number: '7', street: 'rue de la République', postalCode: '75017', city: 'Paris' } }, distanceFromSearchLocation: 300 }, { parcelPoint: { code: 'PU-002', name: 'Bureau de poste', network: { code: 'POFR' }, location: { street: 'avenue des Ternes', postalCode: '75017', city: 'Paris' } }, distanceFromSearchLocation: 900 }] });
      }
      if (req.method === 'POST' && url === '/shipping/v3.1/shipping-order') {
        const parsed = JSON.parse(body || '{}');
        if (state.rejectAddress || parsed.shipment?.toAddress?.location?.postalCode === '99999') return json(400, { errors: [{ code: 'INVALID_ADDRESS', message: 'recipient address not found' }] });
        return json(201, { id: 'ord-42', status: 'REQUESTED', deliveryPriceExclTax: { value: 4.58, currency: 'EUR' } });
      }
      if (url === '/shipping/v3.1/shipping-order/ord-42/shipping-document') return json(200, { content: [{ type: 'LABEL', format: 'PDF_10x15', url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/label.pdf` }] });
      if (url === '/label.pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        return res.end(PDF);
      }
      if (url === '/shipping/v3.1/shipping-order/ord-42/tracking') return json(200, { content: [{ status: 'ANNOUNCED', trackingNumber: 'MR123456789', packageTrackingUrl: 'https://suivi.example/MR123456789', history: [{ status: 'ANNOUNCED', message: 'Étiquette créée', trackingDateTime: '2026-09-16T10:00:00Z' }] }] });
      if (req.method === 'DELETE' && url === '/shipping/v3.1/shipping-order/ord-42') return json(204, {});
      json(404, { errors: [{ code: 'NOT_FOUND' }] });
    });
  });
  return { server, calls, state };
}

describe('Boxtal (faux serveur) : cotation v1, étiquette v3, erreurs', () => {
  const fake = fakeBoxtal();
  let provider: BoxtalShippingProvider;
  beforeAll(async () => {
    await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
    provider = new BoxtalShippingProvider(new ConfigService({ BOXTAL_ENV: 'sandbox', BOXTAL_V3_API_URL: base, BOXTAL_V1_API_URL: base, BOXTAL_V3_ACCESS_KEY: 'AK', BOXTAL_V3_SECRET_KEY: 'SK', BOXTAL_V1_LOGIN: 'login', BOXTAL_V1_PASSWORD: 'pw', BOXTAL_OFFER_MONDIAL_RELAY_RELAIS: 'MONR-RELAIS' }));
  });
  afterAll(() => new Promise<void>((r) => fake.server.close(() => r())));
  beforeEach(() => {
    Object.assign(fake.state, { failToken: false, failV1Auth: false, rejectAddress: false, down: false });
    fake.calls.length = 0;
  });

  it('cotation : offres du transporteur demandé, une par mode, prix TTC en centimes, code d\'offre configuré ou dérivé', async () => {
    const colissimo = await provider.quote({ carrier: 'colissimo', parcel: { weightGrams: 900 }, fromPostalCode: '69003', toPostalCode: '75017', fromCity: 'Lyon', toCity: 'Paris' });
    expect(colissimo.map((r) => [r.mode, r.priceCents, r.offerCode])).toEqual([
      ['point_relais', 735, 'POFR_ColissimoPickup'],
      ['domicile', 890, 'POFR_ColissimoAccess'],
    ]);
    const mr = await provider.quote({ carrier: 'mondial_relay', parcel: { weightGrams: 900 }, fromPostalCode: '69003', toPostalCode: '75017' });
    expect(mr).toEqual([expect.objectContaining({ mode: 'point_relais', priceCents: 549, offerCode: 'MONR-RELAIS', label: 'Mondial Relay Point Relais' })]);
    const call = fake.calls.find((c) => c.url.startsWith('/api/v1/cotation?'))!;
    expect(call.method).toBe('GET');
    expect(call.url).toContain('colis_1.poids=0.9');
    expect(call.url).toContain('recipient.code_postal=75017');
    expect(call.url).toContain('shipper.ville=Lyon');
  });

  it('points relais : filtrés sur le réseau du transporteur, adresse lisible', async () => {
    const pts = await provider.searchRelayPoints('mondial_relay', '75017', 'Paris');
    expect(pts).toEqual([expect.objectContaining({ id: 'MR-001', name: 'Boulangerie Martin', line1: '7 rue de la République', postalCode: '75017', city: 'Paris', distanceMeters: 300 })]);
    expect(fake.calls.find((c) => c.url.startsWith('/shipping/v3.1/parcel-point'))!.url).toContain('postalCode=75017&city=Paris');
  });

  it('étiquette : jeton, commande, document PDF téléchargé, numéro de suivi et référence ; suivi et annulation', async () => {
    const label = await provider.createLabel({
      carrier: 'mondial_relay',
      mode: 'point_relais',
      offerCode: 'MONR-RELAIS',
      parcel: { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 },
      sender: { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', country: 'FR', phone: '0612345678', email: 'v@e2e.test' },
      recipient: { name: 'Alex Acheteur', line1: '5 avenue des Ternes', line2: 'Bât. B', postalCode: '75017', city: 'Paris', country: 'FR', phone: '0687654321', email: 'a@e2e.test' },
      relayPointId: 'MR-001',
      reference: 'tx-1',
      contentDescription: 'Enceinte',
      declaredValueCents: 12000,
    });
    expect(label.providerRef).toBe('ord-42');
    expect(label.trackingNumber).toBe('MR123456789');
    expect(label.trackingUrl).toBe('https://suivi.example/MR123456789');
    expect(label.labelPdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(label.priceCents).toBe(550); // 4,58 HT → TTC arrondi
    const order = fake.calls.find((c) => c.method === 'POST' && c.url === '/shipping/v3.1/shipping-order')!;
    const sent = JSON.parse(order.body);
    expect(sent.labelType).toBe('PDF_10x15');
    expect(sent.shippingOfferCode).toBe('MONR-RELAIS');
    expect(sent.shipment.pickupPointCode).toBe('MR-001');
    expect(sent.shipment.packages[0]).toMatchObject({ type: 'PARCEL', weight: 0.9, length: 30, width: 20, height: 10, value: { value: 120, currency: 'EUR' } });
    expect(sent.shipment.fromAddress.location).toMatchObject({ number: '12', street: 'rue de la République', postalCode: '69003', city: 'Lyon', countryIsoCode: 'FR' });
    expect(sent.shipment.toAddress.contact).toMatchObject({ firstName: 'Alex', lastName: 'Acheteur', phone: '0687654321' });
    expect(sent.shipment.toAddress.additionalInformation).toBe('Bât. B');
    // Le jeton v3 est mis en cache : au plus un échange pour tous les appels de ce scénario (souvent zéro, obtenu au test précédent)
    expect(fake.calls.filter((c) => c.url === '/iam/account-app/token').length).toBeLessThanOrEqual(1);

    const tracking = await provider.track('mondial_relay', 'MR123456789', 'ord-42');
    expect(tracking.state).toBe('etiquette_creee');
    expect(tracking.events[0].label).toBe('Étiquette créée');
    expect(await provider.cancel('ord-42')).toBe(true);
  });

  it('erreurs typées : identifiants v3 refusés, identifiants v1 refusés, adresse refusée, prestataire indisponible', async () => {
    const bad = new BoxtalShippingProvider(new ConfigService({ BOXTAL_ENV: 'sandbox', BOXTAL_V3_API_URL: `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`, BOXTAL_V1_API_URL: `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`, BOXTAL_V3_ACCESS_KEY: 'AK', BOXTAL_V3_SECRET_KEY: 'mauvaise', BOXTAL_V1_LOGIN: 'login', BOXTAL_V1_PASSWORD: 'faux' }));
    await expect(bad.searchRelayPoints('colissimo', '75017')).rejects.toMatchObject({ code: 'non_configure' });
    await expect(bad.quote({ carrier: 'colissimo', parcel: { weightGrams: 500 }, fromPostalCode: '69003', toPostalCode: '75017' })).rejects.toMatchObject({ code: 'non_configure' });

    const base = { carrier: 'colissimo' as const, mode: 'domicile' as const, offerCode: 'POFR_ColissimoAccess', parcel: { weightGrams: 500 }, sender: { name: 'A B', line1: '1 rue Test', postalCode: '69003', city: 'Lyon', country: 'FR' }, reference: 'tx', contentDescription: 'x', declaredValueCents: 1000 };
    await expect(provider.createLabel({ ...base, recipient: { name: 'C D', line1: '2 rue Test', postalCode: '99999', city: 'Nulle part', country: 'FR' } })).rejects.toMatchObject({ code: 'adresse_invalide' });

    fake.state.down = true;
    const err = await provider.createLabel({ ...base, recipient: { name: 'C D', line1: '2 rue Test', postalCode: '75017', city: 'Paris', country: 'FR' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ShippingProviderError);
    expect(err.code).toBe('transporteur_indisponible');
  });
});

describe('Adresse de livraison au paiement et colis déclaré au dépôt', () => {
  let app: INestApplication;
  let server: any;
  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  it("adresse : enregistrée pour un envoi, visible de l'acheteur et du vendeur, ignorée en main propre, validée", async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 80, deliveryAvailable: true });
    const address = { name: 'Alex Acheteur', line1: '5 avenue des Ternes', line2: 'Bât. B', postalCode: '75017', city: 'Paris', phone: '0687654321' };
    await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', shippingAddress: { ...address, postalCode: '7501' } }).expect(400);
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', shippingAddress: address }).expect(201);
    const id = (created.body.transaction ?? created.body).id;
    const asSeller = await request(server).get(`/transactions/${id}`).set(seller.auth).expect(200);
    expect(asSeller.body.shippingAddress).toEqual(address);
    const asBuyer = await request(server).get(`/transactions/${id}`).set(buyer.auth).expect(200);
    expect(asBuyer.body.shippingAddress).toEqual(address);
    // Remise en main propre : aucune adresse conservée même si envoyée
    const listing2 = await createListing(app, seller, { price: 30 });
    const hand = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing2.id, deliveryMethod: 'main_propre', shippingAddress: address }).expect(201);
    const handId = (hand.body.transaction ?? hand.body).id;
    expect((await request(server).get(`/transactions/${handId}`).set(buyer.auth).expect(200)).body.shippingAddress).toBeNull();
    // Vente créée sans adresse (ancien client) : acceptée, le vendeur voit qu'elle manque
    const listing3 = await createListing(app, seller, { price: 30, deliveryAvailable: true });
    const old = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing3.id, deliveryMethod: 'colissimo' }).expect(201);
    expect((await request(server).get(`/transactions/${(old.body.transaction ?? old.body).id}`).set(seller.auth).expect(200)).body.shippingAddress).toBeNull();
  });

  it('colis déclaré au dépôt : facultatif, bornes, modifiable, renvoyé sur la fiche', async () => {
    const seller = await login(app);
    const listing = await createListing(app, seller, { deliveryAvailable: true, weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 });
    const detail = await request(server).get(`/listings/${listing.id}`).expect(200);
    expect(detail.body).toMatchObject({ weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 });
    await request(server).post('/listings').set(seller.auth).send({ title: 'Trop lourd pour un colis', description: 'Description assez longue pour passer.', categorySlug: 'ameublement', price: 10, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003', weightGrams: 40000 }).expect(400);
    await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ weightGrams: 1500 }).expect(200);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.weightGrams).toBe(1500);
    const plain = await createListing(app, seller, {});
    expect((await request(server).get(`/listings/${plain.id}`).expect(200)).body.weightGrams).toBeNull();
  });
});
