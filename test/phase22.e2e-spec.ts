import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { Notification } from '../src/notifications/notification.entity';
import { MockPaymentProvider } from '../src/payments/mock-payment.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { ESCROW_AUTO_CONFIRM_DAYS, ESCROW_DISPUTE_WINDOW_DAYS, ESCROW_SAFETY_HOURS, PaymentsService } from '../src/payments/payments.service';
import { Transaction } from '../src/payments/transaction.entity';
import { createApp, createListing, login } from './utils';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Phase 22 (AUDIT §37) : une autorisation de carte non capturée expire (7 jours en ligne). Le séquestre
 * ne doit jamais atteindre cette date sans action : réception présumée après l'expédition (rappels
 * 48 h et 24 h avant), capture avant l'échéance si l'article est expédié ou en litige, annulation avec
 * remboursement s'il n'a pas été expédié ni remis. Le temps est simulé en passant `now` à la tâche.
 */
describe('Phase 22 : échéances du séquestre (expiration de l\'autorisation bancaire)', () => {
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
    // Journal des appels au fournisseur de paiement (capture / remboursement)
    const provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    const capture = provider.capture.bind(provider);
    const refund = provider.refund.bind(provider);
    provider.capture = async (id: string) => { calls.push(`capture ${id}`); return capture(id); };
    provider.refund = async (id: string) => { calls.push(`refund ${id}`); return refund(id); };
  });
  afterAll(() => app.close());

  const titlesFor = async (userId: string) => (await notifRepo.find({ where: { userId, type: 'transaction' }, order: { createdAt: 'ASC' } })).map((n) => n.title);
  const buy = async (delivery: 'colissimo' | 'main_propre', price = 60) => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price, deliveryAvailable: delivery !== 'main_propre' });
    const body = delivery === 'main_propre' ? { listingId: listing.id } : { listingId: listing.id, deliveryMethod: delivery, shippingAddress: { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' } };
    const created = await request(server).post('/transactions').set(buyer.auth).send(body).expect(201);
    // Ancien modèle « destination charge » (AUDIT §39) : les ventes créées avant la bascule gardent cette logique
    await txRepo.update(created.body.transaction.id, { escrowModel: 'destination', shipBy: null });
    return { seller, buyer, listing, tx: created.body.transaction as Transaction & { id: string } };
  };

  it('à l\'autorisation, la date limite de capture du fournisseur est enregistrée (7 jours pour une carte) et exposée aux deux parties', async () => {
    const { buyer, tx } = await buy('colissimo');
    const stored = (await txRepo.findOne({ where: { id: tx.id } }))!;
    expect(stored.paidAt).toBeTruthy();
    expect(stored.captureBefore).toBeTruthy();
    const days = (new Date(stored.captureBefore!).getTime() - new Date(stored.paidAt!).getTime()) / DAY;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    const view = await request(server).get(`/transactions/${tx.id}`).set(buyer.auth).expect(200);
    expect(view.body.captureBefore).toBe(new Date(stored.captureBefore!).toISOString());
    expect(view.body.autoConfirmAt).toBeNull();
  });

  it('article expédié, acheteur silencieux : rappel à J-2, dernier avis à J-1, puis réception présumée (capture) avant l\'expiration ; litige encore possible 7 jours', async () => {
    const { seller, buyer, listing, tx } = await buy('colissimo', 80);
    const t0 = Date.now();
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000001' }).expect(201);
    const shipped = (await txRepo.findOne({ where: { id: tx.id } }))!;
    // Réception présumée = expédition + ESCROW_AUTO_CONFIRM_DAYS, plafonnée par la marge de sécurité de l'autorisation (ancien modèle)
    const autoAt = new Date(shipped.autoConfirmAt!).getTime();
    const wanted = new Date(shipped.shippedAt!).getTime() + ESCROW_AUTO_CONFIRM_DAYS * DAY;
    const cap = new Date(shipped.captureBefore!).getTime() - ESCROW_SAFETY_HOURS * HOUR;
    expect(Math.abs(autoAt - Math.min(wanted, cap))).toBeLessThan(5_000);
    expect(autoAt).toBeLessThan(new Date(shipped.captureBefore!).getTime() - ESCROW_SAFETY_HOURS * HOUR + 1000);
    const buyerNotifsBefore = (await titlesFor(buyer.id)).length;

    // Trop tôt : rien
    await payments.runEscrowSchedule(new Date(t0 + 1 * DAY));
    expect((await txRepo.findOne({ where: { id: tx.id } }))!.escrowStage).toBe(0);
    // J-2 : rappel à l'acheteur (une seule fois, même relancée)
    expect((await payments.runEscrowSchedule(new Date(autoAt - 47 * HOUR))).reminders).toBeGreaterThanOrEqual(1);
    const afterReminder = (await titlesFor(buyer.id)).length;
    await payments.runEscrowSchedule(new Date(autoAt - 46 * HOUR));
    expect((await titlesFor(buyer.id)).length).toBe(afterReminder); // pas de doublon
    // J-1 : dernier avis
    expect((await payments.runEscrowSchedule(new Date(autoAt - 23 * HOUR))).notices).toBeGreaterThanOrEqual(1);
    const titles = (await titlesFor(buyer.id)).slice(buyerNotifsBefore);
    expect(titles).toEqual(['Avez-vous bien reçu votre colis ?', 'Dernier rappel : confirmez la réception']);
    expect((await txRepo.findOne({ where: { id: tx.id } }))!.status).toBe('livree'); // toujours en séquestre

    // Échéance de réception présumée : capture, vendeur payé, annonce vendue
    const before = calls.length;
    expect((await payments.runEscrowSchedule(new Date(autoAt + 60_000))).confirmed).toBeGreaterThanOrEqual(1);
    const done = (await txRepo.findOne({ where: { id: tx.id } }))!;
    expect(done.status).toBe('confirme');
    expect(done.autoResolution).toBe('reception_presumee');
    expect(calls.slice(before).filter((c) => c.endsWith(done.providerPaymentId!))).toEqual([`capture ${done.providerPaymentId}`]);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('vendue');
    expect((await titlesFor(seller.id))).toContain('Vente confirmée');
    expect((await titlesFor(buyer.id))).toContain('Réception considérée acquise');
    // Fenêtre de litige après capture automatique : ouverte pour l'acheteur, pas pour le vendeur, puis remboursement par l'admin
    const until = new Date(done.disputeAllowedUntil!).getTime();
    expect(Math.abs(until - (Date.now() + ESCROW_DISPUTE_WINDOW_DAYS * DAY))).toBeLessThan(60_000);
    await request(server).post(`/transactions/${tx.id}/dispute`).set(seller.auth).send({ reason: 'Le vendeur ne peut pas contester après paiement.' }).expect(400);
    await request(server).post(`/transactions/${tx.id}/dispute`).set(buyer.auth).send({ reason: 'Colis reçu vide, je conteste la réception présumée.' }).expect(201);
    expect((await txRepo.findOne({ where: { id: tx.id } }))!.status).toBe('litige');
    const admin = await login(app);
    const { makeAdmin } = await import('./utils');
    await makeAdmin(app, admin);
    const refundCalls = calls.length;
    await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Colis vide confirmé par photos.' }).expect(201);
    expect(calls.slice(refundCalls).filter((c) => c.endsWith(done.providerPaymentId!))).toEqual([`refund ${done.providerPaymentId}`]);
    expect((await txRepo.findOne({ where: { id: tx.id } }))!.status).toBe('rembourse');
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('en_ligne');
    // Une fois la fenêtre passée, plus de litige possible
    const { tx: late } = await buy('colissimo', 20);
    await txRepo.update(late.id, { status: 'confirme', confirmedAt: new Date(), autoResolution: 'reception_presumee', disputeAllowedUntil: new Date(Date.now() - 1000) });
  });

  it('cas limite : expédition tardive, la date de réception présumée dépasserait l\'autorisation → capture 24 h avant l\'expiration, le vendeur est payé', async () => {
    const { seller, buyer, tx } = await buy('colissimo', 120);
    // Le vendeur expédie au 5e jour : réception présumée voulue au 9e jour, mais l'autorisation expire au 7e
    const paidAt = new Date(Date.now() - 5 * DAY);
    const captureBefore = new Date(paidAt.getTime() + 7 * DAY);
    await txRepo.update(tx.id, { paidAt, captureBefore, createdAt: paidAt });
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000002' }).expect(201);
    const shipped = (await txRepo.findOne({ where: { id: tx.id } }))!;
    const deadline = captureBefore.getTime() - ESCROW_SAFETY_HOURS * HOUR;
    expect(new Date(shipped.autoConfirmAt!).getTime()).toBe(deadline); // plafonnée par la marge de sécurité
    // Sans mécanisme, l'autorisation expirerait au 7e jour et le vendeur ne serait jamais payé.
    const before = calls.length;
    const r = await payments.runEscrowSchedule(new Date(deadline + 60_000));
    expect(r.confirmed).toBeGreaterThanOrEqual(1);
    const done = (await txRepo.findOne({ where: { id: tx.id } }))!;
    expect(done.status).toBe('confirme');
    expect(new Date(done.confirmedAt!).getTime()).toBeLessThan(captureBefore.getTime()); // capturé avant l'expiration
    expect(calls.slice(before).filter((c) => c.endsWith(done.providerPaymentId!))).toEqual([`capture ${done.providerPaymentId}`]);
    expect(await titlesFor(buyer.id)).toContain('Réception considérée acquise');
  });

  it('non expédié avant l\'échéance : rappels au vendeur à J-2 et J-1, puis annulation et remboursement de l\'acheteur ; l\'annonce reste en ligne', async () => {
    const { seller, buyer, listing, tx } = await buy('colissimo', 45);
    const stored = (await txRepo.findOne({ where: { id: tx.id } }))!;
    const deadline = new Date(stored.captureBefore!).getTime() - ESCROW_SAFETY_HOURS * HOUR;
    expect((await payments.runEscrowSchedule(new Date(deadline - 47 * HOUR))).reminders).toBeGreaterThanOrEqual(1);
    expect((await payments.runEscrowSchedule(new Date(deadline - 23 * HOUR))).notices).toBeGreaterThanOrEqual(1);
    expect((await titlesFor(seller.id)).filter((t) => /Expédiez avant le|Dernier rappel : expédiez/.test(t))).toHaveLength(2);
    const before = calls.length;
    expect((await payments.runEscrowSchedule(new Date(deadline + 60_000))).cancelled).toBeGreaterThanOrEqual(1);
    const done = (await txRepo.findOne({ where: { id: tx.id } }))!;
    expect(done.status).toBe('annulee');
    expect(done.autoResolution).toBe('annulation_echeance');
    expect(calls.slice(before).filter((c) => c.endsWith(done.providerPaymentId!))).toEqual([`refund ${done.providerPaymentId}`]);
    expect((await request(server).get(`/listings/${listing.id}`).expect(200)).body.status).toBe('en_ligne');
    expect(await titlesFor(buyer.id)).toContain('Achat annulé, remboursement intégral');
    expect(await titlesFor(seller.id)).toContain('Vente annulée (délai dépassé)');
    // Plus rien à faire ensuite (idempotent)
    const again = calls.length;
    await payments.runEscrowSchedule(new Date(deadline + 2 * DAY));
    expect(calls.slice(again).filter((c) => c.endsWith(done.providerPaymentId!))).toEqual([]);
  });

  it('remise en main propre non confirmée : rappels aux deux parties, puis annulation à l\'échéance ; confirmée à temps : rien d\'automatique', async () => {
    const { seller, buyer, tx } = await buy('main_propre', 30);
    const stored = (await txRepo.findOne({ where: { id: tx.id } }))!;
    const deadline = new Date(stored.captureBefore!).getTime() - ESCROW_SAFETY_HOURS * HOUR;
    await payments.runEscrowSchedule(new Date(deadline - 47 * HOUR));
    expect((await titlesFor(seller.id)).some((t) => /Remise à faire avant le/.test(t))).toBe(true);
    expect((await titlesFor(buyer.id)).some((t) => /Rendez-vous à organiser/.test(t))).toBe(true);
    expect((await payments.runEscrowSchedule(new Date(deadline + 1000))).cancelled).toBeGreaterThanOrEqual(1);
    expect((await txRepo.findOne({ where: { id: tx.id } }))!.status).toBe('annulee');

    const second = await buy('main_propre', 30);
    await request(server).post(`/transactions/${second.tx.id}/handover`).set(second.seller.auth).send({ code: second.tx.handoverCode }).expect(201);
    const s2 = (await txRepo.findOne({ where: { id: second.tx.id } }))!;
    const before = calls.length;
    await payments.runEscrowSchedule(new Date(new Date(s2.captureBefore!).getTime() + DAY));
    expect(calls.slice(before).filter((c) => c.endsWith(done.providerPaymentId!))).toEqual([]);
    expect((await txRepo.findOne({ where: { id: second.tx.id } }))!.autoResolution).toBeNull();
  });

  it('litige ouvert à l\'échéance : les fonds sont capturés pour être préservés, le litige reste ouvert et l\'admin peut encore rembourser', async () => {
    const { seller, buyer, tx } = await buy('colissimo', 90);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000003' }).expect(201);
    await request(server).post(`/transactions/${tx.id}/dispute`).set(buyer.auth).send({ reason: 'Objet reçu cassé, photos à disposition.' }).expect(201);
    const stored = (await txRepo.findOne({ where: { id: tx.id } }))!;
    const deadline = new Date(stored.captureBefore!).getTime() - ESCROW_SAFETY_HOURS * HOUR;
    await payments.runEscrowSchedule(new Date(deadline - 30 * HOUR));
    expect((await txRepo.findOne({ where: { id: tx.id } }))!.escrowStage).toBe(0); // le médiateur est saisi : pas de rappel
    const before = calls.length;
    expect((await payments.runEscrowSchedule(new Date(deadline + 1000))).captured).toBeGreaterThanOrEqual(1);
    const done = (await txRepo.findOne({ where: { id: tx.id } }))!;
    expect(done.status).toBe('litige');
    expect(done.autoResolution).toBe('capture_echeance');
    expect(calls.slice(before).filter((c) => c.endsWith(done.providerPaymentId!))).toEqual([`capture ${done.providerPaymentId}`]);
    expect(await titlesFor(buyer.id)).toContain('Fonds mis en sécurité');
    const admin = await login(app);
    const { makeAdmin } = await import('./utils');
    await makeAdmin(app, admin);
    await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Casse avérée, remboursement.' }).expect(201);
    expect(calls[calls.length - 1]).toBe(`refund ${done.providerPaymentId}`);
    expect((await txRepo.findOne({ where: { id: tx.id } }))!.status).toBe('rembourse');
  });

  it('filet de sécurité admin : compteur et liste des séquestres à échéance sous 48 h', async () => {
    const { tx } = await buy('colissimo', 25);
    const admin = await login(app);
    const { makeAdmin } = await import('./utils');
    await makeAdmin(app, admin);
    const dueBefore = (await request(server).get('/admin/transactions?due=1').set(admin.auth).expect(200)).body.items.map((t: any) => t.id);
    expect(dueBefore).not.toContain(tx.id);
    await txRepo.update(tx.id, { captureBefore: new Date(Date.now() + 30 * HOUR) });
    const due = await request(server).get('/admin/transactions?due=1').set(admin.auth).expect(200);
    expect(due.body.items.map((t: any) => t.id)).toContain(tx.id);
    expect(due.body.items.find((t: any) => t.id === tx.id).handoverCode).toBeUndefined();
    const stats = await request(server).get('/admin/stats').set(admin.auth).expect(200);
    expect(stats.body.transactions.escrowDueSoon).toBeGreaterThanOrEqual(1);
    await request(server).get('/admin/transactions?due=2').set(admin.auth).expect(400);
  });
});
