import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { paymentEnvironmentTrace } from '../src/payments/environment-trace';
import { MockPaymentProvider } from '../src/payments/mock-payment.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { PaymentsService } from '../src/payments/payments.service';
import { Transaction } from '../src/payments/transaction.entity';
import { buyShipped, createApp, createListing, login, makeAdmin, type TestUser } from './utils';

/**
 * Phase 44 (AUDIT §73) : séquelles d'un changement d'environnement du prestataire de paiement. Deux incidents (§65, §67, §70)
 * venaient d'identifiants créés dans un ancien environnement et retrouvés un par un par des échecs silencieux. Désormais :
 * empreinte de l'environnement comparée au démarrage (ventes ouvertes vérifiées d'un coup, administration prévenue), page de
 * paiement inconnue signalée au lieu d'annulée en silence, annulation de virement impossible notifiée.
 */
describe('Phase 44 : changement d\'environnement du prestataire de paiement', () => {
  let app: INestApplication;
  let server: any;
  let transactions: Repository<Transaction>;
  let payments: PaymentsService;
  let provider: MockPaymentProvider;
  let admin: TestUser;
  let seller: TestUser;
  let buyer: TestUser;

  const adminNotifications = async (title: string) => {
    const res = await request(server).get('/notifications').set(admin.auth).expect(200);
    const items: Array<{ title: string; body: string }> = res.body.items ?? res.body;
    return items.filter((n) => n.title === title);
  };
  const sale = async () => {
    const listing = await createListing(app, seller, { price: 40 });
    const body = await buyShipped(app, buyer, listing.id);
    const tx = await transactions.findOne({ where: { id: (body.transaction ?? body).id } });
    expect(tx!.status).toBe('sequestre');
    return tx!;
  };

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    transactions = app.get(getRepositoryToken(Transaction));
    payments = app.get(PaymentsService);
    provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    admin = await login(app);
    await makeAdmin(app, admin);
    seller = await login(app);
    buyer = await login(app);
  });
  afterAll(async () => { await app.close(); });

  it('empreinte mémorisée au premier contrôle ; changement de compte plateforme → ventes ouvertes vérifiées, celle d\'un autre environnement signalée, administration prévenue, /health le montre', async () => {
    provider.fingerprint = { id: 'acct_mock_platform', livemode: false };
    const first = await payments.checkPaymentEnvironment();
    expect(first.accountLast4).toBe('form');
    expect(first.changedAt).toBeNull();
    // Deux ventes ouvertes : l'une créée par le prestataire courant, l'autre portant un identifiant d'un ancien environnement
    const known = await sale();
    const foreign = await sale();
    await transactions.update(foreign.id, { providerPaymentId: 'pi_ancien_environnement' });
    // Même environnement : rien ne bouge
    const same = await payments.checkPaymentEnvironment();
    expect(same.changedAt).toBeNull();
    expect((await transactions.findOne({ where: { id: foreign.id } }))!.paymentIssue).toBeNull();
    // Clés d'un autre environnement (autre compte plateforme)
    provider.fingerprint = { id: 'acct_nouveau_bac_a_sable', livemode: false };
    const changed = await payments.checkPaymentEnvironment();
    expect(changed.changedAt).not.toBeNull();
    expect(changed.previousLast4).toBe('form');
    expect(changed.accountLast4).toBe('able');
    expect(changed.sweep).toMatchObject({ flagged: 1 });
    expect(changed.sweep!.checked).toBeGreaterThanOrEqual(2);
    const flagged = (await transactions.findOne({ where: { id: foreign.id } }))!;
    expect(flagged.paymentIssue).toMatch(/changement d'environnement/);
    expect(flagged.status).toBe('sequestre'); // rien d'annulé ni de remboursé : à trancher par l'administration
    expect((await transactions.findOne({ where: { id: known.id } }))!.paymentIssue).toBeNull();
    const alerts = await adminNotifications('Environnement du prestataire de paiement changé');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toMatch(/1 signalée/);
    const health = await request(server).get('/health').expect(200);
    expect(health.body.paymentEnvironment).toMatchObject({ accountLast4: 'able', previousLast4: 'form', livemode: false });
    expect(health.body.paymentEnvironment.changedAt).toBe(changed.changedAt);
    expect(JSON.stringify(health.body)).not.toContain('acct_nouveau'); // jamais l'identifiant complet
    // Nouveau démarrage dans le même environnement : le changement n'est pas rejoué (une seule alerte, un seul balayage)
    const sweepAt = changed.sweep!.at;
    const again = await payments.checkPaymentEnvironment();
    expect(again.sweep!.at).toBe(sweepAt);
    expect(await adminNotifications('Environnement du prestataire de paiement changé')).toHaveLength(1);
    expect(paymentEnvironmentTrace.error).toBeNull();
  });

  it('page de paiement d\'un autre environnement : signalée à l\'administration une seule fois, la vente reste « en attente » (pas annulée en silence) et n\'est plus relue', async () => {
    const tx = await sale();
    await transactions.update(tx.id, { status: 'en_attente', providerPaymentId: 'cs_ancien_environnement', createdAt: new Date(Date.now() - 3 * 3_600_000) });
    const before = (await adminNotifications('Vente à traiter : paiement inconnu du prestataire')).length;
    await payments.expirePendingCheckouts();
    let after = (await transactions.findOne({ where: { id: tx.id } }))!;
    expect(after.status).toBe('en_attente');
    expect(after.paymentIssue).toMatch(/relecture de la page de paiement/);
    expect((await adminNotifications('Vente à traiter : paiement inconnu du prestataire')).length).toBe(before + 1);
    // Retour de l'acheteur et passage suivant de la tâche : aucun nouvel appel au prestataire, aucune seconde alerte
    await request(server).get(`/transactions/${tx.id}`).set(buyer.auth).expect(200);
    await payments.expirePendingCheckouts();
    after = (await transactions.findOne({ where: { id: tx.id } }))!;
    expect(after.status).toBe('en_attente');
    expect((await adminNotifications('Vente à traiter : paiement inconnu du prestataire')).length).toBe(before + 1);
    // L'administration tranche : « annuler » ferme la vente sans mouvement d'argent possible (comme pour un paiement absent)
    const res = await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'annuler', note: 'Page de paiement d\'un ancien environnement' });
    expect([200, 201]).toContain(res.status);
    expect((await transactions.findOne({ where: { id: tx.id } }))!.status).toBe('annulee');
  });

  it('remboursement après virement : virement d\'un autre environnement impossible à annuler → acheteur remboursé quand même, administration prévenue de récupérer la somme', async () => {
    const tx = await sale();
    await transactions.update(tx.id, { status: 'litige', capturedAt: new Date(), transferId: 'tr_ancien_environnement', transferredAt: new Date() });
    const res = await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Litige tranché en faveur de l\'acheteur' });
    expect([200, 201]).toContain(res.status);
    const after = (await transactions.findOne({ where: { id: tx.id } }))!;
    expect(after.status).toBe('rembourse');
    const alerts = await adminNotifications('Virement au vendeur à récupérer à la main');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain('tr_ancien_environnement');
  });
});
