import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PAYMENT_DISABLED_MESSAGE } from '../payments/disabled-payment.provider';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { resolveSiteUrl } from '../config/env.validation';
import { UsersService } from './users.service';

/**
 * Onboarding vendeur Stripe Connect (comptes "Express").
 *
 * Flux :
 *  1. POST /users/me/stripe-onboarding-link -> crée le compte Connect si
 *     besoin (stripeAccountId stocké sur User) et renvoie une URL Stripe.
 *  2. L'utilisateur complète le KYC chez Stripe puis revient sur
 *     STRIPE_CONNECT_RETURN_URL.
 *  3. GET /users/me/stripe-status -> relit le compte chez Stripe et met à
 *     jour stripeOnboardingComplete (charges_enabled && payouts_enabled).
 *  4. PaymentsService transmet stripeAccountId comme sellerConnectedAccountId
 *     au moment de créer le PaymentIntent (destination charge).
 *
 * Avec PAYMENT_PROVIDER=mock, le service simule le flux pour permettre de
 * tester l'interface sans clé Stripe. Le mode réel n'a PAS pu être exécuté
 * dans cet environnement (aucune clé, pas d'accès à api.stripe.com) —
 * voir AUDIT.md.
 */
@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger('StripeConnect');
  private readonly stripe?: Stripe;
  private readonly mode: 'mock' | 'stripe' | 'disabled';
  /** Clé de test : la cause renvoyée par Stripe peut être jointe à la réponse (aucun secret, utile au réglage du compte). */
  private readonly testMode: boolean = false;

  constructor(
    private config: ConfigService,
    private usersService: UsersService,
  ) {
    const provider = this.config.get<string>('PAYMENT_PROVIDER') || 'mock';
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (provider === 'stripe' && key) {
      this.stripe = new Stripe(key);
      this.mode = 'stripe';
      this.testMode = key.startsWith('sk_test_') || key.startsWith('rk_test_');
    } else if (provider === 'disabled') {
      this.mode = 'disabled';
    } else {
      this.mode = 'mock';
    }
  }

  async createOnboardingLink(userId: string): Promise<{ url: string; accountId: string; mode: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const returnUrl = this.config.get<string>('STRIPE_CONNECT_RETURN_URL') || `${resolveSiteUrl()}/compte/paiements?stripe=retour`;
    const refreshUrl = this.config.get<string>('STRIPE_CONNECT_REFRESH_URL') || `${resolveSiteUrl()}/compte/paiements?stripe=rafraichir`;

    if (this.mode === 'disabled') throw new ServiceUnavailableException(PAYMENT_DISABLED_MESSAGE);

    if (this.mode === 'mock') {
      const accountId = user.stripeAccountId || `acct_mock_${user.id.slice(0, 8)}`;
      await this.usersService.setStripeAccount(userId, accountId, false);
      this.logger.log(`Onboarding Stripe simulé pour ${userId} (${accountId})`);
      return { url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}mock=1`, accountId, mode: 'mock' };
    }

    const stripe = this.stripe!;
    const createAccount = async () => {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: user.accountType === 'professionnel' ? 'company' : 'individual',
        metadata: { userId: user.id },
      });
      await this.usersService.setStripeAccount(userId, account.id, false);
      return account.id;
    };
    const createLink = (account: string) => stripe.accountLinks.create({ account, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });

    // AUDIT §61 : un refus de Stripe (Connect non activé sur la plateforme, profil de plateforme incomplet, compte
    // connecté effacé ou créé avec d'autres clés…) remontait en erreur 500 « Erreur interne ». Il est maintenant journalisé
    // et rendu en clair ; un identifiant de compte devenu invalide est remplacé une fois.
    try {
      let accountId = user.stripeAccountId || (await createAccount());
      try {
        return { url: (await createLink(accountId)).url, accountId, mode: 'stripe' };
      } catch (err) {
        if (!this.isUnknownAccount(err) || !user.stripeAccountId) throw err;
        this.logger.warn(`Compte Connect ${accountId} inconnu de Stripe pour ${userId} : un nouveau compte est créé`);
        accountId = await createAccount();
        return { url: (await createLink(accountId)).url, accountId, mode: 'stripe' };
      }
    } catch (err) {
      throw this.unavailable(err, userId);
    }
  }

  private isUnknownAccount(err: unknown): boolean {
    const e = err as { code?: string; statusCode?: number; message?: string };
    return e?.code === 'account_invalid' || e?.code === 'resource_missing' || (e?.statusCode === 403 && /does not have access to account|application access may have been revoked/i.test(e?.message || ''));
  }

  /** Refus de Stripe → 503 en français ; la cause exacte est journalisée, et jointe à la réponse avec des clés de test. */
  private unavailable(err: unknown, userId: string): ServiceUnavailableException {
    const e = err as { type?: string; code?: string; message?: string; statusCode?: number };
    const cause = `${e?.type || 'erreur'}${e?.code ? ` / ${e.code}` : ''} : ${e?.message || String(err)}`;
    this.logger.error(`Compte de versement de ${userId} : refus de Stripe — ${cause}`);
    const platform = /signed up for Connect|platform profile|platform-profile|managing losses|responsibilities|Connect/i.test(e?.message || '') && e?.type !== 'StripeConnectionError';
    return new ServiceUnavailableException({
      statusCode: 503,
      code: platform ? 'CONNECT_NOT_READY' : 'CONNECT_UNAVAILABLE',
      message: platform
        ? "Les versements ne sont pas encore ouverts sur Trocoin : la configuration du prestataire de paiement est en cours de finalisation. Votre argent reste en sécurité, il vous sera versé dès l'ouverture — réessayez un peu plus tard."
        : "Le service de versement ne répond pas pour le moment. Votre argent reste en sécurité : réessayez dans quelques minutes.",
      ...(this.testMode ? { reason: cause.slice(0, 400) } : {}),
    });
  }

  async refreshStatus(userId: string): Promise<{ connected: boolean; onboardingComplete: boolean; mode: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (!user.stripeAccountId) return { connected: false, onboardingComplete: false, mode: this.mode };

    if (this.mode === 'mock') {
      // En mock, le retour de l'utilisateur vaut validation du KYC simulé
      await this.usersService.setStripeAccount(userId, user.stripeAccountId, true);
      return { connected: true, onboardingComplete: true, mode: 'mock' };
    }

    // Stripe injoignable ou compte inconnu : l'état connu est rendu tel quel plutôt qu'une erreur 500 sur la page Paiements
    let account: Stripe.Account;
    try {
      account = await this.stripe!.accounts.retrieve(user.stripeAccountId);
    } catch (err) {
      this.logger.warn(`État du compte de versement de ${userId} illisible : ${(err as Error).message}`);
      if (this.isUnknownAccount(err)) {
        return { connected: false, onboardingComplete: false, mode: 'stripe' };
      }
      return { connected: true, onboardingComplete: !!user.stripeOnboardingComplete, mode: 'stripe' };
    }
    const complete = !!(account.charges_enabled && account.payouts_enabled);
    await this.usersService.setStripeAccount(userId, user.stripeAccountId, complete);
    return { connected: true, onboardingComplete: complete, mode: 'stripe' };
  }

  /** Utilisé par PaymentsService : identifiant du compte connecté prêt à recevoir des fonds. */
  async getPayableAccountId(sellerId: string): Promise<string | undefined> {
    const seller = await this.usersService.findById(sellerId);
    if (!seller?.stripeAccountId) return undefined;
    if (this.mode === 'stripe' && !seller.stripeOnboardingComplete) {
      throw new BadRequestException(
        "Le vendeur n'a pas terminé la configuration de son compte de versement. Contactez-le ou payez en main propre.",
      );
    }
    return seller.stripeAccountId;
  }
}
