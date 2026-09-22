import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { Notification } from '../src/notifications/notification.entity';
import { MockPaymentProvider } from '../src/payments/mock-payment.provider';
import { PaymentProviderError } from '../src/payments/payment-provider.interface';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { PaymentsService } from '../src/payments/payments.service';
import { Transaction } from '../src/payments/transaction.entity';
import { createApp, createListing, login, makeAdmin } from './utils';

/**
 * Phase 40 (AUDIT §65) : paiement que le prestataire ne reconnaît plus (« No such payment_intent » : clés d'un autre
 * environnement, donnée effacée chez lui) ou autorisation expirée, rencontré par la tâche périodique → signalé UNE fois sur
 * la vente, administrateurs prévenus, plus jamais retenté ; l'admin lit le signalement, peut annuler (aucun mouvement
 * d'argent possible) ou lever le signalement pour réessayer ; /health compte les ventes signalées.
 */
describe('Phase 40 : paiement inconnu du prestataire — signalé une fois, jamais retenté', () => {
  let app: INestApplication;
  let server: any;
  let payments: PaymentsService;
  let provider: MockPaymentProvider;
  let transactions: Repository<Transaction>;
  let notifications: Repository<Notification>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    payments = app.get(PaymentsService);
    provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    transactions = app.get(getRepositoryToken(Transaction));
    notifications = app.get(getRepositoryToken(Notification));
  });
  afterAll(() => app.close());

  it('virement en attente sur un paiement inconnu : signalé une fois, admin prévenu, retiré de la tâche, puis levé ou annulé par l\'admin', async () => {
    const [seller, buyer, admin] = [await login(app), await login(app), await login(app)];
    await makeAdmin(app, admin);
    const listing = await createListing(app, seller, { price: 40, deliveryAvailable: false });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'main_propre' }).expect(201);
    const txId = (created.body.transaction ?? created.body).id as string;
    // Vente confirmée, encaissée, virement en attente (vendeur sans compte de versement)
    await request(server).post(`/transactions/${txId}/ship`).set(seller.auth).send({}).expect(201);
    const code = (await transactions.findOne({ where: { id: txId } }))!.handoverCode!;
    await request(server).post(`/transactions/${txId}/handover`).set(seller.auth).send({ code }).expect(201);
    await transactions.update(txId, { transferId: null as any, capturedAt: new Date() });
    // Le vendeur obtient son compte de versement : le virement va être tenté… mais le prestataire ne connaît plus le paiement
    await request(server).post('/users/me/stripe-onboarding-link').set(seller.auth).expect(201);
    await request(server).get('/users/me/stripe-status').set(seller.auth).expect(200);
    const originalTransfer = provider.transfer.bind(provider);
    let calls = 0;
    provider.transfer = async () => { calls += 1; throw new PaymentProviderError('paiement_absent', "Paiement pi_ancien inconnu du prestataire (No such payment_intent: 'pi_ancien') : il appartient à un autre environnement ou a été effacé chez lui."); };
    try {
      await payments.runEscrowSchedule();
      expect(calls).toBe(1);
      const flagged = (await transactions.findOne({ where: { id: txId } }))!;
      expect(flagged.status).toBe('confirme');
      expect(flagged.paymentIssue).toContain('virement au vendeur');
      expect(flagged.paymentIssue).toContain('inconnu du prestataire');
      expect(flagged.paymentIssueAt).toBeTruthy();
      // Administrateur prévenu, une fois
      const alerts = await notifications.find({ where: { userId: admin.id } });
      expect(alerts.filter((n) => n.title.includes('paiement inconnu')).length).toBe(1);
      // Plus aucun nouvel essai aux passages suivants (avant : une erreur à chaque réveil du serveur)
      await payments.runEscrowSchedule();
      await payments.runEscrowSchedule();
      expect(calls).toBe(1);
      expect((await notifications.find({ where: { userId: admin.id } })).filter((n) => n.title.includes('paiement inconnu')).length).toBe(1);
      // Visible pour l'admin : fiche, file « à échéance », /health
      const detail = await request(server).get(`/admin/transactions/${txId}`).set(admin.auth).expect(200);
      expect(detail.body.paymentIssue).toContain('inconnu du prestataire');
      const due = await request(server).get('/admin/transactions?due=1').set(admin.auth).expect(200);
      expect(due.body.items.map((t: any) => t.id)).toContain(txId);
      const health = await request(server).get('/health').expect(200);
      expect(health.body.paymentIssues).toBeGreaterThanOrEqual(1);
      // L'admin lève le signalement (clés rétablies) : la tâche réessaie
      const retried = await request(server).post(`/admin/transactions/${txId}/retry-payment`).set(admin.auth).expect(201);
      expect(retried.body.paymentIssue).toBeNull();
      await payments.runEscrowSchedule();
      expect(calls).toBe(2); // retenté, signalé de nouveau
      expect((await transactions.findOne({ where: { id: txId } }))!.paymentIssue).toBeTruthy();
    } finally {
      provider.transfer = originalTransfer;
    }
  });

  it('échéance du séquestre sur un paiement inconnu : signalée, puis « annuler » par l\'admin clôt la vente sans mouvement d\'argent', async () => {
    const [seller, buyer, admin] = [await login(app), await login(app), await login(app)];
    await makeAdmin(app, admin);
    const listing = await createListing(app, seller, { price: 25, deliveryAvailable: false });
    const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'main_propre' }).expect(201);
    const txId = (created.body.transaction ?? created.body).id as string;
    const originalCapture = provider.capture.bind(provider);
    const originalRefund = provider.refund.bind(provider);
    const missing = () => { throw new PaymentProviderError('paiement_absent', "Paiement pi_perdu inconnu du prestataire (No such payment_intent: 'pi_perdu') : il appartient à un autre environnement ou a été effacé chez lui."); };
    provider.capture = async () => missing();
    provider.refund = async () => missing();
    try {
      // Échéance d'encaissement dépassée : la capture échoue → signalement, pas d'erreur répétée
      await payments.runEscrowSchedule(new Date(Date.now() + 2 * 24 * 3_600_000));
      const flagged = (await transactions.findOne({ where: { id: txId } }))!;
      expect(flagged.status).toBe('sequestre');
      expect(flagged.paymentIssue).toContain('échéance du séquestre');
      // L'admin annule : le prestataire ne connaît pas le paiement, rien à rendre, la vente est close et la note le dit
      const detail = await request(server).get(`/admin/transactions/${txId}`).set(admin.auth).expect(200);
      expect(detail.body.decisions).toContain('annuler');
      const cancelled = await request(server).post(`/admin/transactions/${txId}/resolve`).set(admin.auth).send({ decision: 'annuler', note: 'Reste de tests : paiement inconnu, vente annulée' }).expect(201);
      expect(cancelled.body.status).toBe('annulee');
      expect(cancelled.body.resolutionNote).toContain('paiement inconnu du prestataire');
    } finally {
      provider.capture = originalCapture;
      provider.refund = originalRefund;
    }
  });
});
