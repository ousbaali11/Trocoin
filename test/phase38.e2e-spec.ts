import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SHIPPING_PROVIDER } from '../src/shipping/shipping.constants';
import { IShippingProvider } from '../src/shipping/shipping-provider.interface';
import { StripeConnectService } from '../src/users/stripe-connect.service';
import { UsersService } from '../src/users/users.service';
import { createApp, createListing, login } from './utils';

/**
 * Phase 38 (AUDIT §61) :
 *  - « Configurer mon compte de versement » : un refus de Stripe (Connect non activé sur la plateforme, compte connecté
 *    inconnu…) finissait en erreur 500 « Erreur interne » → 503 en français, cause jointe avec des clés de test, compte
 *    invalide remplacé une fois, état du compte lisible même si Stripe ne répond pas ;
 *  - options de réception : tarifs et points demandés en parallèle, gardés en mémoire (l'acheteur n'attend plus la somme
 *    de quatre appels, et rien du tout la deuxième fois).
 */
describe('Phase 38 : compte de versement (refus Stripe) et options de réception sans attente', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  /** Bascule le service en mode Stripe avec un faux client : aucune requête réseau. */
  function fakeStripe(fake: Record<string, unknown>) {
    const svc = app.get(StripeConnectService) as unknown as { mode: string; stripe: unknown; testMode: boolean };
    const before = { mode: svc.mode, stripe: svc.stripe, testMode: svc.testMode };
    Object.assign(svc, { mode: 'stripe', stripe: fake, testMode: true });
    return () => Object.assign(svc, before);
  }
  const stripeError = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { type: 'StripeInvalidRequestError', ...extra });

  it('refus de Stripe → 503 en français (jamais 500), cause jointe en mode test ; compte inconnu → remplacé', async () => {
    const seller = await login(app);
    // 1. Plateforme sans Connect : le message dit que les versements ne sont pas encore ouverts, l'argent reste en sécurité
    let restore = fakeStripe({
      accounts: { create: async () => { throw stripeError("You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect."); } },
      accountLinks: { create: async () => ({ url: 'https://connect.stripe.com/setup/e/x' }) },
    });
    const notReady = await request(server).post('/users/me/stripe-onboarding-link').set(seller.auth);
    expect(notReady.status).toBe(503);
    expect(notReady.body.code).toBe('CONNECT_NOT_READY');
    expect(notReady.body.message).toContain('Votre argent reste en sécurité');
    expect(notReady.body.reason).toContain("signed up for Connect");
    restore();

    // 2. Panne quelconque : message de réessai, pas de détail interne hors mode test
    restore = fakeStripe({ accounts: { create: async () => { throw Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' }); } }, accountLinks: { create: async () => ({ url: 'x' }) } });
    (app.get(StripeConnectService) as unknown as { testMode: boolean }).testMode = false;
    const down = await request(server).post('/users/me/stripe-onboarding-link').set(seller.auth);
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('CONNECT_UNAVAILABLE');
    expect(down.body.reason).toBeUndefined();
    restore();

    // 3. Compte connecté enregistré mais inconnu de Stripe (autres clés, compte effacé) : un nouveau compte est créé
    const created: string[] = [];
    restore = fakeStripe({
      accounts: {
        create: async () => { created.push(`acct_new${created.length + 1}`); return { id: created[created.length - 1] }; },
        retrieve: async () => { throw stripeError('No such account: acct_old', { code: 'resource_missing', statusCode: 404 }); },
      },
      accountLinks: { create: async ({ account }: { account: string }) => { if (account === 'acct_new1') throw stripeError('No such account', { code: 'account_invalid', statusCode: 403 }); return { url: `https://connect.stripe.com/setup/e/${account}` }; } },
    });
    const first = await request(server).post('/users/me/stripe-onboarding-link').set(seller.auth); // crée acct_new1, lien refusé → erreur (compte tout neuf : pas de remplacement en boucle)
    expect(first.status).toBe(503);
    const second = await request(server).post('/users/me/stripe-onboarding-link').set(seller.auth); // acct_new1 enregistré mais invalide → remplacé par acct_new2
    expect(second.status).toBe(201);
    expect(second.body.accountId).toBe('acct_new2');
    expect(second.body.url).toContain('acct_new2');
    // État illisible chez Stripe : la page Paiements reçoit un état, pas une erreur
    const status = await request(server).get('/users/me/stripe-status').set(seller.auth);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ connected: false, onboardingComplete: false });
    restore();
  });

  it('webhook « comptes connectés » (AUDIT §66) : account.updated active le compte de versement et date sa réception, sans visite de la page', async () => {
    const seller = await login(app);
    const restore = fakeStripe({ accounts: { listExternalAccounts: async () => ({ data: [{ last4: '2606' }] }) } });
    try {
      const svc = app.get(StripeConnectService);
      const users = app.get(UsersService);
      await users.setStripeAccount(seller.id, 'acct_hook_1', false);
      const before = await request(server).get('/users/me').set(seller.auth).expect(200);
      expect(before.body.payout).toMatchObject({ complete: false, webhookAt: null });
      await svc.applyAccountUpdate('acct_hook_1', { id: 'acct_hook_1', type: 'custom', payouts_enabled: true, charges_enabled: false, capabilities: { transfers: 'active' }, requirements: { currently_due: [], past_due: [] } } as never);
      const after = await request(server).get('/users/me').set(seller.auth).expect(200);
      expect(after.body.payout).toMatchObject({ complete: true, kind: 'formulaire', ibanLast4: '2606' });
      expect(after.body.payout.webhookAt).toBeTruthy();
      // Compte inconnu : ignoré sans erreur
      await svc.applyAccountUpdate('acct_inconnu', { id: 'acct_inconnu' } as never);
    } finally {
      restore();
    }
  });

  it('options de réception : quatre appels au prestataire en parallèle, puis servis de mémoire', async () => {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { title: 'Enceinte Bluetooth portable noire', weightGrams: 1777 });
    const provider = app.get<IShippingProvider>(SHIPPING_PROVIDER);
    const quote = provider.quote.bind(provider);
    const points = provider.searchRelayPoints.bind(provider);
    let running = 0;
    let peak = 0;
    const calls = { quote: 0, points: 0 };
    const slow = <A extends unknown[], R>(kind: 'quote' | 'points', fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
      calls[kind] += 1;
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 150));
      running -= 1;
      return fn(...a);
    };
    provider.quote = slow('quote', quote) as typeof provider.quote;
    provider.searchRelayPoints = slow('points', points) as typeof provider.searchRelayPoints;
    try {
      const url = `/shipping/pickup-options?listingId=${listing.id}&postalCode=33000`;
      const t0 = Date.now();
      const first = await request(server).get(url).set(buyer.auth); // sans ville : le code postal suffit pour chercher
      const elapsed = Date.now() - t0;
      expect(first.status).toBe(200);
      expect(first.body.carriers).toHaveLength(2);
      expect(first.body.carriers[0].points.length).toBeGreaterThan(0);
      expect(calls).toEqual({ quote: 2, points: 2 });
      expect(peak).toBe(4); // les quatre appels ensemble…
      expect(elapsed).toBeLessThan(550); // … donc ~150 ms au lieu de 4 × 150 ms
      // Deuxième demande (autre acheteur, retour dans la fenêtre, paiement) : aucun nouvel appel au prestataire
      const again = await request(server).get(url).set(seller.auth);
      expect(again.status).toBe(200);
      expect(again.body.carriers).toEqual(first.body.carriers);
      expect(calls).toEqual({ quote: 2, points: 2 });
      // Moitiés indépendantes (la fenêtre d'achat les demande ensemble et affiche chacune dès qu'elle arrive)
      const onlyPoints = await request(server).get(url + '&part=points').set(buyer.auth);
      expect(onlyPoints.body.part).toBe('points');
      expect(onlyPoints.body.carriers[0].points.length).toBeGreaterThan(0);
      expect(onlyPoints.body.carriers[0].pickupPriceCents).toBeUndefined();
      const onlyPrices = await request(server).get(url + '&part=prices').set(buyer.auth);
      expect(onlyPrices.body.part).toBe('prices');
      expect(onlyPrices.body.carriers[0].points).toEqual([]);
      expect(onlyPrices.body.carriers[0].pickupPriceCents).toBeGreaterThan(0);
      expect(calls).toEqual({ quote: 2, points: 2 }); // toujours servies de mémoire
    } finally {
      provider.quote = quote;
      provider.searchRelayPoints = points;
    }
  });
});
