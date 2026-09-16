import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { Notification } from '../src/notifications/notification.entity';
import { MockPaymentProvider } from '../src/payments/mock-payment.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { ESCROW_AUTO_CONFIRM_DAYS, ESCROW_CAPTURE_AFTER_HOURS, ESCROW_SHIP_DEADLINE_DAYS, PaymentsService } from '../src/payments/payments.service';
import { Transaction } from '../src/payments/transaction.entity';
import { createApp, createListing, login, makeAdmin } from './utils';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Phase 24 (AUDIT §39) : séquestre sur le solde de la plateforme (« paiements et transferts distincts »).
 * L'autorisation est encaissée sur le solde de Trocoin au plus tard ESCROW_CAPTURE_AFTER_HOURS après le
 * paiement (plus tôt à l'expédition, à la remise ou au litige) : plus aucune expiration. Le vendeur est payé
 * par un virement séparé à la confirmation seulement. Remboursement depuis le solde avant virement ; après
 * virement, annulation du virement puis remboursement. Le temps est simulé en passant `now` à la tâche.
 */
describe('Phase 24 : séquestre sur le solde de la plateforme (capture rapide, virement différé au vendeur)', () => {
  let app: INestApplication;
  let server: any;
  let payments: PaymentsService;
  let txRepo: Repository<Transaction>;
  let notifRepo: Repository<Notification>;
  const calls: string[] = [];

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    payments = app.get(PaymentsService);
    txRepo = app.get(getRepositoryToken(Transaction));
    notifRepo = app.get(getRepositoryToken(Notification));
    const provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    const capture = provider.capture.bind(provider);
    const refund = provider.refund.bind(provider);
    const transfer = provider.transfer.bind(provider);
    const reverse = provider.reverseTransfer.bind(provider);
    provider.capture = async (id) => { calls.push(`capture ${id}`); return capture(id); };
    provider.refund = async (id) => { calls.push(`refund ${id}`); return refund(id); };
    provider.transfer = async (p) => { calls.push(`transfer ${p.providerPaymentId} ${p.amountEuros} ${p.sellerConnectedAccountId}`); return transfer(p); };
    provider.reverseTransfer = async (id) => { calls.push(`reverse ${id}`); return reverse(id); };
  });
  afterAll(() => app.close());

  const stored = (id: string) => txRepo.findOne({ where: { id } }).then((t) => t!);
  const forTx = (from: number, pi: string) => calls.slice(from).filter((c) => c.includes(pi));
  const titlesFor = async (userId: string) => (await notifRepo.find({ where: { userId, type: 'transaction' }, order: { createdAt: 'ASC' } })).map((n) => n.title);
  const bodiesFor = async (userId: string) => (await notifRepo.find({ where: { userId, type: 'transaction' }, order: { createdAt: 'ASC' } })).map((n) => n.body);
  const connect = (user: { auth: Record<string, string> }) => request(server).post('/users/me/stripe-onboarding-link').set(user.auth).expect(201);
  const buy = async (delivery: 'colissimo' | 'main_propre', price = 60, sellerConnected = false) => {
    const seller = await login(app);
    if (sellerConnected) await connect(seller);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price, deliveryAvailable: delivery !== 'main_propre' });
    const body = delivery === 'main_propre' ? { listingId: listing.id } : { listingId: listing.id, deliveryMethod: delivery, shippingAddress: { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' } };
    const created = await request(server).post('/transactions').set(buyer.auth).send(body).expect(201);
    return { seller, buyer, listing, tx: created.body.transaction as Transaction & { id: string } };
  };

  it('création : modèle platform, délai d\'expédition enregistré, encaissement par la tâche après 24 h (pas avant) ; une annulation avant encaissement libère simplement l\'autorisation', async () => {
    const { buyer, tx } = await buy('colissimo');
    const t = await stored(tx.id);
    expect(t.escrowModel).toBe('platform');
    expect(t.capturedAt).toBeNull();
    expect(t.transferId).toBeNull();
    expect(Math.abs(new Date(t.shipBy!).getTime() - (new Date(t.paidAt!).getTime() + ESCROW_SHIP_DEADLINE_DAYS * DAY))).toBeLessThan(5_000);
    expect(t.captureBefore).toBeTruthy(); // encore relu chez le fournisseur : sert de garde-fou à la capture
    const paid = new Date(t.paidAt!).getTime();
    const before = calls.length;
    await payments.runEscrowSchedule(new Date(paid + (ESCROW_CAPTURE_AFTER_HOURS - 1) * HOUR));
    expect(forTx(before, t.providerPaymentId!)).toEqual([]);
    expect((await stored(tx.id)).capturedAt).toBeNull();
    const r = await payments.runEscrowSchedule(new Date(paid + (ESCROW_CAPTURE_AFTER_HOURS + 1) * HOUR));
    expect(r.captured).toBeGreaterThanOrEqual(1);
    expect(forTx(before, t.providerPaymentId!)).toEqual([`capture ${t.providerPaymentId}`]);
    const after = await stored(tx.id);
    expect(after.status).toBe('sequestre'); // encaissé par Trocoin, mais toujours en séquestre pour les parties
    expect(after.capturedAt).toBeTruthy();
    // Idempotent
    await payments.runEscrowSchedule(new Date(paid + 30 * HOUR));
    expect(forTx(before, t.providerPaymentId!)).toHaveLength(1);
    const view = await request(server).get(`/transactions/${tx.id}`).set(buyer.auth).expect(200);
    expect(view.body.escrowModel).toBe('platform');
    expect(view.body.capturedAt).toBe(new Date(after.capturedAt!).toISOString());
    expect(view.body.shipBy).toBe(new Date(after.shipBy!).toISOString());
    expect(view.body.transferId).toBeUndefined();
    expect(view.body.providerPaymentId).toBeUndefined();

    // Annulation par l'acheteur avant encaissement : l'autorisation est libérée (aucun virement à annuler)
    const second = await buy('colissimo', 25);
    const s2 = await stored(second.tx.id);
    const b2 = calls.length;
    await request(server).post(`/transactions/${second.tx.id}/cancel`).set(second.buyer.auth).expect(201);
    expect(forTx(b2, s2.providerPaymentId!)).toEqual([`refund ${s2.providerPaymentId}`]);
    expect((await stored(second.tx.id)).status).toBe('annulee');
  });

  it('parcours nominal : expédition → encaissement immédiat ; réception confirmée → virement du montant net (prix − commission) au compte du vendeur', async () => {
    const { seller, buyer, listing, tx } = await buy('colissimo', 100, true);
    const t = await stored(tx.id);
    const before = calls.length;
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000101' }).expect(201);
    const shipped = await stored(tx.id);
    expect(shipped.capturedAt).toBeTruthy();
    expect(forTx(before, t.providerPaymentId!)).toEqual([`capture ${t.providerPaymentId}`]);
    // Réception présumée : N jours après l'expédition, sans plafond lié à l'autorisation
    expect(Math.abs(new Date(shipped.autoConfirmAt!).getTime() - (new Date(shipped.shippedAt!).getTime() + ESCROW_AUTO_CONFIRM_DAYS * DAY))).toBeLessThan(5_000);
    await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(buyer.auth).expect(201);
    const done = await stored(tx.id);
    expect(done.status).toBe('confirme');
    expect(done.transferId).toMatch(/^mock_tr_/);
    expect(done.transferredAt).toBeTruthy();
    const seen = forTx(before, t.providerPaymentId!);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(new RegExp(`^transfer ${t.providerPaymentId} 92 acct_`)); // 100 € − 8 % de commission
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('vendue');
    const sellerView = await request(server).get(`/transactions/${tx.id}`).set(seller.auth).expect(200);
    expect(sellerView.body.transferredAt).toBe(new Date(done.transferredAt!).toISOString());
    expect(sellerView.body.transferId).toBeUndefined();
    expect(await bodiesFor(seller.id)).toContainEqual(expect.stringContaining('les fonds vous sont versés'));
    // Confirmée : plus aucun encaissement ni virement supplémentaire par la tâche
    const again = calls.length;
    await payments.runEscrowSchedule(new Date(Date.now() + 30 * DAY));
    expect(forTx(again, t.providerPaymentId!)).toEqual([]);
  });

  it('vendeur sans compte de versement : remise confirmée par le code, vente confirmée, virement en attente puis effectué par la tâche dès que le compte existe', async () => {
    const { seller, tx } = await buy('main_propre', 50);
    const t = await stored(tx.id);
    const before = calls.length;
    await request(server).post(`/transactions/${tx.id}/handover`).set(seller.auth).send({ code: tx.handoverCode }).expect(201);
    const done = await stored(tx.id);
    expect(done.status).toBe('confirme');
    expect(done.capturedAt).toBeTruthy();
    expect(done.transferId).toBeNull(); // pas de compte : le virement attend
    expect(forTx(before, t.providerPaymentId!)).toEqual([`capture ${t.providerPaymentId}`]);
    // La tâche ne peut toujours pas virer
    expect((await payments.runEscrowSchedule(new Date())).transferred).toBe(0);
    expect((await stored(tx.id)).transferId).toBeNull();
    // Le vendeur crée son compte de versement : le prochain passage vire le montant net et le prévient
    await connect(seller);
    const r = await payments.runEscrowSchedule(new Date());
    expect(r.transferred).toBeGreaterThanOrEqual(1);
    const paid = await stored(tx.id);
    expect(paid.transferId).toMatch(/^mock_tr_/);
    expect(forTx(before, t.providerPaymentId!)[1]).toMatch(new RegExp(`^transfer ${t.providerPaymentId} 46 acct_`)); // 50 € − 8 %
    expect(await titlesFor(seller.id)).toContain('Versement effectué');
    // Une seule fois
    await payments.runEscrowSchedule(new Date());
    expect(forTx(before, t.providerPaymentId!)).toHaveLength(2);
  });

  it('remboursement avant virement : litige après expédition (fonds déjà chez Trocoin) → l\'admin rembourse depuis le solde, sans aucune annulation de virement', async () => {
    const { seller, buyer, listing, tx } = await buy('colissimo', 80, true);
    const t = await stored(tx.id);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000102' }).expect(201);
    await request(server).post(`/transactions/${tx.id}/dispute`).set(buyer.auth).send({ reason: 'Colis reçu vide.' }).expect(201);
    // En litige : aucune échéance ne presse, même très longtemps après (les fonds n'expirent pas)
    const quiet = calls.length;
    await payments.runEscrowSchedule(new Date(Date.now() + 60 * DAY));
    expect(forTx(quiet, t.providerPaymentId!)).toEqual([]);
    expect((await stored(tx.id)).status).toBe('litige');
    const admin = await login(app);
    await makeAdmin(app, admin);
    const before = calls.length;
    await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Colis vide confirmé par photos.' }).expect(201);
    expect(forTx(before, t.providerPaymentId!)).toEqual([`refund ${t.providerPaymentId}`]);
    const done = await stored(tx.id);
    expect(done.status).toBe('rembourse');
    expect(done.transferId).toBeNull();
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('en_ligne');
  });

  it('remboursement après virement : réception présumée 7 jours après l\'expédition (au-delà de l\'ancienne autorisation) → virement ; litige dans la fenêtre → virement annulé puis acheteur remboursé', async () => {
    const { seller, buyer, tx } = await buy('colissimo', 120, true);
    // Expédition au 5e jour : la réception présumée tombe au 12e jour, bien après l'ancienne fenêtre de 7 jours
    const paidAt = new Date(Date.now() - 5 * DAY);
    await txRepo.update(tx.id, { paidAt, captureBefore: new Date(paidAt.getTime() + 7 * DAY), shipBy: new Date(paidAt.getTime() + ESCROW_SHIP_DEADLINE_DAYS * DAY), createdAt: paidAt });
    const t = await stored(tx.id);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000103' }).expect(201);
    const shipped = await stored(tx.id);
    const autoAt = new Date(shipped.autoConfirmAt!).getTime();
    expect(autoAt).toBeGreaterThan(new Date(t.captureBefore!).getTime()); // non plafonnée : les fonds sont déjà encaissés
    expect(shipped.capturedAt).toBeTruthy();
    const buyerBefore = (await titlesFor(buyer.id)).length;
    expect((await payments.runEscrowSchedule(new Date(autoAt - 47 * HOUR))).reminders).toBeGreaterThanOrEqual(1);
    expect((await payments.runEscrowSchedule(new Date(autoAt - 23 * HOUR))).notices).toBeGreaterThanOrEqual(1);
    expect((await titlesFor(buyer.id)).slice(buyerBefore)).toEqual(['Avez-vous bien reçu votre colis ?', 'Dernier rappel : confirmez la réception']);
    const before = calls.length;
    expect((await payments.runEscrowSchedule(new Date(autoAt + 60_000))).confirmed).toBeGreaterThanOrEqual(1);
    const done = await stored(tx.id);
    expect(done.status).toBe('confirme');
    expect(done.autoResolution).toBe('reception_presumee');
    expect(done.transferId).toMatch(/^mock_tr_/);
    expect(forTx(before, t.providerPaymentId!)).toEqual([expect.stringMatching(new RegExp(`^transfer ${t.providerPaymentId} 110.4 acct_`))]);
    expect(await titlesFor(seller.id)).toContain('Vente confirmée');
    // Litige dans la fenêtre, puis remboursement par l'admin : le virement est d'abord annulé
    await request(server).post(`/transactions/${tx.id}/dispute`).set(buyer.auth).send({ reason: 'Colis jamais arrivé malgré le suivi.' }).expect(201);
    const admin = await login(app);
    await makeAdmin(app, admin);
    const refundFrom = calls.length;
    await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Suivi sans livraison : remboursement.' }).expect(201);
    expect(calls.slice(refundFrom)).toEqual([`reverse ${done.transferId}`, `refund ${t.providerPaymentId}`]);
    const refunded = await stored(tx.id);
    expect(refunded.status).toBe('rembourse');
    expect(refunded.transferId).toBeNull();
    expect(refunded.transferredAt).toBeNull();
  });

  it('non expédié avant le délai : rappels au vendeur J-2 et J-1, puis annulation et remboursement depuis le solde ; remise en main propre sans code : idem', async () => {
    const { seller, buyer, listing, tx } = await buy('colissimo', 45);
    const t = await stored(tx.id);
    const shipBy = new Date(t.shipBy!).getTime();
    const before = calls.length;
    expect((await payments.runEscrowSchedule(new Date(shipBy - 47 * HOUR))).reminders).toBeGreaterThanOrEqual(1);
    expect((await payments.runEscrowSchedule(new Date(shipBy - 23 * HOUR))).notices).toBeGreaterThanOrEqual(1);
    expect((await titlesFor(seller.id)).filter((x) => /Expédiez avant le|Dernier rappel : expédiez/.test(x))).toHaveLength(2);
    expect((await stored(tx.id)).capturedAt).toBeTruthy(); // encaissé entre-temps (24 h)
    expect((await payments.runEscrowSchedule(new Date(shipBy + 60_000))).cancelled).toBeGreaterThanOrEqual(1);
    const done = await stored(tx.id);
    expect(done.status).toBe('annulee');
    expect(done.autoResolution).toBe('annulation_echeance');
    expect(forTx(before, t.providerPaymentId!)).toEqual([`capture ${t.providerPaymentId}`, `refund ${t.providerPaymentId}`]);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('en_ligne');
    expect(await titlesFor(buyer.id)).toContain('Achat annulé, remboursement intégral');

    // Remise en main propre : le vendeur se déclare prêt mais le code n'est jamais saisi → annulation à l'échéance
    const hand = await buy('main_propre', 30);
    const h = await stored(hand.tx.id);
    await request(server).post(`/transactions/${hand.tx.id}/ship`).set(hand.seller.auth).send({}).expect(201);
    expect((await stored(hand.tx.id)).capturedAt).toBeTruthy();
    const b2 = calls.length;
    await payments.runEscrowSchedule(new Date(new Date(h.shipBy!).getTime() - 47 * HOUR));
    expect((await titlesFor(hand.buyer.id)).some((x) => /Rendez-vous à organiser/.test(x))).toBe(true);
    expect((await payments.runEscrowSchedule(new Date(new Date(h.shipBy!).getTime() + 1000))).cancelled).toBeGreaterThanOrEqual(1);
    expect((await stored(hand.tx.id)).status).toBe('annulee');
    expect(forTx(b2, h.providerPaymentId!)).toEqual([`refund ${h.providerPaymentId}`]);
  });

  it('litige avant encaissement : fonds mis en sécurité à l\'ouverture ; aucune action automatique ensuite ; l\'admin libère → virement au vendeur', async () => {
    const { seller, buyer, tx } = await buy('main_propre', 40, true);
    const t = await stored(tx.id);
    const before = calls.length;
    await request(server).post(`/transactions/${tx.id}/dispute`).set(buyer.auth).send({ reason: 'Le vendeur ne répond plus.' }).expect(201);
    expect(forTx(before, t.providerPaymentId!)).toEqual([`capture ${t.providerPaymentId}`]);
    await payments.runEscrowSchedule(new Date(Date.now() + 45 * DAY));
    expect((await stored(tx.id)).status).toBe('litige');
    expect(forTx(before, t.providerPaymentId!)).toHaveLength(1);
    const admin = await login(app);
    await makeAdmin(app, admin);
    await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'liberer', note: 'Remise prouvée par les messages.' }).expect(201);
    const done = await stored(tx.id);
    expect(done.status).toBe('confirme');
    expect(done.transferId).toMatch(/^mock_tr_/);
    expect(forTx(before, t.providerPaymentId!)[1]).toMatch(new RegExp(`^transfer ${t.providerPaymentId} 36.8 acct_`));
    expect(await titlesFor(seller.id)).toContain('Litige tranché');
  });

  it('filet de sécurité admin : une vente à expédier sous 48 h et une réception présumée sous 48 h sont listées, pas un litige (sans échéance)', async () => {
    const admin = await login(app);
    await makeAdmin(app, admin);
    const a = await buy('colissimo', 20);
    const b = await buy('colissimo', 22);
    const c = await buy('colissimo', 24);
    await request(server).post(`/transactions/${b.tx.id}/ship`).set(b.seller.auth).send({ trackingNumber: '6A00000000104' }).expect(201);
    await request(server).post(`/transactions/${c.tx.id}/dispute`).set(c.buyer.auth).send({ reason: 'Litige de test.' }).expect(201);
    const none = (await request(server).get('/admin/transactions?due=1').set(admin.auth).expect(200)).body.items.map((x: any) => x.id);
    expect(none).not.toContain(a.tx.id);
    expect(none).not.toContain(b.tx.id);
    await txRepo.update(a.tx.id, { shipBy: new Date(Date.now() + 30 * HOUR) });
    await txRepo.update(b.tx.id, { autoConfirmAt: new Date(Date.now() + 20 * HOUR) });
    await txRepo.update(c.tx.id, { shipBy: new Date(Date.now() + 10 * HOUR) });
    const due = (await request(server).get('/admin/transactions?due=1').set(admin.auth).expect(200)).body.items.map((x: any) => x.id);
    expect(due).toContain(a.tx.id);
    expect(due).toContain(b.tx.id);
    expect(due).not.toContain(c.tx.id);
    const detail = await request(server).get(`/admin/transactions/${a.tx.id}`).set(admin.auth).expect(200);
    expect(detail.body.escrowModel).toBe('platform');
    expect(detail.body.shipBy).toBeTruthy();
    expect(detail.body.transferId).toBeNull(); // visible de l'admin (référence Stripe), aucun virement encore
  });
});
