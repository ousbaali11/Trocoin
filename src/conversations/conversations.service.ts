import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { Listing } from '../listings/listing.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';

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
  constructor(
    @InjectRepository(Conversation) private conversationsRepo: Repository<Conversation>,
    @InjectRepository(Message) private messagesRepo: Repository<Message>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(ListingPhoto) private photosRepo: Repository<ListingPhoto>,
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
    }
    if (firstMessage) await this.postMessage(conversation.id, buyerId, firstMessage);
    return conversation;
  }

  async listMine(userId: string) {
    const conversations = await this.conversationsRepo
      .createQueryBuilder('c')
      .where('c.buyerId = :userId OR c.sellerId = :userId', { userId })
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
        lastMessage: last ? { content: this.preview(last), senderId: last.senderId, createdAt: last.createdAt } : null,
        unreadCount: unread,
      });
    }
    return result;
  }

  private preview(m: Message): string {
    if (m.type === 'image') return '📷 Photo';
    if (m.type === 'offer') return `💶 Proposition : ${m.offerAmount} €`;
    return m.content ?? '';
  }

  async unreadTotal(userId: string): Promise<number> {
    const mine = await this.conversationsRepo
      .createQueryBuilder('c')
      .select('c.id')
      .where('c.buyerId = :userId OR c.sellerId = :userId', { userId })
      .getMany();
    if (mine.length === 0) return 0;
    return this.messagesRepo.count({ where: { conversationId: In(mine.map((c) => c.id)), senderId: Not(userId), readAt: IsNull() } });
  }

  async assertMember(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.conversationsRepo.findOne({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation introuvable.');
    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à cette conversation.");
    }
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
    };
  }

  async getMessages(conversationId: string, userId: string): Promise<Message[]> {
    await this.assertMember(conversationId, userId);
    await this.messagesRepo.update({ conversationId, senderId: Not(userId), readAt: IsNull() }, { readAt: new Date() });
    return this.messagesRepo.find({ where: { conversationId }, order: { createdAt: 'ASC' } });
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
    const saved = await this.messagesRepo.save(message);
    await this.conversationsRepo.update(c.id, { lastMessageAt: saved.createdAt });
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
