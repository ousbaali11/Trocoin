import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Between, In, IsNull, LessThan, Like, MoreThan, Not, Repository } from 'typeorm';
import { resolveSiteUrl } from '../config/env.validation';
import { Listing } from '../listings/listing.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ConversationsService } from '../conversations/conversations.service';
import { SystemEvent } from '../conversations/message.entity';
import { RetentionService } from '../retention/retention.service';
import { DEFAULT_FEE_RATES, FeeRates, SettingsService } from '../settings/settings.service';
import { Shipment } from '../shipping/shipment.entity';
import { ShippingCarrier } from '../shipping/shipping-provider.interface';
import { ShippingService } from '../shipping/shipping.service';
import { carrierTrackingUrl } from '../shipping/tracking-url';
import { StripeConnectService } from '../users/stripe-connect.service';
import { UsersService } from '../users/users.service';
import { CheckoutSync, IPaymentProvider, PaymentProviderError, PaymentState } from './payment-provider.interface';
import { CHECKOUT_TTL_MINUTES, PAYMENT_PROVIDER } from './payments.constants';
import { countSignatures, traceWebhookAccepted, traceWebhookRejected } from './webhook-trace';
import { ChosenPickupPoint, DeliveryAddress, DeliveryMethod, DeliveryMode, Transaction, TransactionStatus } from './transaction.entity';

/**
 * Barème (cahier des charges §3.6 : "commission transparente affichée avant validation"). Modèle : le vendeur
 * paie une commission retenue sur le versement ; l'acheteur paie des frais de protection (pourcentage + fixe,
 * plafonnés) ajoutés au prix. Les valeurs vivent dans les réglages système (AUDIT §51, défaut 8 % et
 * 5 % + 0,50 € plafonnés à 15 €), modifiables par l'admin ; chaque transaction fige le barème de sa création.
 */
export const MAX_SECURE_AMOUNT = 2500;
/** Familles exclues du paiement sécurisé (comme leboncoin). */
export const SECURE_PAYMENT_EXCLUDED_ROOTS = ['immobilier', 'vehicules', 'emploi', 'services', 'vacances', 'animaux'];

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Une page de paiement hébergée commencée depuis moins longtemps que cela bloque l'annonce (double vente). */
const PENDING_TTL_MS = CHECKOUT_TTL_MINUTES * 60_000;
/** Pages de paiement ouvertes (non payées, non expirées) qu'un même acheteur peut avoir en même temps (AUDIT §69). */
export const MAX_OPEN_CHECKOUTS = 3;

// ----- Échéances du séquestre (AUDIT §37, §39) -----
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const envNum = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
/** Validité supposée d'une autorisation quand le fournisseur ne la donne pas (5 jours = fenêtre la plus courte, Visa initiée par le marchand). */
export const ESCROW_DEFAULT_AUTH_DAYS = envNum('ESCROW_DEFAULT_AUTH_DAYS', 5);
/** Marge avant la date limite de capture : l'action automatique (ancien modèle) ou la capture de sécurité (modèle platform) a lieu ce nombre d'heures avant l'expiration. */
export const ESCROW_SAFETY_HOURS = envNum('ESCROW_SAFETY_HOURS', 24);
/** Réception présumée : jours après l'expédition sans confirmation ni litige (ancien modèle : plafonné par la date limite de capture ; modèle platform : sans plafond). */
export const ESCROW_AUTO_CONFIRM_DAYS = envNum('ESCROW_AUTO_CONFIRM_DAYS', 7);
/** Après une confirmation automatique (réception présumée, capture à l'échéance), l'acheteur garde ce nombre de jours pour ouvrir un litige. */
export const ESCROW_DISPUTE_WINDOW_DAYS = envNum('ESCROW_DISPUTE_WINDOW_DAYS', 7);
/** Seuil du filet de sécurité admin : transactions non résolues dont la prochaine échéance est à moins de N heures. */
export const ESCROW_ADMIN_ALERT_HOURS = envNum('ESCROW_ADMIN_ALERT_HOURS', 48);
/**
 * Modèle platform (AUDIT §39) : les fonds sont encaissés sur le solde de Trocoin au plus tard ce nombre
 * d'heures après l'autorisation (plus tôt dès que le vendeur expédie, se déclare prêt, ou qu'un litige
 * s'ouvre). Pendant ce court délai, une annulation (acheteur qui se ravise, vendeur indisponible, alerte
 * fraude) libère simplement l'autorisation : aucun débit, aucun remboursement, aucun frais Stripe perdu.
 */
export const ESCROW_CAPTURE_AFTER_HOURS = envNum('ESCROW_CAPTURE_AFTER_HOURS', 24);
/** Modèle platform : jours accordés au vendeur pour expédier ou remettre (code saisi) ; passé ce délai, annulation et remboursement. */
export const ESCROW_SHIP_DEADLINE_DAYS = envNum('ESCROW_SHIP_DEADLINE_DAYS', 7);

const frDate = (d: Date) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(d);

export function computeQuote(price: number, fees: FeeRates = DEFAULT_FEE_RATES) {
  const commission = round2((price * fees.commissionPercent) / 100);
  const buyerFee = round2(Math.min((price * fees.buyerFeePercent) / 100 + fees.buyerFeeFixed, fees.buyerFeeCap));
  return {
    price,
    commission,
    buyerFee,
    buyerTotal: round2(price + buyerFee),
    sellerPayout: round2(price - commission),
  };
}

/** Devis d'une transaction EXISTANTE : relu sur ses montants figés, jamais recalculé avec le barème du jour. */
export function quoteOfTransaction(tx: Pick<Transaction, 'amount' | 'commission' | 'buyerFee'> & { shippingFee?: number }) {
  return { price: tx.amount, commission: tx.commission, buyerFee: tx.buyerFee, shippingFee: tx.shippingFee ?? 0, buyerTotal: round2(tx.amount + tx.buyerFee + (tx.shippingFee ?? 0)), sellerPayout: round2(tx.amount - tx.commission) };
}

