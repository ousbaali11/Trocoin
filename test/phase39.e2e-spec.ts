import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { Listing } from '../src/listings/listing.entity';
import { MockPaymentProvider } from '../src/payments/mock-payment.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { Transaction } from '../src/payments/transaction.entity';
import { RetentionService } from '../src/retention/retention.service';
import { buyShipped, createApp, createListing, login, makeAdmin } from './utils';

/**
 * Phase 39 (AUDIT §63) :
 *  - litige : autorisation expirée chez le prestataire → l'admin lit l'état réel, « libérer » est refusé en clair (409),
 *    « annuler » reste possible ; un refus quelconque du prestataire → 502 avec le motif (plus jamais « Erreur interne ») ;
 *  - annonce archivée (et non effacée) à la fin de la vente : invisible pour les membres et le vendeur, consultable par
 *    l'administration, effacée après 90 jours sauf litige ;
 *  - compte de versement en un formulaire (nom, date de naissance, adresse, IBAN) : validation, état, suppression de
 *    compte bloquée tant qu'un versement est dû ;
 *  - failles refermées : export RGPD sans code de remise, fiches admin sans code de remise, numéro de suivi inventé
 *    refusé quand la livraison est prépayée, texte/prix figés pendant une vente, renouvellement limité, suppression
 *    admin refusée pendant une vente, paiement sécurisé à partir de 1 €.
 */
