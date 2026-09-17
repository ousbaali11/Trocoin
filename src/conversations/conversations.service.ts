import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { Listing } from '../listings/listing.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { Conversation } from './conversation.entity';
import { Message, SystemEvent } from './message.entity';
import { Transaction } from '../payments/transaction.entity';
import { Shipment } from '../shipping/shipment.entity';
import { carrierTrackingUrl } from '../shipping/tracking-url';

/** Réponses rapides proposées par l'interface (cahier des charges §3.5). */
export const QUICK_REPLIES = [
  'Bonjour, est-ce toujours disponible ?',
  'Quel est votre dernier prix ?',
  'Où et quand peut-on se voir pour la remise en main propre ?',
  'Acceptez-vous un envoi avec paiement sécurisé ?',
  'Merci, je ne suis plus intéressé(e).',
];

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger('Conversations');
  constructor(
    @InjectRepository(Conversation) private conversationsRepo: Repository<Conversation>,
    @InjectRepository(Message) private messagesRepo: Repository<Message>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(ListingPhoto) private photosRepo: Repository<ListingPhoto>,
    @InjectRepository(Transaction) private transactionsRepo: Repository<Transaction>,
    @InjectRepository(Shipment) private shipmentsRepo: Repository<Shipment>,
    private usersService: UsersService,
    private notifications: NotificationsService,
  ) {}

  async startOrGet(buyerId: string, listingId: string, firstMessage?: string): Promise<Conversation> {
    const listing = await this.listingsRepo.findOne({ where: { id: listingId } });
    if (!listing || !['en_ligne', 'vendue'].includes(listing.status)) throw new NotFoundException('Annonce introuvable.');
    if (listing.userId === buyerId) throw new BadRequestException('Vous ne pouvez pas vous contacter vous-même.');
    if (await this.usersService.isBlockedEitherWay(buyerId, listing.userId)) {
      throw new ForbiddenException('Vous ne pouvez pas contacter cet utilisateur.');
    }
    const seller = await this.usersService.findById(listing.userId);
    if (!seller || seller.deletedAt || seller.suspendedAt) throw new NotFoundException('Ce vendeur n\'est plus disponible.');

    let conversation = await this.conversationsRepo.findOne({ where: { listingId, buyerId, sellerId: listing.userId } });
    if (!conversation) {
      conversation = await this.conversationsRepo.save(this.conversationsRepo.create({ listingId, buyerId, sellerId: listing.userId }));
    } else if (conversation.hiddenForBuyerAt) {
      // L'acheteur recontacte le vendeur : la conversation qu'il avait supprimée revient dans sa boîte
      await this.conversationsRepo.update(conversation.id, { hiddenForBuyerAt: null });
      conversation.hiddenForBuyerAt = null;
    }
    if (firstMessage) await this.postMessage(conversation.id, buyerId, firstMessage);
    return conversation;
  }

  /** Conversations visibles pour un membre : les siennes, sauf celles qu'il a supprimées (masquées). */
  private visibleFor(userId: string) {
    return this.conversationsRepo
      .createQueryBuilder('c')
      .where('(c.buyerId = :userId AND c.hiddenForBuyerAt IS NULL) OR (c.sellerId = :userId AND c.hiddenForSellerAt IS NULL)', { userId });
  }

  /**
   * Suppression par l'utilisateur : masquage pour lui seul (voir Conversation.hiddenForBuyerAt).
   * Renvoie le nombre de conversations masquées ; celles qui ne lui appartiennent pas sont ignorées.
   */
  async hideForUser(userId: string, ids: string[]): Promise<number> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return 0;
    const mine = await this.conversationsRepo.find({ where: { id: In(unique) } });
    const now = new Date();
    let n = 0;
    for (const c of mine) {
      if (c.buyerId === userId && !c.hiddenForBuyerAt) {
        await this.conversationsRepo.update(c.id, { hiddenForBuyerAt: now });
        n += 1;
      } else if (c.sellerId === userId && !c.hiddenForSellerAt) {
        await this.conversationsRepo.update(c.id, { hiddenForSellerAt: now });
        n += 1;
      }
    }
    return n;
  }

  async listMine(userId: string) {
    const conversations = await this.visibleFor(userId)
      .orderBy('c.lastMessageAt', 'DESC')
      .addOrderBy('c.createdAt', 'DESC')
      .getMany();
    if (conversations.length === 0) return [];

    const listingIds = [...new Set(conversations.map((c) => c.listingId))];
    const listings = await this.listingsRepo.find({ where: { id: In(listingIds) } });
    const listingsById = new Map(listings.map((l) => [l.id, l]));
    const photos = await this.photosRepo.find({ where: { listingId: In(listingIds) }, order: { sortOrder: 'ASC' } });
    const coverByListing = new Map<string, string>();
    for (const p of photos) if (!coverByListing.has(p.listingId)) coverByListing.set(p.listingId, p.url);

    const result: any[] = [];
    for (const c of conversations) {
      const otherId = c.buyerId === userId ? c.sellerId : c.buyerId;
      const other = await this.usersService.findPublicSummary(otherId);
      const last = await this.messagesRepo.findOne({ where: { conversationId: c.id }, order: { createdAt: 'DESC' } });
      const unread = await this.messagesRepo.count({ where: { conversationId: c.id, senderId: Not(userId), readAt: IsNull() } });
      const listing = listingsById.get(c.listingId);
      result.push({
        ...c,
        role: c.buyerId === userId ? 'acheteur' : 'vendeur',
        other,
        listing: listing
          ? { id: listing.id, title: listing.title, price: listing.price, priceType: listing.priceType, status: listing.status, coverUrl: coverByListing.get(listing.id) || null }
          : null,
        lastMessage: last ? { content: this.preview(last), senderId: last.senderId, createdAt: last.createdAt, type: last.type } : null,
        unreadCount: unread,
      });
    }
    return result;
  }

  private preview(m: Message): string {
    if (m.type === 'image') return '📷 Photo';
    if (m.type === 'offer') return `💶 Proposition : ${m.offerAmount} €`;
    if (m.type === 'system') return `ℹ️ ${m.content ?? 'Suivi de la vente'}`;
    return m.content ?? '';
  }

  async unreadTotal(userId: string): Promise<number> {
    const mine = await this.visibleFor(userId).select('c.id').getMany();
    if (mine.length === 0) return 0;
    return this.messagesRepo.count({ where: { conversationId: In(mine.map((c) => c.id)), senderId: Not(userId), readAt: IsNull() } });
  }

  /** Appartenance seule (sans la règle « masquée = inexistante ») : 404 si inconnue, 403 si un tiers. */
  async assertParticipant(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.conversationsRepo.findOne({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation introuvable.');
    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à cette conversation.");
    }
    return conversation;
  }

  async assertMember(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.conversationsRepo.findOne({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation introuvable.');
    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à cette conversation.");
    }
    // Supprimée (masquée) par ce membre : pour lui, elle n'existe plus tant que l'autre n'écrit pas
    const hiddenForMe = conversation.buyerId === userId ? conversation.hiddenForBuyerAt : conversation.hiddenForSellerAt;
    if (hiddenForMe) throw new NotFoundException('Conversation introuvable.');
    return conversation;
  }

  async getDetail(conversationId: string, userId: string) {
    const c = await this.assertMember(conversationId, userId);
    const otherId = c.buyerId === userId ? c.sellerId : c.buyerId;
    const [other, listing, messages] = await Promise.all([
      this.usersService.findPublicSummary(otherId),
      this.listingsRepo.findOne({ where: { id: c.listingId } }),
      this.getMessages(conversationId, userId),
    ]);
    const cover = listing ? await this.photosRepo.findOne({ where: { listingId: listing.id }, order: { sortOrder: 'ASC' } }) : null;
    const blocked = await this.usersService.isBlockedEitherWay(userId, otherId);
    return {
      ...c,
      role: c.buyerId === userId ? 'acheteur' : 'vendeur',
      other,
      listing: listing
        ? { id: listing.id, title: listing.title, price: listing.price, priceType: listing.priceType, status: listing.status, coverUrl: cover?.url || null, userId: listing.userId }
        : null,
      messages,
      blocked,
      quickReplies: QUICK_REPLIES,
      transaction: await this.saleSummary(c, userId),
    };
  }

  /**
   * Vente liée à la conversation (AUDIT §57) : la dernière vente payée entre cet acheteur et ce vendeur pour cette
   * annonce. Lecture seule — les boutons de la conversation appellent les routes /transactions existantes, l'état
   * affiché ici et sur la page « Achats et ventes » est donc le même. Le code de remise n'en fait pas partie.
   */
  private async saleSummary(c: Conversation, userId: string) {
    const tx = await this.transactionsRepo.findOne({
      where: { listingId: c.listingId, buyerId: c.buyerId, sellerId: c.sellerId, status: In(['sequestre', 'livree', 'confirme', 'litige', 'rembourse', 'annulee']) },
      order: { createdAt: 'DESC' },
    });
    if (!tx || !tx.paidAt) return null;
    const shipment = tx.deliveryMethod !== 'main_propre' ? await this.shipmentsRepo.findOne({ where: { transactionId: tx.id } }) : null;
    const trackingNumber = tx.deliveryTrackingNumber || shipment?.trackingNumber || null;
    return {
      id: tx.id,
      role: tx.buyerId === userId ? 'acheteur' : 'vendeur',
      status: tx.status,
      amount: tx.amount,
      deliveryMethod: tx.deliveryMethod,
      deliveryMode: tx.deliveryMode ?? null,
      pickupPoint: tx.pickupPoint ? { name: tx.pickupPoint.name, city: tx.pickupPoint.city, type: tx.pickupPoint.type } : null,
      sellerConfirmedAt: tx.sellerConfirmedAt ?? null,
      shippedAt: tx.shippedAt ?? null,
      confirmedAt: tx.confirmedAt ?? null,
      autoConfirmAt: tx.autoConfirmAt ?? null,
      trackingNumber,
      trackingUrl: trackingNumber && tx.deliveryMethod !== 'main_propre' ? shipment?.trackingUrl || carrierTrackingUrl(tx.deliveryMethod, trackingNumber) : null,
      labelReady: shipment?.status === 'etiquette_prete',
      shippingPaid: !!tx.shippingQuote,
      shippingFee: tx.shippingFee ?? 0,
    };
  }

  /** Conversation de l'annonce entre cet acheteur et le vendeur, si elle existe (lien depuis la page de la vente). */
  async findIdFor(listingId: string, buyerId: string): Promise<string | null> {
    return (await this.conversationsRepo.findOne({ where: { listingId, buyerId }, select: { id: true } }))?.id ?? null;
  }

  /** Abonnés aux messages automatiques (la passerelle WebSocket les diffuse à la conversation et aux deux boîtes). */
  private systemListeners: Array<(e: { message: Message; buyerId: string; sellerId: string }) => void> = [];
  onSystemMessage(fn: (e: { message: Message; buyerId: string; sellerId: string }) => void) {
    this.systemListeners.push(fn);
  }

  /**
   * Étape d'une vente inscrite dans la conversation de l'annonce entre l'acheteur et le vendeur (créée si elle
   * n'existe pas, rendue visible aux deux si l'un l'avait supprimée). Une même étape n'est écrite qu'une fois par
   * vente (le retour de paiement et le webhook peuvent arriver ensemble). Ne lève jamais : le suivi dans la
   * messagerie ne doit pas faire échouer un paiement ou une confirmation.
   */
  async postSystemEvent(p: { listingId: string; buyerId: string; sellerId: string; actorId: string; transactionId: string; event: SystemEvent; content: string; meta?: Record<string, string | number | null> }): Promise<Message | null> {
    try {
      let c = await this.conversationsRepo.findOne({ where: { listingId: p.listingId, buyerId: p.buyerId } });
      if (!c) c = await this.conversationsRepo.save(this.conversationsRepo.create({ listingId: p.listingId, buyerId: p.buyerId, sellerId: p.sellerId }));
      const already = await this.messagesRepo.findOne({ where: { conversationId: c.id, type: 'system', transactionId: p.transactionId, systemEvent: p.event } });
      if (already) return already;
      const saved = await this.messagesRepo.save(this.messagesRepo.create({ createdAt: new Date(), conversationId: c.id, senderId: p.actorId, type: 'system', systemEvent: p.event, transactionId: p.transactionId, content: p.content, meta: p.meta ?? null }));
      await this.conversationsRepo.update(c.id, { lastMessageAt: saved.createdAt, hiddenForBuyerAt: null, hiddenForSellerAt: null });
      for (const fn of this.systemListeners) {
        try {
          fn({ message: saved, buyerId: c.buyerId, sellerId: c.sellerId });
        } catch {
          /* un abonné défaillant ne bloque pas le suivi */
        }
      }
      return saved;
    } catch (e) {
      this.logger.warn('Message de suivi « ' + p.event + ' » non écrit pour la vente ' + p.transactionId + ' : ' + (e as Error).message);
      return null;
    }
  }

  async getMessages(conversationId: string, userId: string): Promise<Message[]> {
    await this.assertMember(conversationId, userId);
    await this.markRead(conversationId, userId);
    return this.messagesRepo.find({ where: { conversationId }, order: { createdAt: 'ASC' } });
  }

  /** Abonnés aux accusés de lecture (la passerelle WebSocket les diffuse à la conversation). */
  private readListeners: Array<(e: { conversationId: string; readerId: string; readAt: Date }) => void> = [];
  onMessagesRead(fn: (e: { conversationId: string; readerId: string; readAt: Date }) => void) {
    this.readListeners.push(fn);
  }

  /**
   * Marque lus les messages reçus (l'appelant doit être membre). Renvoie l'horodatage si au
   * moins un message vient d'être lu, sinon null ; les abonnés sont prévenus dans le premier cas.
   */
  async markRead(conversationId: string, userId: string): Promise<Date | null> {
    const pending = await this.messagesRepo.count({ where: { conversationId, senderId: Not(userId), readAt: IsNull() } });
    if (pending === 0) return null;
    const readAt = new Date();
    await this.messagesRepo.update({ conversationId, senderId: Not(userId), readAt: IsNull() }, { readAt });
    for (const fn of this.readListeners) {
      try {
        fn({ conversationId, readerId: userId, readAt });
      } catch {
        /* un abonné défaillant ne bloque pas la lecture */
      }
    }
    return readAt;
  }

  private async assertCanWrite(conversationId: string, senderId: string): Promise<{ c: Conversation; otherId: string }> {
    const c = await this.assertMember(conversationId, senderId);
    const otherId = c.buyerId === senderId ? c.sellerId : c.buyerId;
    if (await this.usersService.isBlockedEitherWay(senderId, otherId)) {
      throw new ForbiddenException('Vous ne pouvez plus échanger avec cet utilisateur.');
    }
    return { c, otherId };
  }

  private async persist(c: Conversation, otherId: string, message: Message, notifBody: string): Promise<Message> {
    // Horodatage à la milliseconde posé ici : la valeur par défaut de SQLite (dev, tests) s'arrête à la seconde, et deux
    // messages de la même seconde — fréquent avec les messages automatiques — sortiraient dans un ordre arbitraire
    message.createdAt = new Date();
    const saved = await this.messagesRepo.save(message);
    // Un nouveau message fait réapparaître la conversation chez le destinataire s'il l'avait supprimée
    const unhide = otherId === c.buyerId ? { hiddenForBuyerAt: null } : { hiddenForSellerAt: null };
    await this.conversationsRepo.update(c.id, { lastMessageAt: saved.createdAt, ...unhide });
    await this.notifications.notify(otherId, { type: 'message', title: 'Nouveau message', body: notifBody, link: `/compte/messages/${c.id}` });
    return saved;
  }

  async postMessage(conversationId: string, senderId: string, content: string): Promise<Message> {
    const { c, otherId } = await this.assertCanWrite(conversationId, senderId);
    const trimmed = (content || '').trim();
    if (!trimmed) throw new BadRequestException('Message vide.');
    if (trimmed.length > 2000) throw new BadRequestException('Message trop long (2000 caractères max).');
    return this.persist(c, otherId, this.messagesRepo.create({ conversationId, senderId, type: 'text', content: trimmed }), trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed);
  }

  /** Photo dans la conversation (URL déjà vérifiée et stockée par le contrôleur). */
  async postImage(conversationId: string, senderId: string, attachmentUrl: string, caption?: string): Promise<Message> {
    const { c, otherId } = await this.assertCanWrite(conversationId, senderId);
    const content = (caption || '').trim().slice(0, 500) || undefined;
    return this.persist(c, otherId, this.messagesRepo.create({ conversationId, senderId, type: 'image', attachmentUrl, content }), '📷 Photo reçue');
  }

  /** Proposition de prix par l'acheteur (une seule en attente à la fois). */
  async postOffer(conversationId: string, senderId: string, amount: number): Promise<Message> {
    const { c, otherId } = await this.assertCanWrite(conversationId, senderId);
    if (senderId !== c.buyerId) throw new BadRequestException('Seul l\'acheteur peut proposer un prix.');
    const listing = await this.listingsRepo.findOne({ where: { id: c.listingId } });
    if (!listing || listing.status !== 'en_ligne') throw new BadRequestException('Cette annonce n\'est plus disponible.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new BadRequestException('Montant invalide.');
    const pending = await this.messagesRepo.findOne({ where: { conversationId, type: 'offer', offerStatus: 'en_attente' } });
    if (pending) await this.messagesRepo.update(pending.id, { offerStatus: 'retiree' });
    const rounded = Math.round(amount * 100) / 100;
    return this.persist(c, otherId, this.messagesRepo.create({ conversationId, senderId, type: 'offer', offerAmount: rounded, offerStatus: 'en_attente' }), `💶 Proposition de prix : ${rounded} €`);
  }

  /** Le vendeur accepte ou refuse ; l'acheteur peut retirer sa proposition. */
  async answerOffer(conversationId: string, messageId: string, userId: string, decision: 'acceptee' | 'refusee' | 'retiree'): Promise<Message> {
    const { c, otherId } = await this.assertCanWrite(conversationId, userId);
    const m = await this.messagesRepo.findOne({ where: { id: messageId, conversationId, type: 'offer' } });
    if (!m) throw new NotFoundException('Proposition introuvable.');
    if (m.offerStatus !== 'en_attente') throw new BadRequestException('Cette proposition n\'est plus en attente.');
    if (decision === 'retiree' && userId !== c.buyerId) throw new ForbiddenException('Seul l\'acheteur peut retirer sa proposition.');
    if (decision !== 'retiree' && userId !== c.sellerId) throw new ForbiddenException('Seul le vendeur peut répondre à une proposition.');
    await this.messagesRepo.update(m.id, { offerStatus: decision });
    const label = decision === 'acceptee' ? 'acceptée' : decision === 'refusee' ? 'refusée' : 'retirée';
    await this.conversationsRepo.update(c.id, { lastMessageAt: new Date() });
    await this.notifications.notify(otherId, { type: 'message', title: `Proposition ${label}`, body: `${m.offerAmount} € — ${label}`, link: `/compte/messages/${c.id}` });
    return (await this.messagesRepo.findOne({ where: { id: m.id } }))!;
  }
}
