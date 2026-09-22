import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { MockPaymentProvider } from '../src/payments/mock-payment.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payments.constants';
import { PaymentsService } from '../src/payments/payments.service';
import { payoutTrace } from '../src/payments/payout-trace';
import { isIdempotencyConflict, StripePaymentProvider, transferIdempotencyKey } from '../src/payments/stripe-payment.provider';
import { Transaction } from '../src/payments/transaction.entity';
import { createApp, createListing, login } from './utils';

/**
 * Phase 42 (AUDIT §70) : virement au vendeur bloqué par une clé d'idempotence en conflit.
 * La clé fixe `payout-<vente>` refusait toute nouvelle tentative dès qu'un paramètre changeait (compte de versement remplacé
 * après la remise à zéro d'un compte orphelin, libellé différent selon le chemin d'appel) : « Keys for idempotent requests
 * can only be used with the same parameters » à chaque passage, sans fin. Désormais : clé liée aux paramètres, virement
 * existant réutilisé, conflit résolu par une nouvelle clé (une fois), libellé stable, trace dans /health.
 */
describe('Phase 42 : clé d\'idempotence de virement et reprise', () => {
  /** Faux client Stripe : mémorise les clés d'idempotence comme le vrai (même clé + autres paramètres → refus). */
  function fakeStripe(seed: { transfers?: Array<{ id: string; reversed: boolean }>; keys?: Record<string, string> } = {}) {
    const keys = new Map<string, string>(Object.entries(seed.keys ?? {}));
    const transfers = [...(seed.transfers ?? [])];
    const created: Array<{ key: string; destination: string; description?: string }> = [];
    const stripe = {
      paymentIntents: { retrieve: async (id: string) => ({ id, status: 'succeeded', latest_charge: 'ch_1' }) },
      transfers: {
        list: async () => ({ data: transfers }),
        create: async (body: { destination: string; description?: string; amount: number }, opts: { idempotencyKey: string }) => {
          const fingerprint = JSON.stringify(body);
          const seen = keys.get(opts.idempotencyKey);
          if (seen && seen !== fingerprint) {
            throw Object.assign(new Error(`Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${opts.idempotencyKey}' if you meant to execute a different request.`), { type: 'StripeIdempotencyError' });
          }
          keys.set(opts.idempotencyKey, fingerprint);
          created.push({ key: opts.idempotencyKey, destination: body.destination, description: body.description });
          const id = `tr_${created.length}`;
          transfers.push({ id, reversed: false });
          return { id };
        },
      },
    };
    return { stripe, created, keys };
  }
  const provider = () => {
    const p = new StripePaymentProvider({ get: (k: string) => (k === 'STRIPE_SECRET_KEY' ? 'sk_test_fictive' : undefined) } as unknown as ConfigService);
    return p;
  };
  const withStripe = (p: StripePaymentProvider, stripe: unknown) => Object.assign(p as unknown as { stripe: unknown }, { stripe });
  const params = (destination: string, description = 'Trocoin · vente 48b57551') => ({ providerPaymentId: 'pi_1', sellerConnectedAccountId: destination, amountEuros: 34.96, transactionId: '48b57551-c1a9-4476-aa93-2bfa66b23d95', description });

  it('clé liée aux paramètres : même vente + même compte → même clé ; compte de versement changé → autre clé, aucun conflit', async () => {
    expect(transferIdempotencyKey('t1', 'acct_a', 3496, 'ch_1')).toBe(transferIdempotencyKey('t1', 'acct_a', 3496, 'ch_1'));
    expect(transferIdempotencyKey('t1', 'acct_a', 3496, 'ch_1')).not.toBe(transferIdempotencyKey('t1', 'acct_b', 3496, 'ch_1'));
    expect(transferIdempotencyKey('t1', 'acct_a', 3496, 'ch_1')).toMatch(/^payout-t1-[0-9a-f]{16}$/);
    const f = fakeStripe();
    const p = withStripe(provider(), f.stripe);
    // Première tentative vers le compte orphelin (avant sa remise à zéro), puis le vendeur reconfigure un nouveau compte
    const first = await p.transfer(params('acct_orphelin'));
    f.stripe.transfers.list = async () => ({ data: [] }); // (le premier virement est supposé absent : simulation d'un refus enregistré)
    const second = await p.transfer(params('acct_nouveau'));
    expect(first.transferId).not.toBe(second.transferId);
    expect(f.created.map((c) => c.key)).toHaveLength(2);
    expect(f.created[0].key).not.toBe(f.created[1].key);
  });

  it('ancienne clé fixe déjà utilisée avec d\'autres paramètres (cas de production) → nouvelle clé, virement créé, conflit compté', async () => {
    const before = payoutTrace.keyConflicts;
    const key = transferIdempotencyKey('48b57551-c1a9-4476-aa93-2bfa66b23d95', 'acct_nouveau', 3496, 'ch_1');
    // Stripe connaît déjà cette clé avec d'autres paramètres (libellé avec le titre, autre destination…)
    const f = fakeStripe({ keys: { [key]: 'autres paramètres' } });
    const p = withStripe(provider(), f.stripe);
    const done = await p.transfer(params('acct_nouveau'));
    expect(done.transferId).toBe('tr_1');
    expect(f.created[0].key).toMatch(new RegExp(`^${key}-r\\d+$`));
    expect(payoutTrace.keyConflicts).toBe(before + 1);
    // Une tentative suivante (réponse perdue) retrouve le virement existant : rien n'est recréé
    const again = await p.transfer(params('acct_nouveau'));
    expect(again.transferId).toBe('tr_1');
    expect(f.created).toHaveLength(1);
  });

  it('virement déjà présent chez le prestataire (réponse perdue) → réutilisé ; un virement annulé (reversed) ne compte pas', async () => {
    const f = fakeStripe({ transfers: [{ id: 'tr_annule', reversed: true }, { id: 'tr_ok', reversed: false }] });
    const p = withStripe(provider(), f.stripe);
    expect((await p.transfer(params('acct_x'))).transferId).toBe('tr_ok');
    expect(f.created).toHaveLength(0);
    expect(await p.findTransfer('48b57551-c1a9-4476-aa93-2bfa66b23d95')).toBe('tr_ok');
    const onlyReversed = withStripe(provider(), fakeStripe({ transfers: [{ id: 'tr_annule', reversed: true }] }).stripe);
    expect(await onlyReversed.findTransfer('x')).toBeNull();
    expect(isIdempotencyConflict({ type: 'StripeIdempotencyError' })).toBe(true);
    expect(isIdempotencyConflict(new Error('Keys for idempotent requests can only be used with the same parameters'))).toBe(true);
    expect(isIdempotencyConflict(new Error('balance_insufficient'))).toBe(false);
  });

  describe('service : libellé stable et virement en attente repris, trace dans /health', () => {
    let app: INestApplication;
    let server: any;
    let mock: MockPaymentProvider;
    let transactions: Repository<Transaction>;
    let payments: PaymentsService;

    beforeAll(async () => {
      app = await createApp();
      server = app.getHttpServer();
      mock = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
      transactions = app.get(getRepositoryToken(Transaction));
      payments = app.get(PaymentsService);
    });
    afterAll(() => app.close());

    it('le libellé du virement ne dépend pas du chemin d\'appel ; un refus du prestataire est retenté au passage suivant sans bloquer', async () => {
      const seller = await login(app);
      const buyer = await login(app);
      const listing = await createListing(app, seller, { price: 40, deliveryAvailable: false, title: 'Lampe de chevet en laiton' });
      const created = await request(server).post('/transactions').set(buyer.auth).send({ listingId: listing.id, deliveryMethod: 'main_propre' }).expect(201);
      const tx = (created.body.transaction ?? created.body) as Transaction;
      // Compte de versement du vendeur (simulation) — puis le prestataire refuse une fois le virement (clé en conflit)
      await request(server).post('/users/me/stripe-onboarding-link').set(seller.auth).expect(201);
      await request(server).get('/users/me/stripe-status').set(seller.auth).expect(200);
      const seen: string[] = [];
      const original = mock.transfer.bind(mock);
      let fail = true;
      mock.transfer = async (p) => {
        seen.push(p.description || '');
        if (fail) {
          fail = false;
          throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'payout-x'."), { type: 'StripeIdempotencyError' });
        }
        return original(p);
      };
      try {
        await request(server).post(`/transactions/${tx.id}/confirm-delivery`).set(buyer.auth).expect(201);
        let stored = (await transactions.findOne({ where: { id: tx.id } }))!;
        expect(stored.status).toBe('confirme');
        expect(stored.transferId).toBeNull(); // refus : la vente est confirmée, le virement reste en attente
        expect(payoutTrace.lastError).toContain('idempotent requests');
        const r = await payments.runEscrowSchedule(new Date());
        expect(r.transferred).toBe(1);
        stored = (await transactions.findOne({ where: { id: tx.id } }))!;
        expect(stored.transferId).toMatch(/^mock_tr_/);
        // Même libellé aux deux tentatives (chemin « confirmation » puis chemin « tâche périodique »), sans le titre
        expect(seen).toHaveLength(2);
        expect(seen[0]).toBe(seen[1]);
        expect(seen[0]).toBe(`Trocoin · vente ${tx.id.slice(0, 8)}`);
      } finally {
        mock.transfer = original;
      }
    });
  });
});
