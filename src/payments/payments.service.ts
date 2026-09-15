import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { resolveSiteUrl } from '../config/env.validation';
import { Listing } from '../listings/listing.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Shipment } from '../shipping/shipment.entity';
import { StripeConnectService } from '../users/stripe-connect.service';
import { UsersService } from '../users/users.service';
import { CheckoutSync, IPaymentProvider } from './payment-provider.interface';
import { CHECKOUT_TTL_MINUTES, PAYMENT_PROVIDER } from './payments.constants';
import { DeliveryMethod, Transaction } from './transaction.entity';

/**
 * Barème (cahier des charges §3.6 : "commission transparente affichée
 * avant validation"). Modèle : le vendeur paie une commission de 8 %
 * retenue sur le versement ; l'acheteur paie des frais de protection
 * (5 % + 0,50 €, plafonnés à 15 €) ajoutés au prix.
 */
export const COMMISSION_RATE = 0.08;
export const BUYER_FEE_RATE = 0.05;
export const BUYER_FEE_FIXED = 0.5;
export const BUYER_FEE_CAP = 15;
export const MAX_SECURE_AMOUNT = 2500;
/** Familles exclues du paiement sécurisé (comme leboncoin). */
export const SECURE_PAYMENT_EXCLUDED_ROOTS = ['immobilier', 'vehicules', 'emploi', 'services', 'vacances', 'animaux'];

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Une page de paiement hébergée commencée depuis moins longtemps que cela bloque l'annonce (double vente). */
const PENDING_TTL_MS = CHECKOUT_TTL_MINUTES * 60_000;