@Injectable()
export class PaymentsService implements OnApplicationBootstrap {
  /**
   * AUDIT §63 : l'API de production (offre gratuite) est mise en veille entre deux visites — la tâche des échéances
   * (toutes les 15 min) ne tournait donc pas ; les autorisations bancaires expiraient au bout de 7 jours sans être
   * encaissées. Au réveil, les échéances sont jouées tout de suite (et un réveil régulier est assuré par ailleurs).
   */
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.ESCROW_RUN_ON_BOOT === '0') return;
    setTimeout(() => {
      this.runEscrowSchedule().catch((e) => this.logger.error(`Échéances au démarrage : ${(e as Error).message}`));
    }, 8_000).unref();
  }

  /**
   * Refus du prestataire rendu en clair (AUDIT §63) : autorisation expirée → 409 avec le message ; autre refus → 502
   * avec le motif du prestataire. Avant, tout finissait en « Erreur interne » et l'administrateur ne pouvait pas trancher.
   */
  private async providerCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if (err instanceof PaymentProviderError) throw new ConflictException({ statusCode: 409, code: err.code, message: err.message });
      const e = err as { type?: string; code?: string; message?: string };
      throw new BadGatewayException({ statusCode: 502, code: 'PROVIDER_REFUSED', message: `Le prestataire de paiement a refusé l'opération : ${e?.message || String(err)}` });
    }
  }

  /** Une seule action à la fois par vente (AUDIT §63) : décision admin, annulation, confirmation, expédition ne se croisent plus. */
  private readonly locks = new Map<string, Promise<unknown>>();
  private async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  /**
   * Paiement que le prestataire ne reconnaît plus, ou autorisation expirée (AUDIT §65) : signalé UNE fois sur la vente
   * (`paymentIssue`), retiré des files de la tâche périodique, administrateurs prévenus. Avant, chaque réveil du serveur
   * rejouait l'appel et remplissait le journal d'erreurs, sans que personne ne soit prévenu.
   */
  private async flagPaymentIssue(tx: Transaction, err: unknown, step: string): Promise<boolean> {
    if (!(err instanceof PaymentProviderError) || !['paiement_absent', 'autorisation_expiree'].includes(err.code)) return false;
    const issue = `${step} : ${err.message}`;
    await this.transactionsRepo.update({ id: tx.id, paymentIssue: IsNull() }, { paymentIssue: issue, paymentIssueAt: new Date() });
    this.logger.warn(`Transaction ${tx.id} signalée à l'administration (plus de nouvel essai automatique) — ${issue}`);
    for (const adminId of await this.usersService.findAdminIds()) {
      await this.notifications.notify(adminId, { type: 'transaction', title: 'Vente à traiter : paiement inconnu du prestataire', body: `Transaction ${tx.id.slice(0, 8)} (${tx.status}, ${tx.amount} €) : ${err.message} Tranchez-la depuis la console (annuler, rembourser ou réessayer).`, link: `/admin/litiges/${tx.id}` });
    }
    return true;
  }

  /** L'administration lève le signalement (clés rétablies, donnée revenue) : la tâche périodique reprend cette vente. */
  async clearPaymentIssue(transactionId: string): Promise<Transaction> {
    const tx = await this.transactionsRepo.findOne({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    await this.transactionsRepo.update(tx.id, { paymentIssue: null, paymentIssueAt: null });
    tx.paymentIssue = null;
    tx.paymentIssueAt = null;
    return tx;
  }

  /** État réel du paiement chez le prestataire, pour la fiche admin (au mieux, jamais bloquant). */
  async inspectPayment(tx: Transaction): Promise<{ state: PaymentState; detail?: string }> {
    if (!tx.providerPaymentId || !this.paymentProvider.inspect) return { state: 'inconnue' };
    try {
      return await Promise.race([this.paymentProvider.inspect(tx.providerPaymentId), new Promise<{ state: PaymentState; detail: string }>((r) => setTimeout(() => r({ state: 'inconnue', detail: 'prestataire injoignable' }), 6_000).unref())]);
    } catch (e) {
      return { state: 'inconnue', detail: (e as Error).message };
    }
  }
  private readonly logger = new Logger('Paiements');
  /** Codes de remise incorrects par vente (mémoire du processus) : 5 essais par heure, quelle que soit l'adresse IP. */
  private readonly handoverFailures = new Map<string, { count: number; until: number }>();
  constructor(
    @InjectRepository(Transaction) private transactionsRepo: Repository<Transaction>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(Shipment) private shipments: Repository<Shipment>,
    @Inject(PAYMENT_PROVIDER) private paymentProvider: IPaymentProvider,
    private usersService: UsersService,
    private stripeConnect: StripeConnectService,
    private notifications: NotificationsService,
    private settings: SettingsService,
    private conversations: ConversationsService,
    private shipping: ShippingService,
    private retention: RetentionService,
  ) {}

  /** Devis affiché avant validation : prix, frais acheteur, total, commission vendeur. */
  async quote(listingId: string, viewerId?: string) {
    const listing = await this.listingsRepo.findOne({ where: { id: listingId } });
    if (!listing || listing.status !== 'en_ligne') throw new NotFoundException('Annonce introuvable.');
    const eligibility = await this.checkEligibility(listing);
    const fees = this.settings.fees();
    const offer = await this.negotiatedPrice(listing, viewerId);
    return {
      eligible: eligibility.ok,
      reason: eligibility.reason,
      isOwner: viewerId === listing.userId,
      deliveryAvailable: listing.deliveryAvailable,
      ...(listing.price ? computeQuote(offer?.amount ?? listing.price, fees) : {}),
      // Proposition de prix acceptée par le vendeur, encore valable pour CE membre (AUDIT §60) : les montants ci-dessus sont
      // calculés sur ce prix négocié ; `listPrice` rappelle le prix affiché
      ...(offer ? { offer: { id: offer.id, amount: offer.amount, expiresAt: offer.expiresAt }, listPrice: listing.price } : {}),
      // Barème en vigueur, affiché à côté des montants (« 5 % + 0,50 € »)
      rates: fees,
    };
  }

  /**
   * Prix négocié (AUDIT §60) : proposition de prix de cet acheteur, acceptée par le vendeur et encore valable, si elle
   * est inférieure au prix affiché. Toujours relue ici, côté serveur : le navigateur n'envoie jamais de prix.
   */
  private async negotiatedPrice(listing: Listing, buyerId?: string): Promise<{ id: string; amount: number; expiresAt: Date } | null> {
    if (!buyerId || buyerId === listing.userId || !listing.price) return null;
    const offer = await this.conversations.acceptedOfferFor(listing.id, buyerId);
    return offer && offer.amount < listing.price ? offer : null;
  }

  private async checkEligibility(listing: Listing): Promise<{ ok: boolean; reason?: string }> {
    if (!listing.price || listing.price <= 0) return { ok: false, reason: 'Cette annonce n\'a pas de prix fixe.' };
    // AUDIT §63 : sous 1 €, le paiement sécurisé ne servait qu'à fabriquer de faux avis (0,51 € le cycle)
    if (listing.price < 1) return { ok: false, reason: 'Le paiement sécurisé est possible à partir de 1 €.' };
    // Préférence du vendeur (remise en main propre seulement) ou compte de démonstration (AUDIT §46) : jamais de paiement en ligne
    const seller = await this.usersService.findById(listing.userId);
    if (!seller || seller.securePaymentDisabled || seller.isDemoAccount) return { ok: false, reason: 'Ce vendeur ne propose pas le paiement sécurisé : réglez en main propre, à la remise.' };
    if (listing.price > MAX_SECURE_AMOUNT) return { ok: false, reason: `Le paiement sécurisé est limité à ${MAX_SECURE_AMOUNT} €.` };
    if (listing.rootCategoryId) {
      const rootSlug = await this.rootSlug(listing.rootCategoryId);
      if (rootSlug && SECURE_PAYMENT_EXCLUDED_ROOTS.includes(rootSlug)) {
        return { ok: false, reason: 'Le paiement sécurisé n\'est pas disponible pour cette catégorie.' };
      }
    }
    return { ok: true };
  }

  private rootSlugCache = new Map<number, string | null>();
  private async rootSlug(rootCategoryId: number): Promise<string | null> {
    if (!this.rootSlugCache.has(rootCategoryId)) {
      const row = await this.listingsRepo.manager
        .createQueryBuilder()
        .select('c.slug', 'slug')
        .from('categories', 'c')
        .where('c.id = :id', { id: rootCategoryId })
        .getRawOne<{ slug: string }>();
      this.rootSlugCache.set(rootCategoryId, row?.slug ?? null);
    }
    return this.rootSlugCache.get(rootCategoryId)!;
  }

  async createTransaction(buyerId: string, listingId: string, deliveryMethod: DeliveryMethod = 'main_propre', shippingAddress?: DeliveryAddress, expectedTotal?: number, deliveryMode?: DeliveryMode, pickupPoint?: ChosenPickupPoint) {
    const listing = await this.listingsRepo.findOne({ where: { id: listingId } });
    if (!listing || listing.status !== 'en_ligne') throw new NotFoundException('Annonce introuvable ou plus disponible.');
    if (listing.userId === buyerId) {
      throw new BadRequestException('Vous ne pouvez pas acheter votre propre annonce.');
    }
    const eligibility = await this.checkEligibility(listing);
    if (!eligibility.ok) throw new BadRequestException(eligibility.reason);
    if (deliveryMethod !== 'main_propre' && !listing.deliveryAvailable) {
      throw new BadRequestException('Le vendeur ne propose pas la livraison pour cette annonce.');
    }
    if (await this.usersService.isBlockedEitherWay(buyerId, listing.userId)) {
      throw new ForbiddenException('Transaction impossible avec cet utilisateur.');
    }

    // Une seule transaction active par annonce (évite la double vente) ; un paiement hébergé
    // commencé il y a moins de CHECKOUT_TTL_MINUTES bloque aussi l'annonce.
    const active = await this.transactionsRepo.count({
      where: [
        { listingId, status: In(['sequestre', 'livree', 'litige']) },
        { listingId, status: 'en_attente', createdAt: MoreThan(new Date(Date.now() - PENDING_TTL_MS)) },
      ],
    });
    if (active > 0) throw new BadRequestException('Une transaction est déjà en cours sur cette annonce.');
    // AUDIT §69 : une page de paiement jamais payée bloquait gratuitement l'annonce pendant 30 min, autant de fois qu'on voulait
    // (10 annonces par 10 min et par adresse) — au plus MAX_OPEN_CHECKOUTS pages ouvertes à la fois par acheteur
    const open = await this.transactionsRepo.count({ where: { buyerId, status: 'en_attente', createdAt: MoreThan(new Date(Date.now() - PENDING_TTL_MS)) } });
    if (open >= MAX_OPEN_CHECKOUTS) throw new BadRequestException(`Vous avez déjà ${MAX_OPEN_CHECKOUTS} paiements en cours : terminez-les ou abandonnez-les avant d'en commencer un autre.`);

    // Mode d'envoi choisi par l'acheteur (AUDIT §57) : domicile, ou retrait dans un point réel du transporteur
    // (relais, bureau de poste, consigne), relu chez le prestataire avant tout paiement.
    let mode: DeliveryMode | null = null;
    let point: ChosenPickupPoint | null = null;
    let shippingQuote: Transaction['shippingQuote'] = null;
    if (deliveryMethod !== 'main_propre') {
      // Anciens clients sans mode : celui que le transporteur impliquait (Colissimo domicile, Mondial Relay point relais)
      mode = deliveryMode ?? (pickupPoint ? 'point_relais' : deliveryMethod === 'colissimo' ? 'domicile' : 'point_relais');
      if (!shippingAddress) throw new BadRequestException('Adresse de livraison requise pour un envoi : elle sert à calculer les frais de livraison.');
      if (mode === 'point_relais' && !pickupPoint) throw new BadRequestException('Choisissez le point de retrait où recevoir le colis.');
      // Frais de livraison (AUDIT §59) : prix réel coté pour le colis de l'annonce, payé par l'acheteur avec son achat
      shippingQuote = await this.shipping.quoteForPurchase(listing, deliveryMethod as ShippingCarrier, mode, shippingAddress.postalCode, shippingAddress.city);
      if (mode === 'point_relais' && pickupPoint) {
        const found = await this.shipping.resolvePickupPoint(deliveryMethod as ShippingCarrier, pickupPoint.id, shippingAddress?.postalCode ?? pickupPoint.postalCode, shippingAddress?.city, { ...pickupPoint });
        point = { id: found.id, name: found.name, line1: found.line1, postalCode: found.postalCode, city: found.city, type: found.type };
      }
    }
    // Barème lu UNE fois, à la création : il est figé sur la transaction (montants + taux), un changement
    // ultérieur par l'admin ne la touche plus (AUDIT §51).
    const fees = this.settings.fees();
    const shippingFee = shippingQuote ? round2(shippingQuote.priceCents / 100) : 0;
    // Prix payé : celui de la proposition acceptée par le vendeur si l'acheteur en a une valable, sinon le prix affiché
    const offer = await this.negotiatedPrice(listing, buyerId);
    // AUDIT §69 : le plancher de 1 € (§63) s'applique aussi au prix négocié (0,01 € accepté par un vendeur complice = faux avis)
    if (offer && offer.amount < 1) throw new BadRequestException('Le paiement sécurisé est possible à partir de 1 € : le prix convenu est trop bas.');
    const price = offer?.amount ?? listing.price!;
    const base0 = computeQuote(price, fees);
    const q = { ...base0, shippingFee, buyerTotal: round2(base0.buyerTotal + shippingFee) };
    // Garde-fou : le total que l'acheteur a vu avant de cliquer doit être celui qu'on va débiter. Si le barème
    // (ou le prix) a changé entre-temps, on refuse et on renvoie le nouveau devis plutôt que de le surprendre.
    if (expectedTotal !== undefined && Math.abs(expectedTotal - q.buyerTotal) > 0.005) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'QUOTE_CHANGED',
        message: `Le montant à payer a changé depuis son affichage (${q.buyerTotal.toFixed(2).replace('.', ',')} € au lieu de ${expectedTotal.toFixed(2).replace('.', ',')} €). Vérifiez le nouveau total avant de payer.`,
        quote: { ...q, rates: fees },
      });
    }
    // Modèle platform : la charge reste sur le solde de Trocoin, le compte du vendeur ne sert qu'au
    // transfert à la confirmation. On vérifie dès l'achat qu'il est prêt (onboarding terminé) pour ne pas
    // bloquer un versement plus tard ; un vendeur sans compte est payé dès qu'il en crée un.
    await this.stripeConnect.getPayableAccountId(listing.userId);
    const applicationFeeEuros = round2(q.commission + q.buyerFee);
    const base = {
      listingId,
      listingTitle: listing.title,
      buyerId,
      sellerId: listing.userId,
      amount: price,
      listPrice: offer ? listing.price! : null,
      commission: q.commission,
      buyerFee: q.buyerFee,
      feeRates: fees,
      deliveryMethod,
      // Adresse de livraison (envoi) : gardée telle que saisie, jamais exposée en dehors des deux parties
      shippingAddress: deliveryMethod !== 'main_propre' && shippingAddress ? shippingAddress : null,
      shippingFee,
      shippingQuote,
      deliveryMode: mode,
      pickupPoint: point,
      handoverCode: deliveryMethod === 'main_propre' ? randomInt(0, 1_000_000).toString().padStart(6, '0') : undefined,
    };
    const metadata = { listingId, buyerId, sellerId: listing.userId };

    if (this.paymentProvider.createCheckout) {
      // Paiement hébergé (Stripe Checkout) : la transaction attend l'autorisation de l'acheteur sur la
      // page du fournisseur ; elle passe « sequestre » à son retour (syncPending) ou par webhook.
      const pending = await this.transactionsRepo.save(this.transactionsRepo.create({ ...base, status: 'en_attente' }));
      if (!(await this.isFirstActiveSale(pending))) {
        await this.transactionsRepo.delete(pending.id);
        throw new BadRequestException('Une transaction est déjà en cours sur cette annonce.');
      }
      const site = resolveSiteUrl();
      try {
        const buyer = await this.usersService.findById(buyerId);
        const checkout = await this.paymentProvider.createCheckout({
          transactionId: pending.id,
          amountEuros: q.buyerTotal,
          applicationFeeEuros,
          transferGroup: pending.id,
          title: listing.title,
          priceEuros: q.price,
          feeEuros: q.buyerFee,
          shippingEuros: shippingFee || undefined,
          shippingLabel: shippingFee ? `Frais de livraison ${deliveryMethod === 'colissimo' ? 'Colissimo' : 'Mondial Relay'} (${mode === 'domicile' ? 'à domicile' : 'en point de retrait'})` : undefined,
          buyerEmail: buyer?.email || undefined,
          successUrl: `${site}/compte/transactions/${pending.id}?paiement=retour`,
          // Retour de la page de paiement sans payer (« ← », carte refusée puis abandon) : une page Trocoin qui dit
          // clairement que rien n'a été débité et comment reprendre (AUDIT §57), pas l'annonce avec un message fugitif
          cancelUrl: `${site}/compte/transactions/${pending.id}?paiement=annule`,
          metadata: { ...metadata, transactionId: pending.id },
        });
        pending.providerPaymentId = checkout.providerSessionId;
        await this.transactionsRepo.save(pending);
        return { transaction: this.viewFor(pending, buyerId, checkout.checkoutUrl), checkoutUrl: checkout.checkoutUrl, quote: q };
      } catch (e) {
        await this.transactionsRepo.delete(pending.id);
        const err = e as Error & { code?: string; param?: string; type?: string };
        this.logger.error(`Page de paiement impossible pour ${listingId} : ${err.message}`);
        // Code d'erreur du fournisseur (jamais de secret) dans la réponse : diagnostic possible sans accès aux logs
        const hint = err.code || err.type ? ` (fournisseur : ${[err.type, err.code, err.param].filter(Boolean).join(' · ')})` : '';
        throw new ServiceUnavailableException(`Le service de paiement est momentanément indisponible. Réessayez dans quelques instants.${hint}`);
      }
    }

    const intent = await this.paymentProvider.createPaymentIntent({ amountEuros: q.buyerTotal, applicationFeeEuros, metadata });
    const fresh = this.transactionsRepo.create({ ...base, status: 'sequestre', providerPaymentId: intent.providerPaymentId });
    this.enterEscrow(fresh, intent.captureBefore);
    const transaction = await this.transactionsRepo.save(fresh);
    if (!(await this.isFirstActiveSale(transaction))) {
      await this.paymentProvider.refund(intent.providerPaymentId).catch((e) => this.logger.error(`Double vente ${transaction.id} : libération de l'autorisation impossible (${(e as Error).message})`));
      await this.transactionsRepo.delete(transaction.id);
      throw new BadRequestException('Une transaction est déjà en cours sur cette annonce.');
    }
    await this.notifySellerPaid(transaction, listing.title);
    return { transaction: this.viewFor(transaction, buyerId), clientSecret: intent.clientSecret, quote: q };
  }

  /**
   * Double vente (AUDIT §60) : deux acheteurs qui cliquent « Payer » à une seconde d'écart passaient tous deux le contrôle
   * « aucune vente en cours », séparé de l'insertion par des appels réseau. On revérifie donc APRÈS l'insertion : parmi les
   * ventes actives de l'annonce, seule la plus ancienne (date, puis identifiant) est gardée ; les deux requêtes concurrentes
   * calculent le même ordre, une seule survit.
   */
  private async isFirstActiveSale(tx: Transaction): Promise<boolean> {
    const actives = await this.transactionsRepo.find({
      where: [
        { listingId: tx.listingId, status: In(['sequestre', 'livree', 'litige']) },
        { listingId: tx.listingId, status: 'en_attente', createdAt: MoreThan(new Date(Date.now() - PENDING_TTL_MS)) },
      ],
      select: { id: true, createdAt: true },
    });
    if (actives.length <= 1) return true;
    actives.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
    return actives[0].id === tx.id;
  }

  /**
   * Entrée en séquestre : date d'autorisation et date limite de capture. Sans date donnée par le
   * fournisseur, on retient la fenêtre la plus courte connue (ESCROW_DEFAULT_AUTH_DAYS) plutôt que la
   * plus longue : mieux vaut agir un peu tôt que laisser l'autorisation expirer.
   */
  private enterEscrow(tx: Transaction, captureBefore?: Date) {
    tx.paidAt = new Date();
    tx.captureBefore = captureBefore ?? new Date(tx.paidAt.getTime() + ESCROW_DEFAULT_AUTH_DAYS * DAY_MS);
    tx.escrowStage = 0;
    if (this.isPlatform(tx)) tx.shipBy = new Date(tx.paidAt.getTime() + ESCROW_SHIP_DEADLINE_DAYS * DAY_MS);
  }

  /** Modèle de séquestre de la vente (les ventes antérieures à la bascule restent en « destination »). */
  private isPlatform(tx: Transaction): boolean {
    return tx.escrowModel !== 'destination';
  }

  /** Montant net versé au vendeur (prix moins commission ; les frais acheteur restent à la plateforme). */
  private sellerPayout(tx: Transaction): number {
    return round2(tx.amount - tx.commission);
  }

  /**
   * Dernier instant où une action automatique doit avoir eu lieu. Ancien modèle : marge avant l'expiration
   * de l'autorisation. Modèle platform : délai accordé au vendeur pour expédier ou remettre (les fonds,
   * encaissés sur le solde de Trocoin, n'expirent pas).
   */
  private escrowDeadline(tx: Transaction): Date {
    if (this.isPlatform(tx)) {
      return tx.shipBy ? new Date(tx.shipBy) : new Date(new Date(tx.paidAt ?? tx.createdAt).getTime() + ESCROW_SHIP_DEADLINE_DAYS * DAY_MS);
    }
    const before = tx.captureBefore ? new Date(tx.captureBefore) : new Date(new Date(tx.paidAt ?? tx.createdAt).getTime() + ESCROW_DEFAULT_AUTH_DAYS * DAY_MS);
    return new Date(before.getTime() - ESCROW_SAFETY_HOURS * HOUR_MS);
  }

  /** Modèle platform : date à laquelle la capture de l'autorisation sur le solde de Trocoin doit avoir eu lieu au plus tard. */
  private captureDueAt(tx: Transaction): Date {
    const paid = new Date(tx.paidAt ?? tx.createdAt).getTime();
    const wanted = paid + ESCROW_CAPTURE_AFTER_HOURS * HOUR_MS;
    const guard = (tx.captureBefore ? new Date(tx.captureBefore).getTime() : paid + ESCROW_DEFAULT_AUTH_DAYS * DAY_MS) - ESCROW_SAFETY_HOURS * HOUR_MS;
    return new Date(Math.min(wanted, guard));
  }

  /**
   * Transition atomique (AUDIT §60) : `UPDATE … WHERE id = ? AND status IN (…)`. De deux actions concurrentes sur la même
   * vente (deux confirmations, une annulation et une confirmation, l'acheteur et la tâche périodique…), une seule obtient
   * la transition ; l'autre est refusée AVANT tout mouvement d'argent. Sans elle, les deux lisaient le même état puis
   * agissaient : double virement, ou remboursement ET virement sur la même vente.
   */
  private async claim(tx: Transaction, from: TransactionStatus[], patch: Partial<Transaction>): Promise<void> {
    const res = await this.transactionsRepo.update({ id: tx.id, status: In(from) }, patch);
    if (!res.affected) throw new ConflictException("Cette vente vient d'être traitée par une autre action : rechargez la page.");
    Object.assign(tx, patch);
  }
  /** Mouvement d'argent échoué après une transition obtenue : la vente revient à son état précédent, l'erreur remonte. */
  private async release(tx: Transaction, previous: Partial<Transaction>) {
    Object.assign(tx, previous);
    await this.transactionsRepo.update(tx.id, previous);
  }

  /** Modèle platform : encaisse l'autorisation sur le solde de la plateforme (idempotent). */
  private async ensureCaptured(tx: Transaction): Promise<boolean> {
    if (!this.isPlatform(tx) || tx.capturedAt) return false;
    await this.paymentProvider.capture(tx.providerPaymentId!);
    tx.capturedAt = new Date();
    await this.transactionsRepo.save(tx);
    this.logger.log(`Transaction ${tx.id} : fonds encaissés sur le solde de la plateforme`);
    return true;
  }

  /**
   * Modèle platform : paie le vendeur depuis le solde de la plateforme (montant net). Sans compte de
   * versement prêt, le virement reste en attente et la tâche périodique le retente ; la vente est
   * confirmée dans tous les cas. Idempotent (transferId).
   */
  /** Réservation de virement restée en plan plus de 10 minutes (serveur arrêté pendant l'appel) : à reprendre. */
  private isStaleReservation(tx: Transaction): boolean {
    return !!tx.transferId?.startsWith('en-cours:') && new Date(tx.updatedAt).getTime() < Date.now() - 10 * 60_000;
  }

  private async payoutSeller(tx: Transaction, title?: string): Promise<boolean> {
    if (!this.isPlatform(tx) || (tx.transferId && !this.isStaleReservation(tx))) return false;
    const staleReservation = !!tx.transferId;
    if (tx.transferId) await this.transactionsRepo.update({ id: tx.id, transferId: tx.transferId }, { transferId: null });
    let accountId: string | undefined;
    try {
      accountId = await this.stripeConnect.getPayableAccountId(tx.sellerId);
    } catch (e) {
      this.logger.warn(`Transaction ${tx.id} : compte de versement du vendeur non prêt (${(e as Error).message})`);
    }
    if (!accountId) {
      this.logger.warn(`Transaction ${tx.id} : vendeur ${tx.sellerId} sans compte de versement, virement de ${this.sellerPayout(tx)} € en attente`);
      return false;
    }
    // Réservation atomique du virement : une seule exécution concurrente passe (le fournisseur reçoit en plus une clé
    // d'idempotence par vente). En cas d'échec la réservation est rendue ; une réservation restée orpheline (arrêt du
    // serveur en plein appel) est reprise par la tâche périodique, sans risque de doublon grâce à la clé.
    const reservation = `en-cours:${randomInt(1, 2 ** 31)}`;
    const reserved = await this.transactionsRepo.update({ id: tx.id, transferId: IsNull() }, { transferId: reservation });
    if (!reserved.affected) {
      // Un autre passage (tâche périodique, autre requête) a pris le virement : on reprend son état pour ne pas l'écraser en enregistrant
      const fresh = await this.transactionsRepo.findOne({ where: { id: tx.id } });
      if (fresh) Object.assign(tx, { transferId: fresh.transferId, transferredAt: fresh.transferredAt });
      return false;
    }
    let transferId: string;
    try {
      // AUDIT §69 : une réservation reprise après la fenêtre d'idempotence du prestataire (24 h) recréait un virement
      const existing = staleReservation && this.paymentProvider.findTransfer ? await this.paymentProvider.findTransfer(tx.id) : null;
      if (existing) this.logger.warn(`Transaction ${tx.id} : virement ${existing} déjà fait chez le prestataire, réutilisé`);
      ({ transferId } = existing ? { transferId: existing } : await this.paymentProvider.transfer({
      providerPaymentId: tx.providerPaymentId!,
      sellerConnectedAccountId: accountId,
      amountEuros: this.sellerPayout(tx),
      transactionId: tx.id,
        description: `Trocoin · vente ${title ?? tx.listingId}`,
      }));
    } catch (e) {
      await this.transactionsRepo.update({ id: tx.id, transferId: reservation }, { transferId: null });
      throw e;
    }
    tx.transferId = transferId;
    tx.transferredAt = new Date();
    await this.transactionsRepo.save(tx);
    this.logger.log(`Transaction ${tx.id} : ${this.sellerPayout(tx)} € virés au vendeur (${transferId})`);
    return true;
  }

  /**
   * Confirmation de la vente : ancien modèle → capture (les fonds partent chez le vendeur) ; modèle
   * platform → capture si elle n'a pas encore eu lieu, puis virement au vendeur.
   */
  private async settle(tx: Transaction, title?: string) {
    if (this.isPlatform(tx)) {
      await this.ensureCaptured(tx);
      // AUDIT §63 : un virement refusé par le prestataire (compte du vendeur restreint…) ne bloque plus la confirmation de
      // l'acheteur : la vente est confirmée, le virement reste en attente et la tâche périodique le retente
      try {
        await this.payoutSeller(tx, title);
      } catch (e) {
        this.logger.error(`Transaction ${tx.id} : virement au vendeur refusé, à retenter (${(e as Error).message})`);
      }
    } else {
      await this.paymentProvider.capture(tx.providerPaymentId!);
    }
  }

  /**
   * Remboursement intégral de l'acheteur. Ancien modèle : le fournisseur annule l'autorisation ou rembourse
   * en annulant le transfert. Modèle platform : autorisation non capturée → libérée ; capturée → remboursée
   * depuis le solde de Trocoin ; déjà virée au vendeur → le virement est d'abord annulé (le compte du
   * vendeur est débité), puis l'acheteur remboursé — l'acheteur est remboursé même si l'annulation du
   * virement échoue (elle est alors à reprendre à la main, journal d'erreur).
   */
  private async refundBuyer(tx: Transaction) {
    if (this.isPlatform(tx) && tx.transferId && !tx.transferId.startsWith('en-cours:')) {
      try {
        await this.paymentProvider.reverseTransfer(tx.transferId);
        tx.transferId = null;
        tx.transferredAt = null;
      } catch (e) {
        this.logger.error(`Transaction ${tx.id} : annulation du virement ${tx.transferId} impossible (${(e as Error).message}) — remboursement de l'acheteur maintenu, virement à récupérer à la main`);
      }
    }
    await this.paymentProvider.refund(tx.providerPaymentId!);
  }

  /** Confirmation automatique (réception présumée, capture à l'échéance) : statut confirmé, fenêtre de litige ouverte pour l'acheteur. */
  private async settleAutomatically(tx: Transaction, reason: 'reception_presumee' | 'capture_echeance', note: string, title?: string) {
    if (tx.status === 'litige') {
      // Ancien modèle, litige à l'échéance : capture seule, les fonds restent bloqués jusqu'à la décision
      await this.paymentProvider.capture(tx.providerPaymentId!);
    } else {
      const previous = tx.status;
      await this.claim(tx, [previous], { status: 'confirme' });
      try {
        await this.settle(tx, title);
      } catch (e) {
        await this.release(tx, { status: previous });
        throw e;
      }
    }
    tx.confirmedAt = new Date();
    tx.autoResolution = reason;
    tx.resolutionNote = note;
    tx.disputeAllowedUntil = new Date(Date.now() + ESCROW_DISPUTE_WINDOW_DAYS * DAY_MS);
    await this.transactionsRepo.save(tx);
    if (tx.status === 'confirme') await this.listingsRepo.update({ id: tx.listingId, status: In(['en_ligne', 'expiree']) }, { status: 'vendue' });
  }

  /**
   * Tâche périodique des échéances du séquestre (toutes les 15 minutes), idempotente (escrowStage).
   * Modèle platform : capture sur le solde de Trocoin au plus tard ESCROW_CAPTURE_AFTER_HOURS après le
   * paiement ; réception présumée après l'expédition (rappels 48 h et 24 h avant, puis virement au
   * vendeur) ; annulation et remboursement si rien n'est expédié ni remis avant `shipBy` ; virements en
   * attente retentés quand le vendeur a créé son compte. Ancien modèle : réception présumée puis, avant
   * l'expiration de l'autorisation, capture si expédié ou en litige, annulation sinon.
   */
  @Cron('*/15 * * * *')
  async runEscrowSchedule(now: Date = new Date()): Promise<{ reminders: number; notices: number; confirmed: number; captured: number; cancelled: number; transferred: number }> {
    const result = { reminders: 0, notices: 0, confirmed: 0, captured: 0, cancelled: 0, transferred: 0 };
    const open = await this.transactionsRepo.find({ where: { status: In(['sequestre', 'livree', 'litige']), paymentIssue: IsNull() }, take: 500 });
    for (const tx of open) {
      try {
        if (!tx.captureBefore) {
          // Transaction antérieure à ce mécanisme : date limite estimée depuis l'autorisation
          this.enterEscrow(tx, new Date(new Date(tx.paidAt ?? tx.createdAt).getTime() + ESCROW_DEFAULT_AUTH_DAYS * DAY_MS));
          tx.paidAt = tx.paidAt ?? tx.createdAt;
          await this.transactionsRepo.save(tx);
        }
        const deadline = this.escrowDeadline(tx);
        const listing = await this.listingsRepo.findOne({ where: { id: tx.listingId } });
        const title = listing?.title ?? 'votre transaction';
        const link = `/compte/transactions/${tx.id}`;

        // 0. Modèle platform : capture sur le solde de la plateforme à l'échéance courte (ou de sécurité)
        if (this.isPlatform(tx) && !tx.capturedAt && now >= this.captureDueAt(tx)) {
          await this.ensureCaptured(tx);
          result.captured += 1;
        }

        // 1. Réception présumée (article expédié, aucun litige) : rappel 48 h avant, dernier avis 24 h avant, puis confirmation
        if (tx.status === 'livree' && tx.deliveryMethod !== 'main_propre') {
          // Numéro de suivi saisi à la main sur une livraison prépayée (AUDIT §63) : pas de réception présumée
          if (this.isPlatform(tx) && !tx.autoConfirmAt) continue;
          const autoAt = tx.autoConfirmAt ? new Date(tx.autoConfirmAt) : deadline;
          if (now >= autoAt) {
            // AUDIT §69 : un bon d'envoi généré puis « Confirmer l'expédition » sans jamais déposer le colis faisait payer le
            // vendeur au bout de 7 jours. Si le transporteur n'a jamais pris le colis en charge (ou signale un incident), la
            // réception n'est pas présumée : l'administration est prévenue et tranche.
            const carrier = await this.shipping.carrierStateFor(tx.id, now);
            if (carrier === 'etiquette_creee' || carrier === 'incident') {
              if (tx.escrowStage < 3) {
                tx.escrowStage = 3;
                await this.transactionsRepo.save(tx);
                result.notices += 1;
                for (const adminId of await this.usersService.findAdminIds()) {
                  await this.notifications.notify(adminId, { type: 'transaction', title: 'Réception présumée suspendue : colis jamais pris en charge', body: `Vente ${tx.id.slice(0, 8)} (« ${title} », ${tx.amount} €) : le suivi du transporteur indique ${carrier === 'incident' ? 'un incident' : "que le colis n'a jamais été déposé"}. Le vendeur n'est pas payé automatiquement : tranchez depuis la console.`, link: `/admin/litiges/${tx.id}` });
                }
                await this.notifications.notify(tx.sellerId, { type: 'transaction', title: 'Colis non pris en charge', body: `Le transporteur n'a pas enregistré le dépôt du colis de « ${title} » : le paiement reste bloqué jusqu'à la confirmation de l'acheteur ou la décision de Trocoin.`, link });
              }
              continue;
            }
            await this.settleAutomatically(tx, 'reception_presumee', `Réception présumée le ${frDate(now)} : aucune confirmation ni litige depuis l'expédition`, title);
            result.confirmed += 1;
            await this.notifications.notify(tx.buyerId, { type: 'transaction', title: 'Réception considérée acquise', body: `Sans nouvelle de votre part, la réception de « ${title} » est considérée acquise et le vendeur est payé. Un problème ? Vous pouvez encore ouvrir un litige jusqu'au ${frDate(tx.disputeAllowedUntil!)}.`, link });
            await this.notifications.notify(tx.sellerId, { type: 'transaction', title: 'Vente confirmée', body: `Réception présumée de « ${title} » : les fonds vous sont versés.`, link });
            await this.track(tx, 'reception_presumee', tx.sellerId, 'Réception considérée acquise : le vendeur est payé', { payout: this.sellerPayout(tx) });
            continue;
          }
          if (tx.escrowStage < 2 && now >= new Date(autoAt.getTime() - 24 * HOUR_MS)) {
            tx.escrowStage = 2;
            await this.transactionsRepo.save(tx);
            result.notices += 1;
            await this.notifications.notify(tx.buyerId, { type: 'transaction', title: 'Dernier rappel : confirmez la réception', body: `Sans action de votre part, la réception de « ${title} » sera considérée acquise le ${frDate(autoAt)} et le vendeur sera payé. Confirmez la réception ou signalez un problème avant cette date.`, link });
            continue;
          }
          if (tx.escrowStage < 1 && now >= new Date(autoAt.getTime() - 48 * HOUR_MS)) {
            tx.escrowStage = 1;
            await this.transactionsRepo.save(tx);
            result.reminders += 1;
            await this.notifications.notify(tx.buyerId, { type: 'transaction', title: 'Avez-vous bien reçu votre colis ?', body: `Confirmez la réception de « ${title} » ou signalez un problème avant le ${frDate(autoAt)} : passé cette date, la réception sera considérée acquise.`, link });
          }
          continue;
        }

        // Modèle platform, litige ouvert : les fonds sont sur le solde de Trocoin, aucune échéance ne presse
        if (this.isPlatform(tx) && tx.status === 'litige') continue;

        // 2. Échéance : action par défaut, précédée de rappels 48 h et 24 h avant.
        //    Ancien modèle : expiration de l'autorisation → capture si expédié ou en litige, annulation sinon.
        //    Modèle platform : délai d'expédition / de remise dépassé sans code ni expédition → annulation.
        if (now >= deadline) {
          if (!this.isPlatform(tx) && (tx.status === 'litige' || tx.status === 'livree')) {
            // Fonds préservés : capturés avant expiration (en litige, la décision remboursera l'acheteur si besoin)
            await this.settleAutomatically(tx, 'capture_echeance', `Fonds capturés le ${frDate(now)} avant l'expiration de l'autorisation bancaire`, title);
            result.captured += 1;
            const body = tx.status === 'litige'
              ? `Pour que l'argent ne soit pas perdu par l'expiration de l'autorisation bancaire, le paiement de « ${title} » a été encaissé par Trocoin. Il reste bloqué jusqu'à la décision du médiateur (remboursement ou versement au vendeur).`
              : `Le paiement de « ${title} » a été encaissé avant l'expiration de l'autorisation bancaire et versé au vendeur. Un problème ? Vous pouvez ouvrir un litige jusqu'au ${frDate(tx.disputeAllowedUntil!)}.`;
            for (const uid of [tx.buyerId, tx.sellerId]) await this.notifications.notify(uid, { type: 'transaction', title: tx.status === 'litige' ? 'Fonds mis en sécurité' : 'Paiement encaissé', body, link });
          } else {
            // AUDIT §69 : bon d'envoi généré, colis déposé, mais « Confirmer l'expédition » jamais cliqué → le suivi du transporteur
            // fait foi : la vente passe « expédiée » au lieu d'être remboursée (l'acheteur recevait l'objet gratuitement)
            if (tx.status === 'sequestre' && tx.deliveryMethod !== 'main_propre') {
              const carrier = await this.shipping.carrierStateFor(tx.id, now);
              if (carrier && carrier !== 'etiquette_creee' && carrier !== 'incident') {
                await this.markShippedNow(tx.id, tx.sellerId);
                this.logger.log(`Transaction ${tx.id} : expédition constatée par le suivi du transporteur (${carrier}) sans déclaration du vendeur`);
                result.notices += 1;
                continue;
              }
            }
            // Ni expédié ni remis avant l'échéance : l'acheteur récupère son argent ; l'annonce reste « vendue », au vendeur de la remettre en ligne
            const previous = tx.status;
            await this.claim(tx, [previous], { status: 'annulee', resolvedAt: now });
            try {
              await this.refundBuyer(tx);
            } catch (e) {
              await this.release(tx, { status: previous, resolvedAt: null } as unknown as Partial<Transaction>);
              throw e;
            }
            await this.cancelLabelOrAlert(tx);
            tx.autoResolution = 'annulation_echeance';
            tx.resolutionNote = tx.deliveryMethod === 'main_propre' ? 'Remise non confirmée avant l\'échéance : vente annulée, acheteur remboursé' : 'Article non expédié avant l\'échéance : vente annulée, acheteur remboursé';
            await this.transactionsRepo.save(tx);
            result.cancelled += 1;
            await this.notifications.notify(tx.buyerId, { type: 'transaction', title: 'Achat annulé, remboursement intégral', body: `« ${title} » n'a pas été ${tx.deliveryMethod === 'main_propre' ? 'remis' : 'expédié'} dans le délai : votre paiement est libéré.`, link });
            await this.notifications.notify(tx.sellerId, { type: 'transaction', title: 'Vente annulée (délai dépassé)', body: `« ${title} » n'a pas été ${tx.deliveryMethod === 'main_propre' ? 'remis (code non saisi)' : 'expédié'} avant l'échéance du paiement : l'acheteur est remboursé. Votre annonce est restée marquée « Vendue » : remettez-la en ligne depuis Mes annonces si l'article est toujours à vendre.`, link });
            await this.track(tx, 'vente_annulee', tx.sellerId, 'Vente annulée (délai dépassé) : acheteur remboursé', { by: 'delai' });
          }
          continue;
        }
        if (tx.status === 'litige') continue; // le médiateur est déjà saisi : pas de rappel automatique
        const stageTargets: Array<{ stage: number; at: Date }> = [{ stage: 1, at: new Date(deadline.getTime() - 48 * HOUR_MS) }, { stage: 2, at: new Date(deadline.getTime() - 24 * HOUR_MS) }];
        for (const { stage, at } of stageTargets) {
          if (tx.escrowStage >= stage || now < at) continue;
          tx.escrowStage = stage;
          await this.transactionsRepo.save(tx);
          if (stage === 1) result.reminders += 1; else result.notices += 1;
          const when = frDate(deadline);
          if (tx.deliveryMethod === 'main_propre') {
            await this.notifications.notify(tx.sellerId, { type: 'transaction', title: stage === 1 ? 'Remise à faire avant le ' + when : 'Dernier rappel : remise avant le ' + when, body: `Saisissez le code de remise de « ${title} » avant le ${when}. Sans remise confirmée, la vente sera annulée et l'acheteur remboursé.`, link });
            await this.notifications.notify(tx.buyerId, { type: 'transaction', title: stage === 1 ? 'Rendez-vous à organiser' : 'Dernier rappel : remise avant le ' + when, body: `Convenez de la remise de « ${title} » avant le ${when} : sans code saisi par le vendeur (ou confirmation de votre part), votre paiement sera libéré et l'achat annulé.`, link });
          } else {
            await this.notifications.notify(tx.sellerId, { type: 'transaction', title: stage === 1 ? 'Expédiez avant le ' + when : 'Dernier rappel : expédiez avant le ' + when, body: `« ${title} » doit être expédié (numéro de suivi ou étiquette) avant le ${when}. Sans expédition, la vente sera annulée et l'acheteur remboursé.`, link });
          }
        }
      } catch (e) {
        if (await this.flagPaymentIssue(tx, e, 'échéance du séquestre')) continue;
        this.logger.error(`Échéance du séquestre ${tx.id} : ${(e as Error).message}`);
      }
    }

    // 3. Modèle platform : virements en attente (vendeur sans compte de versement au moment de la confirmation)
    const pendingPayouts = await this.transactionsRepo.find({ where: [{ status: 'confirme', escrowModel: 'platform', transferId: IsNull(), capturedAt: Not(IsNull()), paymentIssue: IsNull() }, { status: 'confirme', escrowModel: 'platform', transferId: Like('en-cours:%'), capturedAt: Not(IsNull()), paymentIssue: IsNull() }], take: 100 });
    for (const tx of pendingPayouts) {
      try {
        if (await this.payoutSeller(tx)) {
          result.transferred += 1;
          await this.notifications.notify(tx.sellerId, { type: 'transaction', title: 'Versement effectué', body: `Le montant de votre vente (${this.sellerPayout(tx)} €) vient d'être viré sur votre compte de paiement.`, link: `/compte/transactions/${tx.id}` });
        }
      } catch (e) {
        if (await this.flagPaymentIssue(tx, e, 'virement au vendeur')) continue;
        this.logger.error(`Virement en attente ${tx.id} : ${(e as Error).message}`);
      }
    }
    // 4. Réception présumée (AUDIT §58) : l'acheteur garde quelques jours pour ouvrir un litige ; l'annonce, restée
    // « vendue », n'est supprimée qu'à la fin de cette fenêtre — et seulement si le vendeur ne l'a pas remise en ligne
    // après un remboursement. Fenêtre de rattrapage de 3 jours : la tâche passe toutes les 15 minutes.
    const closed = await this.transactionsRepo.find({ where: { status: 'confirme', autoResolution: Not(IsNull()), disputeAllowedUntil: Between(new Date(now.getTime() - 3 * DAY_MS), now) }, take: 200 });
    for (const tx of closed) {
      const listing = await this.listingsRepo.findOne({ where: { id: tx.listingId, status: 'vendue' } });
      if (listing) await this.removeSoldListing(tx);
    }
    if (result.confirmed || result.captured || result.cancelled || result.transferred) this.logger.log(`Échéances du séquestre : ${JSON.stringify(result)}`);
    return result;
  }

  /** Expédition (étiquette) rattachée à une transaction, pour la fiche admin. */
  shipmentOf(transactionId: string): Promise<Shipment | null> {
    return this.shipments.findOne({ where: { transactionId } });
  }

  /**
   * Filet de sécurité admin : transactions non résolues dont la prochaine échéance approche — ancien modèle :
   * date limite de capture ; modèle platform : délai d'expédition / de remise, ou réception présumée.
   */
  async escrowDueSoon(now: Date = new Date()): Promise<Transaction[]> {
    const limit = new Date(now.getTime() + ESCROW_ADMIN_ALERT_HOURS * HOUR_MS);
    const items = await this.transactionsRepo
      .createQueryBuilder('t')
      .where('t.status IN (:...open)', { open: ['sequestre', 'livree', 'litige'] })
      .andWhere(`((t.escrowModel = 'destination' AND t.captureBefore < :limit) OR (t.escrowModel = 'platform' AND t.status IN ('sequestre', 'livree') AND COALESCE(t.autoConfirmAt, t.shipBy) < :limit))`, { limit })
      .orderBy('COALESCE(t.autoConfirmAt, t.shipBy, t.captureBefore)', 'ASC')
      .take(100)
      .getMany();
    for (const tx of items) this.logger.warn(`Séquestre à échéance : transaction ${tx.id} (${tx.status}, ${tx.escrowModel}) échéance ${this.escrowDeadline(tx).toISOString()}`);
    // Paiements inconnus du prestataire (AUDIT §65) : à traiter par l'administration
    const flagged = await this.transactionsRepo.find({ where: { paymentIssue: Not(IsNull()), status: In(['sequestre', 'livree', 'litige', 'confirme']) }, take: 100 });
    return [...items, ...flagged.filter((f) => !items.some((i) => i.id === f.id))];
  }

  /**
   * Article payé (AUDIT §58) : l'annonce passe « vendue » — elle sort des résultats et n'est plus achetable, mais elle
   * reste là : si la vente est annulée ou remboursée, le vendeur la remet en ligne d'un clic (ce n'est pas
   * automatique, il a pu vendre l'objet ailleurs entre-temps). Elle est supprimée une fois l'article reçu.
   */
  private async markListingSold(tx: Transaction) {
    await this.listingsRepo.update({ id: tx.listingId, status: In(['en_ligne', 'expiree']) }, { status: 'vendue' });
  }

  /**
   * Article reçu par l'acheteur : la vente est définitive, l'annonce est supprimée comme le ferait le vendeur
   * (photos, favoris, historique ; la vente payée garde sa trace comptable et le titre de l'annonce). Un échec de
   * suppression ne remet jamais en cause la confirmation ni le virement.
   */
  private async removeSoldListing(tx: Transaction) {
    try {
      const listing = await this.listingsRepo.findOne({ where: { id: tx.listingId } });
      // AUDIT §63 : archivée (invisible pour les membres, consultable par l'administration en cas de litige), effacée plus tard
      if (listing) await this.retention.archiveListing(listing);
    } catch (e) {
      this.logger.error(`Transaction ${tx.id} : suppression de l'annonce vendue ${tx.listingId} impossible (${(e as Error).message})`);
    }
  }

  private async notifySellerPaid(tx: Transaction, title?: string) {
    await this.markListingSold(tx);
    const t = title ?? (await this.listingsRepo.findOne({ where: { id: tx.listingId } }))?.title ?? 'votre annonce';
    await this.notifications.notify(tx.sellerId, {
      type: 'transaction',
      title: 'Nouvelle vente sécurisée',
      body: `Un acheteur a payé « ${t} ». Confirmez la disponibilité et organisez la remise.`,
      link: `/compte/transactions/${tx.id}`,
    });
    await this.track(tx, 'achat_confirme', tx.buyerId, 'Achat confirmé : paiement sécurisé, conservé par Trocoin', {
      amount: round2(tx.amount + tx.buyerFee + (tx.shippingFee ?? 0)),
      shipping: tx.shippingFee ?? 0,
      price: tx.amount,
      listPrice: tx.listPrice ?? null,
      deliveryMethod: tx.deliveryMethod,
      deliveryMode: tx.deliveryMode ?? null,
      pickupPoint: tx.pickupPoint ? `${tx.pickupPoint.name}, ${tx.pickupPoint.city}` : null,
    });
  }

  /**
   * Étape de la vente inscrite dans la conversation acheteur–vendeur (AUDIT §57). Les actions restent celles de
   * cette classe : la messagerie ne fait que les raconter, elle ne porte aucune logique de paiement.
   */
  private track(tx: Transaction, event: SystemEvent, actorId: string, content: string, meta?: Record<string, string | number | null>) {
    return this.conversations.postSystemEvent({ listingId: tx.listingId, buyerId: tx.buyerId, sellerId: tx.sellerId, actorId, transactionId: tx.id, event, content, meta });
  }

  /**
   * Transaction « en_attente » (paiement hébergé) : relit l'état chez le fournisseur et l'applique.
   * Idempotent : appelé au retour de l'acheteur, par le webhook, et par la tâche périodique.
   */
  async syncPending(tx: Transaction): Promise<{ tx: Transaction; checkoutUrl?: string }> {
    if (tx.status !== 'en_attente') return { tx };
    const expired = new Date(tx.createdAt).getTime() < Date.now() - PENDING_TTL_MS - 5 * 60_000;
    let sync: CheckoutSync = { status: expired ? 'annulee' : 'en_attente' };
    if (this.paymentProvider.syncCheckout && tx.providerPaymentId) {
      try {
        sync = await this.paymentProvider.syncCheckout(tx.providerPaymentId);
      } catch (e) {
        this.logger.warn(`Relecture du paiement ${tx.id} impossible : ${(e as Error).message}`);
        if (!expired) return { tx };
      }
    }
    if (sync.status === 'sequestre') {
      tx.status = 'sequestre';
      if (sync.providerPaymentId) tx.providerPaymentId = sync.providerPaymentId;
      if (sync.paymentMethodType) tx.paymentMethod = sync.paymentMethodType;
      this.enterEscrow(tx, sync.captureBefore);
      if (sync.extendedAuthorization) this.logger.log(`Transaction ${tx.id} : autorisation prolongée accordée (capture avant ${tx.captureBefore?.toISOString()})`);
      const saved = await this.transactionsRepo.save(tx);
      await this.notifySellerPaid(saved);
      return { tx: saved };
    }
    if (sync.status === 'annulee' || expired) {
      tx.status = 'annulee';
      tx.resolvedAt = new Date();
      tx.resolutionNote = 'Paiement non finalisé';
      if (sync.providerPaymentId) tx.providerPaymentId = sync.providerPaymentId;
      return { tx: await this.transactionsRepo.save(tx) };
    }
    return { tx, checkoutUrl: sync.checkoutUrl };
  }

  /** Pages de paiement abandonnées : relues puis annulées toutes les 10 minutes. */
  @Cron('*/10 * * * *')
  async expirePendingCheckouts(): Promise<number> {
    const stale = await this.transactionsRepo.find({ where: { status: 'en_attente', createdAt: LessThan(new Date(Date.now() - PENDING_TTL_MS)) }, take: 50 });
    let n = 0;
    for (const tx of stale) {
      const { tx: after } = await this.syncPending(tx);
      if (after.status !== 'en_attente') n += 1;
    }
    return n;
  }

  /** Webhook du fournisseur (signature vérifiée par le fournisseur) : applique l'évènement, idempotent. */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ received: true; handled: string }> {
    if (!this.paymentProvider.parseWebhook) throw new NotFoundException('Aucun webhook pour ce fournisseur de paiement.');
    if (!rawBody) throw new BadRequestException('Corps brut manquant.');
    let event: ReturnType<NonNullable<IPaymentProvider['parseWebhook']>>;
    try {
      event = this.paymentProvider.parseWebhook(rawBody, signature);
    } catch (err) {
      traceWebhookRejected(`${(err as Error).message.split('\n')[0].slice(0, 120)} [signatures v1 dans l'en-tête : ${countSignatures(signature)} ; corps brut : ${rawBody ? rawBody.length + ' octets' : 'absent'}]`);
      throw err;
    }
    traceWebhookAccepted(event.raw, event.accountId);
    this.logger.log(`Webhook ${event.raw} (${event.id}) → ${event.type}`);
    if (event.type === 'checkout_completed' || event.type === 'checkout_expired') {
      const tx = await this.findByProviderRef(event.transactionId, event.providerSessionId);
      if (tx && tx.status === 'en_attente') await this.syncPending(tx);
      else if (event.type === 'checkout_completed' && (!tx || tx.status === 'annulee') && event.providerSessionId && this.paymentProvider.syncCheckout) {
        // Payé sur une page restée ouverte alors que la vente a été abandonnée ou l'annonce supprimée : rien ne doit rester bloqué chez l'acheteur
        const sync = await this.paymentProvider.syncCheckout(event.providerSessionId).catch(() => null);
        if (sync?.providerPaymentId) {
          await this.paymentProvider.refund(sync.providerPaymentId).catch((e) => this.logger.error(`Paiement orphelin ${sync.providerPaymentId} : libération impossible (${(e as Error).message})`));
          this.logger.warn(`Paiement ${sync.providerPaymentId} reçu pour une vente ${tx ? 'annulée' : 'introuvable'} : autorisation libérée`);
        }
      }
    } else if (event.type === 'account_updated' && event.accountId) {
      try {
        await this.stripeConnect.applyAccountUpdate(event.accountId, event.account as never);
      } catch (err) {
        // Trace visible dans /health, puis 500 : le prestataire réessaiera
        traceWebhookRejected(`account.updated ${event.accountId} : ${(err as Error).message}`);
        throw err;
      }
    } else if (event.type === 'payment_canceled' && event.providerPaymentId) {
      const tx = await this.transactionsRepo.findOne({ where: { providerPaymentId: event.providerPaymentId } });
      if (tx && tx.status === 'livree') {
        // AUDIT §69 : l'article est parti et le vendeur ne sera pas payé — l'administration tranche, rien n'est clos en silence
        await this.flagPaymentIssue(tx, new PaymentProviderError('autorisation_expiree', "Autorisation annulée chez le prestataire alors que l'article était expédié : le vendeur n'est pas payé."), 'annulation chez le prestataire');
      } else if (tx && tx.status === 'sequestre') {
        tx.status = 'annulee';
        tx.resolvedAt = new Date();
        tx.resolutionNote = 'Autorisation annulée chez le fournisseur de paiement';
        await this.transactionsRepo.save(tx);
        await this.shipping.cancelLabelFor(tx.id).catch(() => undefined);
        for (const uid of [tx.buyerId, tx.sellerId]) {
          await this.notifications.notify(uid, { type: 'transaction', title: 'Transaction annulée', body: "L'autorisation de paiement a été annulée : aucun montant ne sera débité.", link: `/compte/transactions/${tx.id}` });
        }
      }
    } else if (event.type === 'payment_refunded' && event.providerPaymentId) {
      const tx = await this.transactionsRepo.findOne({ where: { providerPaymentId: event.providerPaymentId } });
      if (tx && ['sequestre', 'livree', 'confirme', 'litige'].includes(tx.status)) {
        // AUDIT §63 : remboursement fait depuis le tableau de bord du prestataire alors que le vendeur a déjà été payé → le
        // virement est annulé (sinon Trocoin paie deux fois)
        if (this.isPlatform(tx) && tx.transferId && !tx.transferId.startsWith('en-cours:')) {
          try {
            await this.paymentProvider.reverseTransfer(tx.transferId);
            tx.transferId = null;
            tx.transferredAt = null;
          } catch (e) {
            this.logger.error(`Transaction ${tx.id} : virement ${tx.transferId} non annulé après remboursement externe (${(e as Error).message}) — à récupérer à la main`);
          }
        }
        tx.status = 'rembourse';
        tx.resolvedAt = new Date();
        tx.resolutionNote = tx.resolutionNote || 'Remboursement constaté chez le fournisseur de paiement';
        await this.transactionsRepo.save(tx);
        await this.notifications.notify(tx.buyerId, { type: 'transaction', title: 'Remboursement effectué', body: 'Le remboursement de votre achat a été émis par le fournisseur de paiement.', link: `/compte/transactions/${tx.id}` });
      }
    }
    return { received: true, handled: event.type };
  }

  private async findByProviderRef(transactionId?: string, providerSessionId?: string): Promise<Transaction | null> {
    if (transactionId) {
      const byId = await this.transactionsRepo.findOne({ where: { id: transactionId } });
      if (byId) return byId;
    }
    if (providerSessionId) return this.transactionsRepo.findOne({ where: { providerPaymentId: providerSessionId } });
    return null;
  }

  async listMine(userId: string) {
    const txs = await this.transactionsRepo
      .createQueryBuilder('t')
      .where('t.buyerId = :userId OR t.sellerId = :userId', { userId })
      .orderBy('t.createdAt', 'DESC')
      .getMany();
    const listingIds = [...new Set(txs.map((t) => t.listingId))];
    const listings = listingIds.length ? await this.listingsRepo.find({ where: { id: In(listingIds) } }) : [];
    const byId = new Map(listings.map((l) => [l.id, l]));
    // AUDIT §69 : un profil public par interlocuteur distinct (et non par vente)
    const summaries = new Map<string, unknown>();
    const result: any[] = [];
    for (const t of txs) {
      const otherId = t.buyerId === userId ? t.sellerId : t.buyerId;
      if (!summaries.has(otherId)) summaries.set(otherId, await this.usersService.findPublicSummary(otherId));
      const other = summaries.get(otherId);
      const l = byId.get(t.listingId);
      result.push({
        ...this.viewFor(t, userId),
        role: t.buyerId === userId ? 'acheteur' : 'vendeur',
        other,
        listing: l && l.status !== 'archivee' ? { id: l.id, title: l.title, price: l.price, status: l.status } : null, // archivée = supprimée pour les membres (AUDIT §63)
      });
    }
    return result;
  }

  async getOne(transactionId: string, userId: string) {
    let tx = await this.getOwned(transactionId, userId);
    let checkoutUrl: string | undefined;
    if (tx.status === 'en_attente') ({ tx, checkoutUrl } = await this.syncPending(tx));
    const found = await this.listingsRepo.findOne({ where: { id: tx.listingId } });
    const listing = found && found.status !== 'archivee' ? found : null; // archivée = supprimée pour les membres (AUDIT §63)
    const otherId = tx.buyerId === userId ? tx.sellerId : tx.buyerId;
    const other = await this.usersService.findPublicSummary(otherId);
    return {
      ...this.viewFor(tx, userId, checkoutUrl),
      role: tx.buyerId === userId ? 'acheteur' : 'vendeur',
      other,
      listing: listing ? { id: listing.id, title: listing.title, price: listing.price, status: listing.status } : null,
      // Montants figés de CETTE vente (jamais recalculés avec le barème du jour) et barème appliqué à sa création
      quote: quoteOfTransaction(tx),
      rates: tx.feeRates ?? null,
      conversationId: await this.conversations.findIdFor(tx.listingId, tx.buyerId),
    };
  }

  /** Le vendeur déclare l'expédition (n° de suivi) ou la remise prête. */
  markShipped(transactionId: string, userId: string, trackingNumber?: string): Promise<Transaction> {
    return this.locked(transactionId, () => this.markShippedNow(transactionId, userId, trackingNumber));
  }

  private async markShippedNow(transactionId: string, userId: string, trackingNumber?: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.sellerId !== userId) throw new ForbiddenException("Seul le vendeur peut déclarer l'envoi.");
    if (tx.status !== 'sequestre') throw new BadRequestException(`Impossible depuis le statut "${tx.status}".`);
    // Une étiquette achetée via Trocoin a déjà fourni le numéro de suivi (ShippingService)
    const tracking = trackingNumber || tx.deliveryTrackingNumber;
    if (tx.deliveryMethod !== 'main_propre' && !tracking) {
      throw new BadRequestException('Un numéro de suivi est requis pour un envoi.');
    }
    // Numéro saisi à la main : forme d'un vrai numéro de suivi
    if (tx.deliveryMethod !== 'main_propre' && trackingNumber && !/^[A-Z0-9]{8,30}$/i.test(trackingNumber.replace(/[\s-]/g, ''))) {
      throw new BadRequestException('Numéro de suivi invalide : 8 à 30 lettres ou chiffres.');
    }
    // AUDIT §63 : quand l'acheteur a payé la livraison, l'envoi passe normalement par le bon d'envoi de Trocoin (numéro de
    // suivi réel du transporteur). Un numéro saisi à la main reste possible en secours, mais il ne déclenche PAS la
    // réception présumée : un numéro inventé faisait payer le vendeur sans envoi au bout de 7 jours. L'acheteur confirme,
    // ou l'administration tranche.
    const labelled = tx.deliveryMethod !== 'main_propre' && tx.shippingQuote ? !!(await this.shipments.findOne({ where: { transactionId: tx.id, status: In(['etiquette_prete', 'expediee']) } })) : true;
    // Modèle platform : le vendeur s'engage (expédition ou remise prête), les fonds sont encaissés maintenant
    // (AUDIT §69 : refus du prestataire rendu en clair et signalé à l'administration, plus jamais « Erreur interne »)
    try {
      await this.ensureCaptured(tx);
    } catch (err) {
      await this.flagPaymentIssue(tx, err, "capture à l'expédition");
      await this.providerCall(() => Promise.reject(err));
    }
    tx.status = 'livree';
    tx.deliveryTrackingNumber = tracking;
    await this.shipments.update({ transactionId: tx.id, status: 'etiquette_prete' }, { status: 'expediee' });
    tx.shippedAt = new Date();
    if (tx.deliveryMethod !== 'main_propre') {
      // Réception présumée : N jours après l'expédition (ancien modèle : jamais après la marge de sécurité de l'autorisation)
      const wanted = tx.shippedAt.getTime() + ESCROW_AUTO_CONFIRM_DAYS * DAY_MS;
      tx.autoConfirmAt = labelled ? new Date(this.isPlatform(tx) ? wanted : Math.min(wanted, this.escrowDeadline(tx).getTime())) : undefined;
      if (!labelled) this.logger.warn(`Transaction ${tx.id} : expédition déclarée à la main sur une livraison prépayée (${tracking}) — pas de réception présumée`);
      tx.escrowStage = 0; // les rappels repartent sur la nouvelle échéance (réception)
    }
    const saved = await this.transactionsRepo.save(tx);
    await this.notifications.notify(tx.buyerId, {
      type: 'transaction',
      title: tx.deliveryMethod === 'main_propre' ? 'Le vendeur est prêt pour la remise' : 'Votre colis est en route',
      body: tracking
        ? `Numéro de suivi : ${tracking}. Confirmez la réception ou signalez un problème avant le ${frDate(saved.autoConfirmAt!)} : passé cette date, la réception sera considérée acquise.`
        : 'Convenez d\'un rendez-vous et confirmez la réception une fois l\'objet en main.',
      link: `/compte/transactions/${tx.id}`,
    });
    if (tx.deliveryMethod === 'main_propre') {
      await this.track(saved, 'pret_pour_remise', tx.sellerId, 'Le vendeur est prêt pour la remise en main propre');
    } else {
      const shipment = await this.shipments.findOne({ where: { transactionId: tx.id } });
      await this.track(saved, 'expedie', tx.sellerId, `Colis expédié — suivi ${tracking}`, {
        trackingNumber: tracking ?? null,
        trackingUrl: shipment?.trackingUrl || carrierTrackingUrl(tx.deliveryMethod, tracking ?? '') || null,
        carrier: tx.deliveryMethod,
        autoConfirmAt: saved.autoConfirmAt ? new Date(saved.autoConfirmAt).toISOString() : null,
      });
    }
    return saved;
  }

  /**
   * Le vendeur confirme que l'article existe et est prêt à partir (AUDIT §57). Étape d'information : elle rassure
   * l'acheteur et ne bloque rien (expédier sans avoir cliqué vaut confirmation). Une seule fois par vente.
   */
  async confirmAvailability(transactionId: string, userId: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.sellerId !== userId) throw new ForbiddenException("Seul le vendeur confirme la disponibilité de l'article.");
    if (tx.status !== 'sequestre') throw new BadRequestException(`Impossible depuis le statut "${tx.status}".`);
    if (tx.sellerConfirmedAt) return tx;
    tx.sellerConfirmedAt = new Date();
    const saved = await this.transactionsRepo.save(tx);
    await this.notifications.notify(tx.buyerId, {
      type: 'transaction',
      title: 'Article disponible',
      body: tx.deliveryMethod === 'main_propre' ? "Le vendeur a confirmé que l'article est disponible : convenez du rendez-vous par messagerie." : "Le vendeur a confirmé que l'article est disponible et prépare l'envoi.",
      link: `/compte/transactions/${tx.id}`,
    });
    await this.track(saved, 'disponibilite_confirmee', tx.sellerId, "Le vendeur a confirmé la disponibilité de l'article");
    return saved;
  }

  /**
   * L'acheteur renonce à un paiement hébergé non finalisé (carte refusée, changement d'avis) : la page de paiement
   * est fermée chez le fournisseur et l'annonce redevient achetable tout de suite. Si le paiement a en réalité
   * abouti entre-temps, la vente suit son cours normal (rien n'est annulé).
   */
  async abandonPending(transactionId: string, userId: string) {
    let tx = await this.getOwned(transactionId, userId);
    if (tx.buyerId !== userId) throw new ForbiddenException("Seul l'acheteur peut abandonner son paiement.");
    if (tx.status === 'en_attente') ({ tx } = await this.syncPending(tx));
    if (tx.status !== 'en_attente') return this.viewFor(tx, userId);
    if (this.paymentProvider.expireCheckout && tx.providerPaymentId) {
      await this.paymentProvider.expireCheckout(tx.providerPaymentId).catch((e) => this.logger.warn(`Fermeture de la page de paiement ${tx.id} impossible : ${(e as Error).message}`));
    }
    tx.status = 'annulee';
    tx.resolvedAt = new Date();
    tx.resolutionNote = "Paiement abandonné par l'acheteur";
    return this.viewFor(await this.transactionsRepo.save(tx), userId);
  }

  /** L'acheteur confirme la réception -> capture des fonds. */
  async confirmDelivery(transactionId: string, userId: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.buyerId !== userId) throw new ForbiddenException("Seul l'acheteur peut confirmer la réception.");
    if (tx.status !== 'sequestre' && tx.status !== 'livree') {
      throw new BadRequestException(`Impossible de confirmer une transaction "${tx.status}".`);
    }
    // AUDIT §69 : « confirmez la réception, sinon je ne peux pas expédier » — un acheteur pressé libérait le paiement avant
    // tout envoi, puis ne pouvait plus ouvrir de litige. Avec envoi, la confirmation attend l'expédition déclarée.
    if (tx.deliveryMethod !== 'main_propre' && tx.status === 'sequestre') {
      throw new BadRequestException("Le vendeur n'a pas encore déclaré l'expédition : vous pourrez confirmer la réception une fois le colis envoyé. Ne confirmez jamais avant d'avoir l'article en main.");
    }
    const before = { status: tx.status, confirmedAt: tx.confirmedAt ?? null };
    await this.claim(tx, ['sequestre', 'livree'], { status: 'confirme', confirmedAt: new Date() });
    try {
      await this.settle(tx);
    } catch (e) {
      await this.release(tx, before as Partial<Transaction>);
      throw e;
    }
    const saved = await this.transactionsRepo.save(tx);
    await this.removeSoldListing(saved);
    await this.notifications.notify(tx.sellerId, {
      type: 'transaction',
      title: 'Vente confirmée',
      body: this.isPlatform(saved) && !saved.transferId
        ? 'L\'acheteur a confirmé la réception. Le versement attend votre compte de paiement : configurez-le dans Mes paiements pour recevoir les fonds.'
        : 'L\'acheteur a confirmé la réception : les fonds vous sont versés. Pensez à laisser un avis.',
      link: `/compte/transactions/${tx.id}`,
    });
    await this.track(saved, 'reception_confirmee', tx.buyerId, "Réception confirmée par l'acheteur", { payout: this.sellerPayout(saved), transferred: this.isPlatform(saved) && !saved.transferId ? 0 : 1 });
    return saved;
  }

  /** Remise en main propre : le vendeur saisit le code donné par l'acheteur -> équivaut à la confirmation. */
  async confirmHandover(transactionId: string, userId: string, code: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.sellerId !== userId) throw new ForbiddenException('Seul le vendeur saisit le code de remise.');
    if (tx.deliveryMethod !== 'main_propre') throw new BadRequestException('Cette transaction n\'est pas une remise en main propre.');
    if (!['sequestre', 'livree'].includes(tx.status)) throw new BadRequestException(`Impossible depuis le statut "${tx.status}".`);
    const attempts = this.handoverFailures.get(tx.id);
    if (attempts && attempts.count >= 5 && attempts.until > Date.now()) throw new BadRequestException('Trop de codes incorrects sur cette vente : réessayez dans une heure, ou ouvrez un litige.');
    if (!tx.handoverCode || tx.handoverCode !== code) {
      const next = attempts && attempts.until > Date.now() ? attempts.count + 1 : 1;
      this.handoverFailures.set(tx.id, { count: next, until: Date.now() + HOUR_MS });
      throw new BadRequestException('Code de remise incorrect.');
    }
    this.handoverFailures.delete(tx.id);
    const before = { status: tx.status, confirmedAt: tx.confirmedAt ?? null };
    await this.claim(tx, ['sequestre', 'livree'], { status: 'confirme', confirmedAt: new Date() });
    try {
      await this.settle(tx);
    } catch (e) {
      await this.release(tx, before as Partial<Transaction>);
      throw e;
    }
    const saved = await this.transactionsRepo.save(tx);
    await this.removeSoldListing(saved);
    await this.notifications.notify(tx.buyerId, {
      type: 'transaction',
      title: 'Remise confirmée',
      body: 'Le vendeur a validé la remise en main propre. Merci de laisser un avis.',
      link: `/compte/transactions/${tx.id}`,
    });
    await this.track(saved, 'remise_validee', tx.sellerId, 'Remise en main propre validée', { payout: this.sellerPayout(saved), transferred: this.isPlatform(saved) && !saved.transferId ? 0 : 1 });
    return saved;
  }

  /** Annulation avant envoi : par le vendeur (indisponible) ou l'acheteur -> remboursement. */
  async cancel(transactionId: string, userId: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.status !== 'sequestre') throw new BadRequestException('Annulation possible uniquement avant expédition / remise.');
    await this.claim(tx, ['sequestre'], { status: 'annulee', resolvedAt: new Date(), resolutionNote: userId === tx.sellerId ? 'Annulée par le vendeur' : "Annulée par l'acheteur" });
    try {
      await this.refundBuyer(tx);
    } catch (e) {
      await this.release(tx, { status: 'sequestre', resolvedAt: null, resolutionNote: null } as unknown as Partial<Transaction>);
      throw e;
    }
    await this.cancelLabelOrAlert(tx);
    const saved = await this.transactionsRepo.save(tx);
    const otherId = userId === tx.sellerId ? tx.buyerId : tx.sellerId;
    await this.notifications.notify(otherId, {
      type: 'transaction',
      title: 'Transaction annulée',
      body: otherId === tx.sellerId ? "L'acheteur a annulé son achat avant l'envoi : il est intégralement remboursé. Votre annonce est restée marquée « Vendue » : remettez-la en ligne depuis Mes annonces si l'article est toujours à vendre." : "Le vendeur a annulé la vente avant l'envoi : vous êtes intégralement remboursé.",
      link: `/compte/transactions/${tx.id}`,
    });
    await this.track(saved, 'vente_annulee', userId, 'Vente annulée : acheteur remboursé', { by: userId === tx.sellerId ? 'vendeur' : 'acheteur' });
    return saved;
  }

  async openDispute(transactionId: string, userId: string, reason: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    // Après une capture automatique (réception présumée, échéance), l'acheteur garde une fenêtre de litige
    const postCaptureWindow = tx.status === 'confirme' && !!tx.autoResolution && !!tx.disputeAllowedUntil && new Date(tx.disputeAllowedUntil).getTime() > Date.now() && userId === tx.buyerId;
    if (!['sequestre', 'livree'].includes(tx.status) && !postCaptureWindow) {
      throw new BadRequestException(`Impossible d'ouvrir un litige sur une transaction "${tx.status}".`);
    }
    // Modèle platform : les fonds sont mis en sécurité sur le solde de Trocoin dès l'ouverture du litige
    // (un litige peut durer plus longtemps qu'une autorisation bancaire)
    const previous = tx.status;
    await this.claim(tx, [previous], { status: 'litige', disputeReason: reason, disputeOpenedBy: userId });
    try {
      await this.providerCall(() => this.ensureCaptured(tx));
    } catch (e) {
      await this.release(tx, { status: previous, disputeReason: null, disputeOpenedBy: null } as unknown as Partial<Transaction>);
      throw e;
    }
    const saved = await this.transactionsRepo.save(tx);
    const otherId = userId === tx.sellerId ? tx.buyerId : tx.sellerId;
    await this.notifications.notify(otherId, {
      type: 'transaction',
      title: 'Litige ouvert',
      body: 'Un litige a été ouvert sur votre transaction. Un médiateur Trocoin va l\'examiner.',
      link: `/compte/transactions/${tx.id}`,
    });
    await this.track(saved, 'litige_ouvert', userId, 'Litige ouvert : un médiateur Trocoin examine le dossier', { by: userId === tx.sellerId ? 'vendeur' : 'acheteur' });
    return saved;
  }

  // ---------------------------------------------------------- administration

  /**
   * Décision admin (litige, fraude, conflit) : rembourser l'acheteur, libérer les fonds au vendeur ou annuler
   * la vente. Possible sur toute transaction encore ouverte (séquestre, expédiée, litige) et, pour un
   * remboursement, sur une transaction confirmée automatiquement tant que sa fenêtre de litige est ouverte.
   */
  resolveDispute(transactionId: string, decision: 'rembourser' | 'liberer' | 'annuler', note: string): Promise<Transaction> {
    return this.locked(transactionId, () => this.resolveDisputeNow(transactionId, decision, note));
  }

  private async resolveDisputeNow(transactionId: string, decision: 'rembourser' | 'liberer' | 'annuler', note: string): Promise<Transaction> {
    const tx = await this.transactionsRepo.findOne({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    if (tx.resolvedAt && ['rembourse', 'annulee'].includes(tx.status)) throw new ConflictException('Cette vente a déjà été tranchée.');
    const open = ['sequestre', 'livree', 'litige'].includes(tx.status);
    const refundableAfterCapture = tx.status === 'confirme' && !!tx.autoResolution && !!tx.disputeAllowedUntil && new Date(tx.disputeAllowedUntil).getTime() > Date.now();
    if (!open && !(decision === 'rembourser' && refundableAfterCapture)) {
      throw new BadRequestException(`Aucune décision possible sur une transaction "${tx.status}".`);
    }
    // AUDIT §69 : la décision prend la vente de façon atomique (`claim`) AVANT tout mouvement d'argent — sinon une confirmation
    // de l'acheteur ou une annulation au même instant faisait payer le vendeur ET rembourser l'acheteur, en perdant la trace du virement
    const previous = tx.status;
    const reload = async () => {
      const fresh = await this.transactionsRepo.findOne({ where: { id: tx.id } });
      if (fresh) Object.assign(tx, { transferId: fresh.transferId, transferredAt: fresh.transferredAt, capturedAt: fresh.capturedAt, confirmedAt: fresh.confirmedAt ?? tx.confirmedAt });
    };
    if (decision === 'annuler') {
      if (tx.confirmedAt) throw new BadRequestException('Vente déjà confirmée : utilisez « rembourser ».');
      await this.claim(tx, [previous], { status: 'annulee', resolvedAt: new Date() });
      await reload();
      try {
        await this.providerCall(() => this.refundBuyer(tx));
      } catch (err) {
        // Paiement inconnu du prestataire (AUDIT §65) : rien à rendre chez lui, la vente est close et la note le dit
        const e = err as { getResponse?: () => { code?: string } };
        if (e?.getResponse?.()?.code !== 'paiement_absent') {
          await this.release(tx, { status: previous, resolvedAt: null } as unknown as Partial<Transaction>);
          throw err;
        }
        note = `${note} (paiement inconnu du prestataire : aucun mouvement d'argent possible)`;
      }
      await this.cancelLabelOrAlert(tx);
      tx.resolutionNote = note;
      const cancelled = await this.transactionsRepo.save(tx);
      for (const uid of [tx.buyerId, tx.sellerId]) {
        await this.notifications.notify(uid, { type: 'transaction', title: 'Vente annulée par Trocoin', body: `L'acheteur est intégralement remboursé. ${note}`, link: `/compte/transactions/${tx.id}` });
      }
      return cancelled;
    }
    if (decision === 'rembourser') {
      // Autorisation encore ouverte : annulée ; fonds encaissés : remboursés (modèle platform : depuis le solde
      // de Trocoin, après annulation du virement s'il a déjà eu lieu)
      await this.claim(tx, [previous], { status: 'rembourse', resolvedAt: new Date() });
      await reload();
      try {
        await this.providerCall(() => this.refundBuyer(tx));
      } catch (err) {
        await this.release(tx, { status: previous, resolvedAt: null } as unknown as Partial<Transaction>);
        throw err;
      }
      await this.cancelLabelOrAlert(tx);
      // L'annonce reste « vendue » : le vendeur la remet en ligne lui-même s'il a récupéré l'article (AUDIT §58)
    } else {
      // Ancien modèle : déjà capturé si l'échéance est passée ; modèle platform : capture si besoin puis virement
      const hadConfirmedAt = tx.confirmedAt ?? null;
      await this.claim(tx, [previous], { status: 'confirme', confirmedAt: hadConfirmedAt ?? new Date(), resolvedAt: new Date() });
      await reload();
      try {
        if (this.isPlatform(tx) || !hadConfirmedAt) await this.providerCall(() => this.settle(tx));
      } catch (err) {
        await this.release(tx, { status: previous, confirmedAt: hadConfirmedAt, resolvedAt: null } as unknown as Partial<Transaction>);
        throw err;
      }
      await this.removeSoldListing(tx);
    }
    tx.resolutionNote = note;
    const saved = await this.transactionsRepo.save(tx);
    for (const uid of [tx.buyerId, tx.sellerId]) {
      await this.notifications.notify(uid, {
        type: 'transaction',
        title: 'Litige tranché',
        body: decision === 'rembourser' ? 'Décision : remboursement de l\'acheteur.' : 'Décision : fonds libérés au vendeur.',
        link: `/compte/transactions/${tx.id}`,
      });
    }
    await this.track(saved, 'litige_resolu', tx.sellerId, decision === 'rembourser' ? "Litige clos : l'acheteur est remboursé" : 'Litige clos : les fonds sont versés au vendeur', { decision });
    return saved;
  }

  /** Vente annulée/remboursée : bon d'envoi retiré ; s'il ne peut pas être annulé chez le prestataire, l'administration est prévenue (AUDIT §69). */
  private async cancelLabelOrAlert(tx: Transaction): Promise<void> {
    const r = await this.shipping.cancelLabelFor(tx.id).catch(() => ({ label: true, cancelled: false }));
    if (!r.label || r.cancelled) return;
    for (const adminId of await this.usersService.findAdminIds()) {
      await this.notifications.notify(adminId, { type: 'transaction', title: "Bon d'envoi à annuler à la main", body: `Vente ${tx.id.slice(0, 8)} annulée : le bon d'envoi n'a pas pu être annulé chez le prestataire (frais de port ${tx.shippingFee ?? 0} € à récupérer ou à assumer).`, link: `/admin/litiges/${tx.id}` });
    }
  }

  private async getOwned(transactionId: string, userId: string): Promise<Transaction> {
    const tx = await this.transactionsRepo.findOne({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à cette transaction.");
    }
    return tx;
  }

  /**
   * Le code de remise (et l'URL de paiement) ne sont visibles que par l'acheteur ; les références du fournisseur restent
   * internes. TOUTE réponse d'une route de vente passe par ici (AUDIT §60) : les routes d'action (expédier, confirmer,
   * annuler, litige…) renvoyaient l'entité brute — le vendeur y lisait le code de remise et pouvait valider la remise seul.
   */
  viewFor(tx: Transaction, viewerId: string, checkoutUrl?: string) {
    const { handoverCode, providerPaymentId, transferId, ...rest } = tx;
    void providerPaymentId;
    void transferId;
    const isBuyer = viewerId === tx.buyerId;
    return {
      ...rest,
      // AUDIT §69 : le signalement interne (message du prestataire, identifiant de paiement) reste à l'administration
      paymentIssue: rest.paymentIssue ? 'Un incident technique sur ce paiement est en cours de traitement par Trocoin.' : rest.paymentIssue,
      // Adresse de l'acheteur : le vendeur ne la voit qu'une fois la vente PAYÉE (un acheteur qui ouvre la page de paiement
      // puis renonce n'a pas à laisser son nom, son adresse et son téléphone au vendeur — AUDIT §60)
      shippingAddress: isBuyer || tx.paidAt ? rest.shippingAddress : null,
      handoverCode: isBuyer ? handoverCode : undefined,
      checkoutUrl: isBuyer && tx.status === 'en_attente' ? checkoutUrl : undefined,
    };
  }
}
