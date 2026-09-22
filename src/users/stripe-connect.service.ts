import { BadRequestException, HttpException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/notifications.service';
import { payoutSweep } from './payout-sweep';
import { PAYMENT_DISABLED_MESSAGE } from '../payments/disabled-payment.provider';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { resolveSiteUrl } from '../config/env.validation';
import { UsersService } from './users.service';
import { normalizeIban, PayoutAccountDto } from './dto/payout-account.dto';

/** Exigences du prestataire traduites pour le membre ; ce qui n'est pas listé est demandé sur sa page sécurisée. */
const REQUIREMENT_LABELS: Array<[RegExp, string]> = [
  [/verification\.document/, "une pièce d'identité (à fournir sur la page sécurisée du prestataire)"],
  [/verification\.additional_document/, 'un justificatif de domicile (page sécurisée du prestataire)'],
  [/^external_account$/, 'un IBAN'],
  [/\.dob\./, 'votre date de naissance'],
  [/\.address\./, 'votre adresse'],
  [/\.phone$/, 'votre numéro de téléphone'],
  [/\.email$/, 'votre adresse e-mail'],
  [/\.first_name$|\.last_name$/, 'vos nom et prénom'],
  [/^tos_acceptance/, 'votre acceptation des conditions'],
  [/^business_profile/, "la description de l'activité"],
];
export function describeRequirements(codes: string[]): string[] {
  const out = new Set<string>();
  for (const code of codes) {
    const hit = REQUIREMENT_LABELS.find(([re]) => re.test(code));
    out.add(hit ? hit[1] : 'une information complémentaire (page sécurisée du prestataire)');
  }
  return [...out];
}
const needsHosted = (codes: string[]) => codes.some((c) => /verification|additional_document/.test(c) || !REQUIREMENT_LABELS.some(([re]) => re.test(c)));

export interface PayoutStatus {
  connected: boolean;
  onboardingComplete: boolean;
  mode: string;
  kind: 'formulaire' | 'guide' | null;
  ibanLast4: string | null;
  /** Ce que le prestataire demande encore, en français. */
  requirements: string[];
  /** Vrai quand une pièce doit être fournie sur la page sécurisée du prestataire (lien « Compléter la vérification »). */
  needsHostedStep: boolean;
  /** La configuration précédente (compte d'un autre environnement du prestataire, ou effacé) vient d'être remise à zéro : recommencer (AUDIT §67). */
  previousInvalidated?: boolean;
}

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
export class StripeConnectService implements OnApplicationBootstrap {
  private readonly logger = new Logger('StripeConnect');
  private readonly stripe?: Stripe;
  private readonly mode: 'mock' | 'stripe' | 'disabled';
  /** Clé de test : la cause renvoyée par Stripe peut être jointe à la réponse (aucun secret, utile au réglage du compte). */
  private readonly testMode: boolean = false;

  constructor(
    private config: ConfigService,
    private usersService: UsersService,
    private notifications: NotificationsService,
  ) {
    const provider = this.config.get<string>('PAYMENT_PROVIDER') || 'mock';
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (provider === 'stripe' && key) {
      this.stripe = new Stripe(key, { timeout: 20_000, maxNetworkRetries: 2 }); // AUDIT §69
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
      await this.usersService.setPayoutInfo(userId, { payoutAccountKind: 'guide' });
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
        await this.resetOrphanedAccount(userId, accountId, 'lien de configuration');
        accountId = await createAccount();
        return { url: (await createLink(accountId)).url, accountId, mode: 'stripe' };
      }
    } catch (err) {
      throw this.unavailable(err, userId);
    }
  }

  /**
   * Compte de versement orphelin (AUDIT §67) : l'identifiant enregistré n'existe pas pour les clés actuelles (autre
   * environnement du prestataire, compte effacé). Toute référence est effacée, le membre est prévenu, et il peut
   * recommencer sans conflit — au lieu de retenter indéfiniment vers un identifiant mort.
   */
  private async resetOrphanedAccount(userId: string, accountId: string, where: string): Promise<void> {
    await this.usersService.clearStripeAccount(userId);
    payoutSweep.reset += 1;
    this.logger.warn(`Compte de versement ${accountId} de ${userId} inconnu du prestataire (${where}) : référence effacée, configuration à recommencer`);
    await this.notifications.notify(userId, { type: 'transaction', title: 'Compte de versement à reconfigurer', body: "Votre configuration précédente n'est plus valable. Recommencez-la depuis « Paiements » pour recevoir vos versements.", link: '/compte/paiements' }).catch(() => undefined);
  }

  /** Tous les comptes de versement enregistrés sont vérifiés chez le prestataire ; les orphelins sont remis à zéro. */
  @Cron('15 5 * * *')
  async sweepOrphanedAccounts(): Promise<{ checked: number; reset: number; unreachable: number }> {
    const result = { checked: 0, reset: 0, unreachable: 0 };
    if (this.mode !== 'stripe') return result;
    for (const user of await this.usersService.findWithStripeAccount()) {
      result.checked += 1;
      try {
        await this.stripe!.accounts.retrieve(user.stripeAccountId!);
      } catch (err) {
        if (this.isUnknownAccount(err)) {
          await this.resetOrphanedAccount(user.id, user.stripeAccountId!, 'balayage');
          result.reset += 1;
        } else {
          result.unreachable += 1;
        }
      }
    }
    payoutSweep.lastRunAt = new Date().toISOString();
    payoutSweep.checked = result.checked;
    payoutSweep.unreachable = result.unreachable;
    this.logger.log(`Balayage des comptes de versement : ${result.checked} vérifié(s), ${result.reset} orphelin(s) remis à zéro, ${result.unreachable} illisible(s)`);
    return result;
  }

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || this.mode !== 'stripe') return;
    setTimeout(() => this.sweepOrphanedAccounts().catch((e) => this.logger.error(`Balayage des comptes de versement : ${(e as Error).message}`)), 20_000).unref();
  }

  private isUnknownAccount(err: unknown): boolean {
    const e = err as { code?: string; statusCode?: number; message?: string };
    return e?.code === 'account_invalid' || e?.code === 'resource_missing' || /not connected to your platform or does not exist|No such account|does not have access to account|application access may have been revoked/i.test(e?.message || '');
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

  /**
   * Compte de versement en un formulaire (AUDIT §63) : compte « Custom » créé (ou mis à jour) par Trocoin avec les
   * informations saisies sur le site — le membre ne quitte pas Trocoin. L'IBAN part une fois au prestataire ; seuls ses
   * quatre derniers caractères sont gardés. Si le prestataire demande ensuite une pièce d'identité (au-delà de certains
   * volumes), le statut le dit et un lien vers sa page sécurisée ne demande que cette pièce.
   */
  async setupPayoutAccount(userId: string, dto: PayoutAccountDto, ip: string | undefined): Promise<PayoutStatus> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (this.mode === 'disabled') throw new ServiceUnavailableException(PAYMENT_DISABLED_MESSAGE);
    const iban = normalizeIban(dto.iban);
    if (!iban) throw new BadRequestException('IBAN invalide : vérifiez les caractères saisis (27 caractères pour un IBAN français, commençant par FR).');
    const dob = new Date(Date.UTC(dto.dob.year, dto.dob.month - 1, dto.dob.day));
    const age = (Date.now() - dob.getTime()) / (365.25 * 86_400_000);
    if (Number.isNaN(dob.getTime()) || dob.getUTCDate() !== dto.dob.day || age < 18 || age > 120) throw new BadRequestException('Date de naissance invalide (vous devez être majeur).');
    const holder = `${dto.firstName.trim()} ${dto.lastName.trim()}`;
    const phone = (dto.phone || user.phoneNumber || '').replace(/\s+/g, '');

    if (this.mode === 'mock') {
      const accountId = user.stripeAccountId || `acct_mock_${user.id.slice(0, 8)}`;
      await this.usersService.setStripeAccount(userId, accountId, true);
      await this.usersService.setPayoutInfo(userId, { payoutAccountKind: 'formulaire', payoutIbanLast4: iban.slice(-4), payoutRequirements: null });
      this.logger.log(`Compte de versement simulé (formulaire) pour ${userId}`);
      return { connected: true, onboardingComplete: true, mode: 'mock', kind: 'formulaire', ibanLast4: iban.slice(-4), requirements: [], needsHostedStep: false };
    }

    const stripe = this.stripe!;
    const individual: Stripe.AccountCreateParams.Individual = {
      first_name: dto.firstName.trim(),
      last_name: dto.lastName.trim(),
      dob: { day: dto.dob.day, month: dto.dob.month, year: dto.dob.year },
      address: { line1: dto.address.line1.trim(), postal_code: dto.address.postalCode, city: dto.address.city.trim(), country: 'FR' },
      ...(user.email ? { email: user.email } : {}),
      ...(phone ? { phone } : {}),
    };
    const externalAccount = { object: 'bank_account' as const, country: 'FR', currency: 'eur', account_number: iban, account_holder_name: holder, account_holder_type: 'individual' as const };
    void ip;
    // Plateforme établie en France : le prestataire exige que l'identité passe par un « account token » (les conditions y
    // sont attestées : tos_shown_and_accepted) — refus « must create accounts via account tokens » sinon (AUDIT §63).
    const accountToken = () => stripe.tokens.create({ account: { business_type: 'individual', individual, tos_shown_and_accepted: true } });
    try {
      let accountId = user.stripeAccountId;
      let existing: Stripe.Account | null = null;
      if (accountId) {
        existing = await stripe.accounts.retrieve(accountId).catch(async (err) => {
          if (this.isUnknownAccount(err)) {
            await this.resetOrphanedAccount(userId, accountId!, 'formulaire');
            accountId = undefined;
          }
          return null;
        });
      }
      if (existing && existing.type !== 'custom' && user.stripeOnboardingComplete) {
        throw new BadRequestException('Votre compte de versement (parcours guidé) est déjà actif : il ne peut pas être remplacé par le formulaire. Pour le modifier, passez par « Configurer mon compte de versement ».');
      }
      if (existing && existing.type === 'custom') {
        await stripe.accounts.update(accountId!, { account_token: (await accountToken()).id });
        const bank = await stripe.accounts.createExternalAccount(accountId!, { external_account: externalAccount as unknown as string });
        await stripe.accounts.updateExternalAccount(accountId!, bank.id, { default_for_currency: true });
      } else {
        // Compte « guidé » commencé mais jamais terminé, ou aucun compte : un compte « formulaire » le remplace
        const created = await stripe.accounts.create({
          type: 'custom',
          country: 'FR',
          account_token: (await accountToken()).id,
          capabilities: { transfers: { requested: true } },
          external_account: externalAccount as unknown as string,
          business_profile: { mcc: '5399', url: `${resolveSiteUrl()}/vendeurs/${user.id}`, product_description: "Vente d'objets d'occasion entre particuliers sur Trocoin" },
          metadata: { userId: user.id },
        });
        accountId = created.id;
        await this.usersService.setStripeAccount(userId, accountId, false);
      }
      const account = await stripe.accounts.retrieve(accountId!);
      const status = await this.recordAccountState(userId, account, { kind: 'formulaire', ibanLast4: iban.slice(-4) });
      this.logger.log(`Compte de versement (formulaire) ${accountId} pour ${userId} : ${status.onboardingComplete ? 'actif' : `en attente de ${status.requirements.join(', ') || 'validation'}`}`);
      return status;
    } catch (err) {
      throw this.formError(err, userId);
    }
  }

  /** Erreur de saisie signalée par le prestataire → message en français sur le bon champ ; autre refus → 503 en clair. */
  private formError(err: unknown, userId: string) {
    if (err instanceof HttpException) return err;
    const e = err as { type?: string; code?: string; param?: string; message?: string };
    if (e?.type === 'StripeInvalidRequestError' && e.param && !/Connect|platform/i.test(e.message || '')) {
      const field = e.param;
      const label = /account_number|external_account/.test(field) ? 'IBAN refusé par le prestataire : vérifiez-le.' : /dob/.test(field) ? 'Date de naissance refusée par le prestataire.' : /address|postal_code|city/.test(field) ? 'Adresse refusée par le prestataire : vérifiez la rue, le code postal et la ville.' : /phone/.test(field) ? 'Numéro de téléphone refusé par le prestataire.' : /first_name|last_name/.test(field) ? 'Nom ou prénom refusé par le prestataire.' : `Information refusée par le prestataire (${field}).`;
      this.logger.warn(`Compte de versement de ${userId} : ${field} refusé — ${e.message}`);
      return new BadRequestException({ statusCode: 400, code: 'PAYOUT_FIELD', field, message: label, ...(this.testMode ? { reason: e.message } : {}) });
    }
    return this.unavailable(err, userId);
  }

  /** Lit l'état du compte chez le prestataire et le mémorise (complet ? pièces demandées ?). */
  private async recordAccountState(userId: string, account: Stripe.Account, extra: { kind?: 'formulaire' | 'guide'; ibanLast4?: string } = {}): Promise<PayoutStatus> {
    const codes = [...(account.requirements?.currently_due ?? []), ...(account.requirements?.past_due ?? [])];
    const transfersActive = account.capabilities?.transfers === 'active';
    const complete = !!account.payouts_enabled && (transfersActive || !!account.charges_enabled);
    const kind = extra.kind ?? (account.type === 'custom' ? 'formulaire' : 'guide');
    let ibanLast4 = extra.ibanLast4 ?? null;
    if (!ibanLast4) {
      try {
        const banks = await this.stripe!.accounts.listExternalAccounts(account.id, { object: 'bank_account', limit: 1 });
        ibanLast4 = (banks.data[0] as { last4?: string } | undefined)?.last4 ?? null;
      } catch {
        ibanLast4 = null;
      }
    }
    await this.usersService.setStripeAccount(userId, account.id, complete);
    await this.usersService.setPayoutInfo(userId, { payoutAccountKind: kind, payoutIbanLast4: ibanLast4, payoutRequirements: codes });
    return { connected: true, onboardingComplete: complete, mode: 'stripe', kind, ibanLast4, requirements: describeRequirements(codes), needsHostedStep: !complete && needsHosted(codes) };
  }

  /** Webhook `account.updated` du prestataire (AUDIT §63) : l'état du compte de versement suit sans visite de la page. */
  async applyAccountUpdate(accountId: string, account: Stripe.Account): Promise<void> {
    const user = await this.usersService.findByStripeAccount(accountId);
    if (!user) return;
    const before = user.stripeOnboardingComplete;
    // AUDIT §69 : les évènements ne sont pas garantis dans l'ordre — l'état courant est relu chez le prestataire quand c'est possible
    if (this.stripe) {
      try {
        account = await this.stripe.accounts.retrieve(accountId);
      } catch {
        /* prestataire injoignable : le contenu de l'évènement fait foi */
      }
    }
    const status = await this.recordAccountState(user.id, account);
    await this.usersService.setPayoutInfo(user.id, { payoutWebhookAt: new Date() });
    this.logger.log(`account.updated reçu pour ${accountId} (membre ${user.id}) : ${status.onboardingComplete ? 'actif' : 'en attente'}${status.requirements.length ? ` — manque ${status.requirements.join(', ')}` : ''}`);
    if (status.onboardingComplete && !before) this.logger.log(`Compte de versement ${accountId} activé pour ${user.id}`);
  }

  /** Suppression du compte Trocoin : le compte de versement est fermé chez le prestataire quand c'est possible (au mieux). */
  async closeAccount(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user?.stripeAccountId || this.mode !== 'stripe') return;
    try {
      await this.stripe!.accounts.del(user.stripeAccountId);
      this.logger.log(`Compte de versement ${user.stripeAccountId} fermé (suppression du compte ${userId})`);
    } catch (e) {
      this.logger.warn(`Compte de versement ${user.stripeAccountId} non fermé (${(e as Error).message}) : à fermer à la main`);
    }
  }

  async refreshStatus(userId: string): Promise<PayoutStatus> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const known = (): PayoutStatus => {
      const codes: string[] = user.payoutRequirements ? JSON.parse(user.payoutRequirements) : [];
      return { connected: !!user.stripeAccountId, onboardingComplete: !!user.stripeOnboardingComplete, mode: this.mode, kind: user.payoutAccountKind ?? null, ibanLast4: user.payoutIbanLast4 ?? null, requirements: describeRequirements(codes), needsHostedStep: !user.stripeOnboardingComplete && needsHosted(codes) };
    };
    if (!user.stripeAccountId) return { ...known(), connected: false, onboardingComplete: false };

    if (this.mode === 'mock') {
      // En mock, le retour de l'utilisateur vaut validation du KYC simulé
      await this.usersService.setStripeAccount(userId, user.stripeAccountId, true);
      if (!user.payoutAccountKind) await this.usersService.setPayoutInfo(userId, { payoutAccountKind: 'guide' });
      return { ...known(), connected: true, onboardingComplete: true, kind: user.payoutAccountKind ?? 'guide', mode: 'mock' };
    }

    // Stripe injoignable ou compte inconnu : l'état connu est rendu tel quel plutôt qu'une erreur 500 sur la page Paiements
    let account: Stripe.Account;
    try {
      account = await this.stripe!.accounts.retrieve(user.stripeAccountId);
    } catch (err) {
      this.logger.warn(`État du compte de versement de ${userId} illisible : ${(err as Error).message}`);
      if (this.isUnknownAccount(err)) {
        await this.resetOrphanedAccount(userId, user.stripeAccountId, 'état');
        return { connected: false, onboardingComplete: false, mode: 'stripe', kind: null, ibanLast4: null, requirements: [], needsHostedStep: false, previousInvalidated: true };
      }
      return known();
    }
    return this.recordAccountState(userId, account, user.payoutIbanLast4 ? { ibanLast4: user.payoutIbanLast4 } : {});
  }

  /** Utilisé par PaymentsService : identifiant du compte connecté prêt à recevoir des fonds. */
  async getPayableAccountId(sellerId: string): Promise<string | undefined> {
    const seller = await this.usersService.findById(sellerId);
    if (!seller?.stripeAccountId) return undefined;
    // AUDIT §63 : compte commencé mais non terminé = pas encore de compte (le virement attend, l'achat reste possible) —
    // avant, toutes les annonces du vendeur devenaient inachetables (400 après « Payer »)
    if (this.mode === 'stripe' && !seller.stripeOnboardingComplete) return undefined;
    return seller.stripeAccountId;
  }
}
