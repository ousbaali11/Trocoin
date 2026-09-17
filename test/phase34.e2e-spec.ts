import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MockPaymentProvider } from '../src/payments/mock-payment.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { classifyPickupPoint } from '../src/shipping/shipping-provider.interface';
import { createApp, createListing, login } from './utils';

/**
 * Phase 34 (AUDIT §57) : suivi de la vente dans la messagerie (messages automatiques, confirmation de disponibilité,
 * mêmes routes que la page de la vente), lieu de réception choisi par l'acheteur parmi les points réels du
 * transporteur (relais, bureau de poste, consigne), abandon d'un paiement hébergé non finalisé.
 */
describe('Phase 34 : suivi dans la messagerie, points de retrait, retour de paiement', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  const address = { name: 'Nora Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris', phone: '06 12 34 56 78' };
  const systemOf = (body: any) => (body.messages as any[]).filter((m) => m.type === 'system');

  it('nature des points de retrait : classée d\'après le nom publié par le transporteur', () => {
    expect(classifyPickupPoint('LOCKER STATION AVIA BD DES BATI')).toBe('consigne');
    expect(classifyPickupPoint('LOCKER FRANPRIX')).toBe('consigne');
    expect(classifyPickupPoint('Pickup Station Gare de Lyon')).toBe('consigne');
    expect(classifyPickupPoint('CONSIGNE PICKUP CARREFOUR CITY')).toBe('consigne');
    expect(classifyPickupPoint('BUREAU DE POSTE PARIS TERNES')).toBe('bureau_poste');
    expect(classifyPickupPoint('LA POSTE PARIS 17 WAGRAM')).toBe('bureau_poste');
    expect(classifyPickupPoint('Point quelconque', 'POST_OFFICE')).toBe('bureau_poste');
    expect(classifyPickupPoint('TABAC LE BALTO')).toBe('relais');
    expect(classifyPickupPoint('Boulangerie Martin')).toBe('relais');
    expect(classifyPickupPoint('LIBRAIRIE DU POSTEL')).toBe('relais'); // « poste » seulement comme mot entier
  });

  it('achat → conversation créée avec un message automatique ; disponibilité, expédition et réception s\'y inscrivent, par les mêmes routes que la page de la vente', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 120, deliveryAvailable: true, title: 'Enceinte Bluetooth JBL Flip 6' });
    // Aucune conversation avant l'achat
    expect((await request(server).get('/conversations').set(buyer.auth).expect(200)).body).toHaveLength(0);
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: address }).expect(201);
    const txId = (created.body.transaction ?? created.body).id as string;

    // 1. Conversation créée d'office, message « achat confirmé », non lu pour le vendeur
    const inboxSeller = (await request(server).get('/conversations').set(seller.auth).expect(200)).body;
    expect(inboxSeller).toHaveLength(1);
    expect(inboxSeller[0].lastMessage).toMatchObject({ type: 'system' });
    expect(inboxSeller[0].unreadCount).toBe(1);
    const convId = inboxSeller[0].id as string;
    let conv = (await request(server).get(`/conversations/${convId}`).set(buyer.auth).expect(200)).body;
    expect(systemOf(conv).map((m) => m.systemEvent)).toEqual(['achat_confirme']);
    expect(systemOf(conv)[0]).toMatchObject({ transactionId: txId, meta: expect.objectContaining({ amount: 126.5, price: 120, deliveryMethod: 'colissimo', deliveryMode: 'domicile' }) });
    expect(conv.transaction).toMatchObject({ id: txId, role: 'acheteur', status: 'sequestre', deliveryMode: 'domicile', sellerConfirmedAt: null });
    // La page de la vente pointe vers la conversation
    expect((await request(server).get(`/transactions/${txId}`).set(buyer.auth).expect(200)).body.conversationId).toBe(convId);

    // 2. Disponibilité : vendeur seulement, une seule fois
    await request(server).post(`/transactions/${txId}/confirm-availability`).set(buyer.auth).expect(403);
    const confirmed = await request(server).post(`/transactions/${txId}/confirm-availability`).set(seller.auth).expect(200);
    expect(confirmed.body.sellerConfirmedAt).toBeTruthy();
    await request(server).post(`/transactions/${txId}/confirm-availability`).set(seller.auth).expect(200);
    conv = (await request(server).get(`/conversations/${convId}`).set(buyer.auth).expect(200)).body;
    expect(systemOf(conv).map((m) => m.systemEvent)).toEqual(['achat_confirme', 'disponibilite_confirmee']);
    expect(conv.transaction.sellerConfirmedAt).toBeTruthy();

    // 3. Expédition déclarée sur la route habituelle → message avec numéro et lien de suivi
    await request(server).post(`/transactions/${txId}/ship`).set(seller.auth).send({ trackingNumber: '6A12345678901' }).expect(201);
    conv = (await request(server).get(`/conversations/${convId}`).set(buyer.auth).expect(200)).body;
    const shipped = systemOf(conv).find((m) => m.systemEvent === 'expedie');
    expect(shipped.meta).toMatchObject({ trackingNumber: '6A12345678901', carrier: 'colissimo', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901' });
    expect(conv.transaction).toMatchObject({ status: 'livree', trackingNumber: '6A12345678901', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901' });
    // Après l'expédition, la disponibilité ne se confirme plus
    await request(server).post(`/transactions/${txId}/confirm-availability`).set(seller.auth).expect(400);

    // 4. Réception confirmée sur la route habituelle → message, vente confirmée, virement déclenché
    await request(server).post(`/transactions/${txId}/confirm-delivery`).set(buyer.auth).expect(201);
    conv = (await request(server).get(`/conversations/${convId}`).set(seller.auth).expect(200)).body;
    expect(systemOf(conv).map((m) => m.systemEvent)).toEqual(['achat_confirme', 'disponibilite_confirmee', 'expedie', 'reception_confirmee']);
    expect(systemOf(conv)[3].meta).toMatchObject({ payout: 110.4 });
    expect(conv.transaction).toMatchObject({ status: 'confirme', role: 'vendeur' });
    // Les personnes peuvent toujours s'écrire ; un message automatique ne se poste pas par l'API publique
    await request(server).post(`/conversations/${convId}/messages`).set(buyer.auth).send({ content: 'Bien reçu, merci !' }).expect(201);
    const posted = await request(server).post(`/conversations/${convId}/messages`).set(buyer.auth).send({ content: 'x', type: 'system', systemEvent: 'reception_confirmee' });
    expect([201, 400]).toContain(posted.status);
    if (posted.status === 201) expect(posted.body.type).toBe('text');
  });

  it('remise en main propre et annulation : étapes inscrites dans la conversation existante, sans doublon', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 40 });
    const opened = await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.id, message: 'Bonjour, toujours disponible ?' }).expect(201);
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
    const txId = (created.body.transaction ?? created.body).id as string;
    await request(server).post(`/transactions/${txId}/ship`).set(seller.auth).send({}).expect(201);
    await request(server).post(`/transactions/${txId}/dispute`).set(buyer.auth).send({ reason: 'Le vendeur ne répond plus depuis une semaine.' }).expect(201);
    const conv = (await request(server).get(`/conversations/${opened.body.id}`).set(seller.auth).expect(200)).body;
    expect(conv.messages.map((m: any) => m.systemEvent ?? m.type)).toEqual(['text', 'achat_confirme', 'pret_pour_remise', 'litige_ouvert']);
    expect(JSON.stringify(conv.transaction)).not.toMatch(/handoverCode|\d{6}"/); // le code de remise ne passe jamais par la conversation
    expect((await request(server).get('/conversations').set(seller.auth).expect(200)).body).toHaveLength(1);
  });

  it('options de réception : ce que chaque transporteur propose pour l\'adresse, avec des points réels typés', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 60, deliveryAvailable: true });
    const noDelivery = await createListing(app, seller, { price: 60, deliveryAvailable: false });
    await request(server).get(`/shipping/pickup-options?listingId=${listing.id}&postalCode=75017&city=Paris`).expect(401);
    await request(server).get(`/shipping/pickup-options?listingId=${listing.id}&postalCode=7501`).set(buyer.auth).expect(400);
    await request(server).get(`/shipping/pickup-options?listingId=${noDelivery.id}&postalCode=75017`).set(buyer.auth).expect(404);
    const res = await request(server).get(`/shipping/pickup-options?listingId=${listing.id}&postalCode=75017&city=Paris`).set(buyer.auth).expect(200);
    expect(res.body.carriers.map((c: any) => c.carrier)).toEqual(['colissimo', 'mondial_relay']);
    const [colissimo, mondial] = res.body.carriers;
    expect(colissimo).toMatchObject({ domicile: true, pointRelais: true });
    expect(colissimo.points.map((p: any) => p.type).sort()).toEqual(['bureau_poste', 'consigne', 'relais']);
    expect(mondial.points.map((p: any) => p.type).sort()).toEqual(['consigne', 'relais', 'relais']);
    for (const p of [...colissimo.points, ...mondial.points]) expect(p).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), postalCode: '75017' }));
    // Adresse sans point de retrait : seul le domicile est proposé
    const none = await request(server).get(`/shipping/pickup-options?listingId=${listing.id}&postalCode=00000&city=Nulle-part`).set(buyer.auth).expect(200);
    expect(none.body.carriers[0]).toMatchObject({ domicile: true, pointRelais: false, points: [] });
  });

  it('point de retrait choisi par l\'acheteur : relu chez le transporteur, conservé sur la vente, imposé à l\'étiquette ; point inconnu refusé avant tout paiement', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 60, deliveryAvailable: true, title: 'Lampe de bureau articulée' });
    const options = await request(server).get(`/shipping/pickup-options?listingId=${listing.id}&postalCode=75017&city=Paris`).set(buyer.auth).expect(200);
    const locker = options.body.carriers[1].points.find((p: any) => p.type === 'consigne');
    // Point inconnu du transporteur : refus, aucune transaction créée
    const unknown = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'mondial_relay', deliveryMode: 'point_relais', shippingAddress: address, pickupPoint: { id: 'MR-INVENTE', name: 'Faux relais', line1: '1 rue Inventée', postalCode: '75017', city: 'Paris', type: 'relais' } }).expect(400);
    expect(unknown.body.message).toMatch(/n'est plus proposé par le transporteur/);
    expect((await request(server).get('/transactions/mine').set(buyer.auth).expect(200)).body).toHaveLength(0);
    // Point réel, mais fiche maquillée par le navigateur : c'est la fiche du transporteur qui est gardée
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'mondial_relay', deliveryMode: 'point_relais', shippingAddress: address, pickupPoint: { id: locker.id, name: 'Nom maquillé', line1: 'Adresse maquillée', postalCode: '75017', city: 'Paris', type: 'relais' } }).expect(201);
    const tx = created.body.transaction ?? created.body;
    expect(tx).toMatchObject({ deliveryMode: 'point_relais', pickupPoint: { id: locker.id, name: locker.name, type: 'consigne' } });
    const conv = (await request(server).get('/conversations').set(seller.auth).expect(200)).body[0];
    const detail = (await request(server).get(`/conversations/${conv.id}`).set(seller.auth).expect(200)).body;
    expect(detail.messages[0].meta.pickupPoint).toBe(`${locker.name}, ${locker.city}`);
    expect(detail.transaction.pickupPoint).toEqual({ name: locker.name, city: locker.city, type: 'consigne' });
    // Étiquette : le vendeur ne peut ni changer de mode ni de point
    const sender = { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', phone: '06 11 22 33 44' };
    const label = await request(server).post(`/transactions/${tx.id}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 900 }, sender, recipient: address }).expect(201);
    expect(label.body).toMatchObject({ mode: 'point_relais', relayPointId: locker.id, status: 'etiquette_prete' });
  });

  it('paiement hébergé non finalisé : l\'acheteur abandonne, l\'annonce redevient achetable ; paiement abouti : un seul message « achat confirmé »', async () => {
    const provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    provider.setHosted(true);
    try {
      const seller = await login(app);
      const buyer = await login(app);
      const other = await login(app);
      const listing = await createListing(app, seller, { price: 35 });
      const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id }).expect(201);
      expect(created.body.transaction.status).toBe('en_attente');
      expect(created.body.checkoutUrl).toMatch(/\/dev\/mock-checkout\/mock_cs_/);
      const txId = created.body.transaction.id as string;
      const sessionId = created.body.checkoutUrl.split('/').pop() as string;
      expect(provider.getSession(sessionId)).toMatchObject({ successUrl: expect.stringMatching(new RegExp(`/compte/transactions/${txId}\\?paiement=retour$`)), cancelUrl: expect.stringMatching(new RegExp(`/compte/transactions/${txId}\\?paiement=annule$`)) });
      // Tant que le paiement n'est pas fait : aucune conversation, aucun message, annonce réservée
      expect((await request(server).get('/conversations').set(seller.auth).expect(200)).body).toHaveLength(0);
      await request(server).post('/transactions').set(other.auth).send({ listingId: listing.id }).expect(400);
      // Seul l'acheteur abandonne ; l'annonce est aussitôt rachetable, la page de paiement est fermée
      await request(server).post(`/transactions/${txId}/abandon`).set(seller.auth).expect(403);
      const abandoned = await request(server).post(`/transactions/${txId}/abandon`).set(buyer.auth).expect(200);
      expect(abandoned.body).toMatchObject({ status: 'annulee', resolutionNote: "Paiement abandonné par l'acheteur" });
      expect(provider.getSession(sessionId)!.state).toBe('expiree');
      const second = await request(server).post('/transactions').set(other.auth).send({ listingId: listing.id }).expect(201);
      // Paiement abouti sur la page hébergée, retour de l'acheteur lu deux fois : un seul message automatique
      provider.getSession(second.body.checkoutUrl.split('/').pop())!.state = 'payee';
      const back = await request(server).get(`/transactions/${second.body.transaction.id}`).set(other.auth).expect(200);
      expect(back.body.status).toBe('sequestre');
      await request(server).get(`/transactions/${second.body.transaction.id}`).set(other.auth).expect(200);
      const conv = (await request(server).get('/conversations').set(seller.auth).expect(200)).body;
      expect(conv).toHaveLength(1);
      const detail = (await request(server).get(`/conversations/${conv[0].id}`).set(seller.auth).expect(200)).body;
      expect(detail.messages.map((m: any) => m.systemEvent)).toEqual(['achat_confirme']);
      // Un paiement abouti ne s'abandonne plus : la vente suit son cours
      const kept = await request(server).post(`/transactions/${second.body.transaction.id}/abandon`).set(other.auth).expect(200);
      expect(kept.body.status).toBe('sequestre');
    } finally {
      provider.setHosted(false);
    }
  });
});