describe('Phase 39 : litiges et prestataire, archivage, versement par IBAN, failles', () => {
  let app: INestApplication;
  let server: any;
  let provider: MockPaymentProvider;
  let transactions: Repository<Transaction>;
  let listings: Repository<Listing>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    transactions = app.get(getRepositoryToken(Transaction));
    listings = app.get(getRepositoryToken(Listing));
  });
  afterAll(() => app.close());

  async function adminUser() {
    const admin = await login(app);
    await makeAdmin(app, admin);
    return admin;
  }
  const handSale = async (seller: any, buyer: any, price = 40) => {
    const listing = await createListing(app, seller, { price, deliveryAvailable: false });
    const res = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'main_propre' }).expect(201);
    return { listing, tx: (res.body.transaction ?? res.body) as Transaction };
  };

  it('autorisation expirée : état réel lu par l\'admin, « libérer » refusé en clair, « annuler » possible', async () => {
    const [seller, buyer, admin] = [await login(app), await login(app), await adminUser()];
    const { tx } = await handSale(seller, buyer);
    const stored = (await transactions.findOne({ where: { id: tx.id } }))!;
    // Le prestataire a annulé l'autorisation (7 jours sans encaissement : API en veille) — le litige s'ouvre quand même…
    provider.forceState(stored.providerPaymentId!, 'annulee');
    const dispute = await request(server).post(`/transactions/${tx.id}/dispute`).set(buyer.auth).send({ reason: 'Le vendeur ne répond plus depuis une semaine.' });
    expect(dispute.status).toBe(409); // …non : l'encaissement est refusé en clair, la vente reste en séquestre
    expect(dispute.body.code).toBe('autorisation_expiree');
    expect(dispute.body.message).toContain("L'autorisation bancaire");
    expect((await transactions.findOne({ where: { id: tx.id } }))!.status).toBe('sequestre');

    const detail = await request(server).get(`/admin/transactions/${tx.id}`).set(admin.auth).expect(200);
    expect(detail.body.provider).toEqual({ state: 'annulee' });
    expect(detail.body.decisions).toEqual(['annuler']);
    const release = await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'liberer', note: 'Tentative de libération' });
    expect(release.status).toBe(409);
    expect(release.body.message).toContain("L'autorisation bancaire");
    const cancel = await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'annuler', note: 'Autorisation expirée : vente annulée, acheteur non débité' }).expect(201);
    expect(cancel.body.status).toBe('annulee');
    // Déjà tranchée : une seconde décision est refusée
    await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Second clic' }).expect(409);
  });

  it('refus quelconque du prestataire → 502 avec le motif ; état inspecté même sans le prestataire', async () => {
    const [seller, buyer, admin] = [await login(app), await login(app), await adminUser()];
    const { tx } = await handSale(seller, buyer);
    await request(server).post(`/transactions/${tx.id}/dispute`).set(buyer.auth).send({ reason: 'Article différent de la description.' }).expect(201);
    const original = provider.refund.bind(provider);
    provider.refund = async () => { throw new Error('rate_limit: Too many requests'); };
    try {
      const res = await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Remboursement décidé' });
      expect(res.status).toBe(502);
      expect(res.body.message).toContain('Le prestataire de paiement a refusé');
      expect((await transactions.findOne({ where: { id: tx.id } }))!.status).toBe('litige'); // rien n'a bougé
    } finally {
      provider.refund = original;
    }
    const ok = await request(server).post(`/admin/transactions/${tx.id}/resolve`).set(admin.auth).send({ decision: 'rembourser', note: 'Remboursement décidé' }).expect(201);
    expect(ok.body.status).toBe('rembourse');
  });

  it('annonce archivée à la fin de la vente : membres 404, vendeur sans elle, admin la lit, effacement différé sauf litige', async () => {
    const [seller, buyer, admin, other] = [await login(app), await login(app), await adminUser(), await login(app)];
    const { listing, tx } = await handSale(seller, buyer);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller.auth).send({}).expect(201);
    const code = (await transactions.findOne({ where: { id: tx.id } }))!.handoverCode!;
    await request(server).post(`/transactions/${tx.id}/handover`).set(seller.auth).send({ code }).expect(201);
    const archived = (await listings.findOne({ where: { id: listing.id } }))!;
    expect(archived.status).toBe('archivee');
    expect(archived.archivedAt).toBeTruthy();
    await request(server).get(`/listings/${listing.id}`).set(other.auth).expect(404);
    await request(server).get(`/listings/${listing.id}`).set(seller.auth).expect(404);
    const mine = await request(server).get('/listings/mine').set(seller.auth).expect(200);
    expect(mine.body.map((l: any) => l.id)).not.toContain(listing.id);
    const adminView = await request(server).get(`/admin/listings/${listing.id}`).set(admin.auth).expect(200);
    expect(adminView.body.status).toBe('archivee');
    expect(adminView.body.title).toBe(listing.title);
    expect(adminView.body.transactions[0].handoverCode).toBeUndefined();
    const adminTx = await request(server).get(`/admin/transactions/${tx.id}`).set(admin.auth).expect(200);
    expect(adminTx.body.listing).toMatchObject({ id: listing.id, status: 'archivee' });
    // Effacement différé : rien avant 90 jours ; après, effacée — sauf si un litige est encore ouvert
    const retention = app.get(RetentionService);
    expect(await retention.purgeArchived()).toBe(0);
    await listings.update(listing.id, { archivedAt: new Date(Date.now() - 100 * 86_400_000) });
    await transactions.update(tx.id, { status: 'litige' });
    expect(await retention.purgeArchived()).toBe(0);
    expect(await listings.findOne({ where: { id: listing.id } })).toBeTruthy();
    await transactions.update(tx.id, { status: 'confirme' });
    expect(await retention.purgeArchived()).toBeGreaterThanOrEqual(1);
    expect(await listings.findOne({ where: { id: listing.id } })).toBeNull();
  });

  it('compte de versement en un formulaire : validations, état, suppression bloquée tant qu\'un versement est dû', async () => {
    const seller = await login(app);
    const base = { firstName: 'Nora', lastName: 'Acheteur', dob: { day: 12, month: 5, year: 1990 }, address: { line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' }, acceptTerms: true };
    const bad = await request(server).post('/users/me/payout-account').set(seller.auth).send({ ...base, iban: 'FR76 1234 5678 9012 3456 7890 999' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('IBAN invalide');
    await request(server).post('/users/me/payout-account').set(seller.auth).send({ ...base, iban: 'FR1420041010050500013M02606', acceptTerms: false }).expect(400);
    await request(server).post('/users/me/payout-account').set(seller.auth).send({ ...base, iban: 'FR1420041010050500013M02606', dob: { day: 1, month: 1, year: 2015 } }).expect(400);
    const ok = await request(server).post('/users/me/payout-account').set(seller.auth).send({ ...base, iban: 'FR14 2004 1010 0505 0001 3M02 606' }).expect(201);
    expect(ok.body).toMatchObject({ connected: true, onboardingComplete: true, kind: 'formulaire', ibanLast4: '2606', requirements: [], needsHostedStep: false });
    const status = await request(server).get('/users/me/stripe-status').set(seller.auth).expect(200);
    expect(status.body).toMatchObject({ onboardingComplete: true, kind: 'formulaire', ibanLast4: '2606' });
    // L'IBAN complet n'est conservé nulle part
    const me = await request(server).get('/users/me').set(seller.auth).expect(200);
    expect(JSON.stringify(me.body)).not.toContain('2004101005');
    // Versement dû sans compte de versement : la suppression du compte est refusée avec le bon message
    const seller2 = await login(app);
    const buyer = await login(app);
    const { tx } = await handSale(seller2, buyer);
    await request(server).post(`/transactions/${tx.id}/ship`).set(seller2.auth).send({}).expect(201);
    const code = (await transactions.findOne({ where: { id: tx.id } }))!.handoverCode!;
    await request(server).post(`/transactions/${tx.id}/handover`).set(seller2.auth).send({ code }).expect(201);
    await transactions.update(tx.id, { transferId: null as any, capturedAt: new Date() });
    const del = await request(server).delete('/users/me').set(seller2.auth);
    expect(del.status).toBe(400);
    expect(del.body.message).toContain('un versement vous est dû');
  });

  it('failles refermées : export sans code de remise, suivi inventé refusé, texte figé, renouvellement limité, suppression admin refusée, prix minimum', async () => {
    const [seller, buyer, admin] = [await login(app), await login(app), await adminUser()];
    // Export RGPD : plus de code de remise ni de référence de paiement
    const { listing, tx } = await handSale(seller, buyer);
    const exp = await request(server).get('/users/me/export').set(seller.auth).expect(200);
    const exported = exp.body.transactions.find((t: any) => t.id === tx.id);
    expect(exported).toBeTruthy();
    expect(exported.handoverCode).toBeUndefined();
    expect(exported.providerPaymentId).toBeUndefined();
    // Texte et prix figés pendant la vente
    const edit = await request(server).patch(`/listings/${listing.id}`).set(seller.auth).send({ title: 'Titre changé après la vente' });
    expect(edit.status).toBe(400);
    expect(edit.body.message).toContain('ne peuvent pas être modifiés');
    // Suppression admin refusée pendant la vente
    const del = await request(server).delete(`/admin/listings/${listing.id}`).set(admin.auth).send({ reason: 'Test' });
    expect(del.status).toBe(400);
    // Livraison prépayée : un numéro de suivi saisi à la main (sans bon d'envoi Trocoin) n'ouvre pas de réception présumée
    const shipped = await buyShipped(app, buyer, (await createListing(app, seller, { title: 'Enceinte Bluetooth portable' })).id, 'colissimo');
    const shippedId = (shipped.transaction ?? shipped).id;
    await request(server).post(`/transactions/${shippedId}/ship`).set(seller.auth).send({ trackingNumber: '1234' }).expect(400); // forme invalide
    await request(server).post(`/transactions/${shippedId}/ship`).set(seller.auth).send({ trackingNumber: '6A00000000999' }).expect(201);
    const manual = (await transactions.findOne({ where: { id: shippedId } }))!;
    expect(manual.status).toBe('livree');
    expect(manual.autoConfirmAt).toBeFalsy();
    // Renouvellement d'une annonce déjà en ligne : pas avant 7 jours
    const fresh = await createListing(app, seller, { title: 'Table basse en chêne massif' });
    const renew = await request(server).post(`/listings/${fresh.id}/renew`).set(seller.auth);
    expect(renew.status).toBe(400);
    expect(renew.body.message).toContain('sept jours');
    // Paiement sécurisé à partir de 1 €
    const cheap = await createListing(app, seller, { title: 'Stylo bille bleu', price: 0.5 });
    const quote = await request(server).get(`/transactions/quote?listingId=${cheap.id}`).set(buyer.auth).expect(200);
    expect(quote.body.eligible).toBe(false);
    expect(quote.body.reason).toContain('1 €');
  });
});