export function computeQuote(price: number) {
  const commission = round2(price * COMMISSION_RATE);
  const buyerFee = round2(Math.min(price * BUYER_FEE_RATE + BUYER_FEE_FIXED, BUYER_FEE_CAP));
  return {
    price,
    commission,
    buyerFee,
    buyerTotal: round2(price + buyerFee),
    sellerPayout: round2(price - commission),
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Paiements');
  constructor(
    @InjectRepository(Transaction) private transactionsRepo: Repository<Transaction>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(Shipment) private shipments: Repository<Shipment>,
    @Inject(PAYMENT_PROVIDER) private paymentProvider: IPaymentProvider,
    private usersService: UsersService,
    private stripeConnect: StripeConnectService,
    private notifications: NotificationsService,
  ) {}

  /** Devis affiché avant validation : prix, frais acheteur, total, commission vendeur. */
  async quote(listingId: string, viewerId?: string) {
    const listing = await this.listingsRepo.findOne({ where: { id: listingId } });
    if (!listing || listing.status !== 'en_ligne') throw new NotFoundException('Annonce introuvable.');
    const eligibility = await this.checkEligibility(listing);
    return {
      eligible: eligibility.ok,
      reason: eligibility.reason,
      isOwner: viewerId === listing.userId,
      deliveryAvailable: listing.deliveryAvailable,
      ...(listing.price ? computeQuote(listing.price) : {}),
    };
  }

  private async checkEligibility(listing: Listing): Promise<{ ok: boolean; reason?: string }> {
    if (!listing.price || listing.price <= 0) return { ok: false, reason: 'Cette annonce n\'a pas de prix fixe.' };
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

  async createTransaction(buyerId: string, listingId: string, deliveryMethod: DeliveryMethod = 'main_propre') {
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

    const q = computeQuote(listing.price!);
    const sellerConnectedAccountId = await this.stripeConnect.getPayableAccountId(listing.userId);
    const applicationFeeEuros = round2(q.commission + q.buyerFee);
    const base = {
      listingId,
      buyerId,
      sellerId: listing.userId,
      amount: listing.price!,
      commission: q.commission,
      buyerFee: q.buyerFee,
      deliveryMethod,
      handoverCode: deliveryMethod === 'main_propre' ? randomInt(0, 1_000_000).toString().padStart(6, '0') : undefined,
    };
    const metadata = { listingId, buyerId, sellerId: listing.userId };

    if (this.paymentProvider.createCheckout) {
      // Paiement hébergé (Stripe Checkout) : la transaction attend l'autorisation de l'acheteur sur la
      // page du fournisseur ; elle passe « sequestre » à son retour (syncPending) ou par webhook.
      const pending = await this.transactionsRepo.save(this.transactionsRepo.create({ ...base, status: 'en_attente' }));
      const site = resolveSiteUrl();
      try {
        const buyer = await this.usersService.findById(buyerId);
        const checkout = await this.paymentProvider.createCheckout({
          transactionId: pending.id,
          amountEuros: q.buyerTotal,
          applicationFeeEuros,
          sellerConnectedAccountId,
          title: listing.title,
          buyerEmail: buyer?.email || undefined,
          successUrl: `${site}/compte/transactions/${pending.id}?paiement=retour`,
          cancelUrl: `${site}/annonces/${listingId}?paiement=annule`,
          metadata: { ...metadata, transactionId: pending.id },
        });
        pending.providerPaymentId = checkout.providerSessionId;
        await this.transactionsRepo.save(pending);
        return { transaction: this.viewFor(pending, buyerId, checkout.checkoutUrl), checkoutUrl: checkout.checkoutUrl, quote: q };
      } catch (e) {
        await this.transactionsRepo.delete(pending.id);
        this.logger.error(`Page de paiement impossible pour ${listingId} : ${(e as Error).message}`);
        throw new ServiceUnavailableException('Le service de paiement est momentanément indisponible. Réessayez dans quelques instants.');
      }
    }

    const intent = await this.paymentProvider.createPaymentIntent({ amountEuros: q.buyerTotal, applicationFeeEuros, sellerConnectedAccountId, metadata });
    const transaction = await this.transactionsRepo.save(
      this.transactionsRepo.create({ ...base, status: 'sequestre', providerPaymentId: intent.providerPaymentId }),
    );
    await this.notifySellerPaid(transaction, listing.title);
    return { transaction: this.viewFor(transaction, buyerId), clientSecret: intent.clientSecret, quote: q };
  }

  private async notifySellerPaid(tx: Transaction, title?: string) {
    const t = title ?? (await this.listingsRepo.findOne({ where: { id: tx.listingId } }))?.title ?? 'votre annonce';
    await this.notifications.notify(tx.sellerId, {
      type: 'transaction',
      title: 'Nouvelle vente sécurisée',
      body: `Un acheteur a payé « ${t} ». Confirmez la disponibilité et organisez la remise.`,
      link: `/compte/transactions/${tx.id}`,
    });
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
    const event = this.paymentProvider.parseWebhook(rawBody, signature);
    this.logger.log(`Webhook ${event.raw} (${event.id}) → ${event.type}`);
    if (event.type === 'checkout_completed' || event.type === 'checkout_expired') {
      const tx = await this.findByProviderRef(event.transactionId, event.providerSessionId);
      if (tx && tx.status === 'en_attente') await this.syncPending(tx);
    } else if (event.type === 'payment_canceled' && event.providerPaymentId) {
      const tx = await this.transactionsRepo.findOne({ where: { providerPaymentId: event.providerPaymentId } });
      if (tx && ['sequestre', 'livree'].includes(tx.status)) {
        tx.status = 'annulee';
        tx.resolvedAt = new Date();
        tx.resolutionNote = 'Autorisation annulée chez le fournisseur de paiement';
        await this.transactionsRepo.save(tx);
        for (const uid of [tx.buyerId, tx.sellerId]) {
          await this.notifications.notify(uid, { type: 'transaction', title: 'Transaction annulée', body: "L'autorisation de paiement a été annulée : aucun montant ne sera débité.", link: `/compte/transactions/${tx.id}` });
        }
      }
    } else if (event.type === 'payment_refunded' && event.providerPaymentId) {
      const tx = await this.transactionsRepo.findOne({ where: { providerPaymentId: event.providerPaymentId } });
      if (tx && ['sequestre', 'livree', 'confirme', 'litige'].includes(tx.status)) {
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
    const result: any[] = [];
    for (const t of txs) {
      const otherId = t.buyerId === userId ? t.sellerId : t.buyerId;
      const other = await this.usersService.findPublicSummary(otherId);
      const l = byId.get(t.listingId);
      result.push({
        ...this.viewFor(t, userId),
        role: t.buyerId === userId ? 'acheteur' : 'vendeur',
        other,
        listing: l ? { id: l.id, title: l.title, price: l.price, status: l.status } : null,
      });
    }
    return result;
  }

  async getOne(transactionId: string, userId: string) {
    let tx = await this.getOwned(transactionId, userId);
    let checkoutUrl: string | undefined;
    if (tx.status === 'en_attente') ({ tx, checkoutUrl } = await this.syncPending(tx));
    const listing = await this.listingsRepo.findOne({ where: { id: tx.listingId } });
    const otherId = tx.buyerId === userId ? tx.sellerId : tx.buyerId;
    const other = await this.usersService.findPublicSummary(otherId);
    return {
      ...this.viewFor(tx, userId, checkoutUrl),
      role: tx.buyerId === userId ? 'acheteur' : 'vendeur',
      other,
      listing: listing ? { id: listing.id, title: listing.title, price: listing.price, status: listing.status } : null,
      quote: computeQuote(tx.amount),
    };
  }

  /** Le vendeur déclare l'expédition (n° de suivi) ou la remise prête. */
  async markShipped(transactionId: string, userId: string, trackingNumber?: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.sellerId !== userId) throw new ForbiddenException("Seul le vendeur peut déclarer l'envoi.");
    if (tx.status !== 'sequestre') throw new BadRequestException(`Impossible depuis le statut "${tx.status}".`);
    // Une étiquette achetée via Trocoin a déjà fourni le numéro de suivi (ShippingService)
    const tracking = trackingNumber || tx.deliveryTrackingNumber;
    if (tx.deliveryMethod !== 'main_propre' && !tracking) {
      throw new BadRequestException('Un numéro de suivi est requis pour un envoi.');
    }
    tx.status = 'livree';
    tx.deliveryTrackingNumber = tracking;
    await this.shipments.update({ transactionId: tx.id, status: 'etiquette_prete' }, { status: 'expediee' });
    tx.shippedAt = new Date();
    const saved = await this.transactionsRepo.save(tx);
    await this.notifications.notify(tx.buyerId, {
      type: 'transaction',
      title: tx.deliveryMethod === 'main_propre' ? 'Le vendeur est prêt pour la remise' : 'Votre colis est en route',
      body: tracking ? `Numéro de suivi : ${tracking}` : 'Convenez d\'un rendez-vous et confirmez la réception une fois l\'objet en main.',
      link: `/compte/transactions/${tx.id}`,
    });
    return saved;
  }

  /** L'acheteur confirme la réception -> capture des fonds. */
  async confirmDelivery(transactionId: string, userId: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.buyerId !== userId) throw new ForbiddenException("Seul l'acheteur peut confirmer la réception.");
    if (tx.status !== 'sequestre' && tx.status !== 'livree') {
      throw new BadRequestException(`Impossible de confirmer une transaction "${tx.status}".`);
    }
    await this.paymentProvider.capture(tx.providerPaymentId!);
    tx.status = 'confirme';
    tx.confirmedAt = new Date();
    const saved = await this.transactionsRepo.save(tx);
    await this.listingsRepo.update({ id: tx.listingId, status: In(['en_ligne', 'expiree']) }, { status: 'vendue' });
    await this.notifications.notify(tx.sellerId, {
      type: 'transaction',
      title: 'Vente confirmée',
      body: 'L\'acheteur a confirmé la réception : les fonds vous sont versés. Pensez à laisser un avis.',
      link: `/compte/transactions/${tx.id}`,
    });
    return saved;
  }

  /** Remise en main propre : le vendeur saisit le code donné par l'acheteur -> équivaut à la confirmation. */
  async confirmHandover(transactionId: string, userId: string, code: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.sellerId !== userId) throw new ForbiddenException('Seul le vendeur saisit le code de remise.');
    if (tx.deliveryMethod !== 'main_propre') throw new BadRequestException('Cette transaction n\'est pas une remise en main propre.');
    if (!['sequestre', 'livree'].includes(tx.status)) throw new BadRequestException(`Impossible depuis le statut "${tx.status}".`);
    if (!tx.handoverCode || tx.handoverCode !== code) throw new BadRequestException('Code de remise incorrect.');
    await this.paymentProvider.capture(tx.providerPaymentId!);
    tx.status = 'confirme';
    tx.confirmedAt = new Date();
    const saved = await this.transactionsRepo.save(tx);
    await this.listingsRepo.update({ id: tx.listingId, status: In(['en_ligne', 'expiree']) }, { status: 'vendue' });
    await this.notifications.notify(tx.buyerId, {
      type: 'transaction',
      title: 'Remise confirmée',
      body: 'Le vendeur a validé la remise en main propre. Merci de laisser un avis.',
      link: `/compte/transactions/${tx.id}`,
    });
    return saved;
  }

  /** Annulation avant envoi : par le vendeur (indisponible) ou l'acheteur -> remboursement. */
  async cancel(transactionId: string, userId: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (tx.status !== 'sequestre') throw new BadRequestException('Annulation possible uniquement avant expédition / remise.');
    await this.paymentProvider.refund(tx.providerPaymentId!);
    tx.status = 'annulee';
    tx.resolvedAt = new Date();
    tx.resolutionNote = userId === tx.sellerId ? 'Annulée par le vendeur' : 'Annulée par l\'acheteur';
    const saved = await this.transactionsRepo.save(tx);
    const otherId = userId === tx.sellerId ? tx.buyerId : tx.sellerId;
    await this.notifications.notify(otherId, {
      type: 'transaction',
      title: 'Transaction annulée',
      body: 'La transaction a été annulée avant envoi. L\'acheteur est intégralement remboursé.',
      link: `/compte/transactions/${tx.id}`,
    });
    return saved;
  }

  async openDispute(transactionId: string, userId: string, reason: string): Promise<Transaction> {
    const tx = await this.getOwned(transactionId, userId);
    if (!['sequestre', 'livree'].includes(tx.status)) {
      throw new BadRequestException(`Impossible d'ouvrir un litige sur une transaction "${tx.status}".`);
    }
    tx.status = 'litige';
    tx.disputeReason = reason;
    tx.disputeOpenedBy = userId;
    const saved = await this.transactionsRepo.save(tx);
    const otherId = userId === tx.sellerId ? tx.buyerId : tx.sellerId;
    await this.notifications.notify(otherId, {
      type: 'transaction',
      title: 'Litige ouvert',
      body: 'Un litige a été ouvert sur votre transaction. Un médiateur Trocoin va l\'examiner.',
      link: `/compte/transactions/${tx.id}`,
    });
    return saved;
  }

  // ---------------------------------------------------------- administration

  /** Arbitrage admin : rembourser l'acheteur ou libérer les fonds au vendeur. */
  async resolveDispute(transactionId: string, decision: 'rembourser' | 'liberer', note: string): Promise<Transaction> {
    const tx = await this.transactionsRepo.findOne({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    if (tx.status !== 'litige') throw new BadRequestException('Cette transaction n\'est pas en litige.');
    if (decision === 'rembourser') {
      await this.paymentProvider.refund(tx.providerPaymentId!);
      tx.status = 'rembourse';
    } else {
      await this.paymentProvider.capture(tx.providerPaymentId!);
      tx.status = 'confirme';
      tx.confirmedAt = new Date();
      await this.listingsRepo.update({ id: tx.listingId, status: In(['en_ligne', 'expiree']) }, { status: 'vendue' });
    }
    tx.resolutionNote = note;
    tx.resolvedAt = new Date();
    const saved = await this.transactionsRepo.save(tx);
    for (const uid of [tx.buyerId, tx.sellerId]) {
      await this.notifications.notify(uid, {
        type: 'transaction',
        title: 'Litige tranché',
        body: decision === 'rembourser' ? 'Décision : remboursement de l\'acheteur.' : 'Décision : fonds libérés au vendeur.',
        link: `/compte/transactions/${tx.id}`,
      });
    }
    return saved;
  }

  private async getOwned(transactionId: string, userId: string): Promise<Transaction> {
    const tx = await this.transactionsRepo.findOne({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    if (tx.buyerId !== userId && tx.sellerId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à cette transaction.");
    }
    return tx;
  }

  /** Le code de remise (et l'URL de paiement) ne sont visibles que par l'acheteur. */
  private viewFor(tx: Transaction, viewerId: string, checkoutUrl?: string) {
    const { handoverCode, providerPaymentId, ...rest } = tx;
    const isBuyer = viewerId === tx.buyerId;
    return { ...rest, handoverCode: isBuyer ? handoverCode : undefined, checkoutUrl: isBuyer && tx.status === 'en_attente' ? checkoutUrl : undefined };
  }
}
