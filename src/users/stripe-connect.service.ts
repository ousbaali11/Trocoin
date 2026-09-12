import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PAYMENT_DISABLED_MESSAGE } from '../payments/disabled-payment.provider';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
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

  constructor(
    private config: ConfigService,
    private usersService: UsersService,
  ) {
    const provider = this.config.get<string>('PAYMENT_PROVIDER') || 'mock';
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (provider === 'stripe' && key) {
      this.stripe = new Stripe(key);
      this.mode = 'stripe';
    } else if (provider === 'disabled') {
      this.mode = 'disabled';
    } else {
      this.mode = 'mock';
    }
  }

  async createOnboardingLink(userId: string): Promise<{ url: string; accountId: string; mode: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const returnUrl =
      this.config.get<string>('STRIPE_CONNECT_RETURN_URL') || 'http://localhost:3001/compte/paiements?stripe=retour';
    const refreshUrl =
      this.config.get<string>('STRIPE_CONNECT_REFRESH_URL') || 'http://localhost:3001/compte/paiements?stripe=rafraichir';

    if (this.mode === 'disabled') throw new ServiceUnavailableException(PAYMENT_DISABLED_MESSAGE);

    if (this.mode === 'mock') {
      const accountId = user.stripeAccountId || `acct_mock_${user.id.slice(0, 8)}`;
      await this.usersService.setStripeAccount(userId, accountId, false);
      this.logger.log(`Onboarding Stripe simulé pour ${userId} (${accountId})`);
      return { url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}mock=1`, accountId, mode: 'mock' };
    }

    const stripe = this.stripe!;
    let accountId = user.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: user.accountType === 'professionnel' ? 'company' : 'individual',
        metadata: { userId: user.id },
      });
      accountId = account.id;
      await this.usersService.setStripeAccount(userId, accountId, false);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return { url: link.url, accountId, mode: 'stripe' };
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

    const account = await this.stripe!.accounts.retrieve(user.stripeAccountId);
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
        "Le vendeur n'a pas terminé la configuration de ses paiements. Contactez-le ou payez en main propre.",
      );
    }
    return seller.stripeAccountId;
  }
}
