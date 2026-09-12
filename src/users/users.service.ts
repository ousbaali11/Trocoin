import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../conversations/conversation.entity';
import { Message } from '../conversations/message.entity';
import { Listing } from '../listings/listing.entity';
import { Review } from '../reviews/review.entity';
import { Transaction } from '../payments/transaction.entity';
import { Favorite } from '../favorites/favorite.entity';
import { deleteUploadedFile } from '../common/upload/image-upload';
import { UserBlock } from './user-block.entity';
import { User } from './user.entity';

/** Validation de la clé de contrôle d'un SIRET (algorithme de Luhn). */
export function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(siret[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export interface PublicProfile {
  id: string;
  displayName: string;
  avatarUrl?: string;
  accountType: string;
  city?: string;
  shopName?: string;
  shopDescription?: string;
  shopLogoUrl?: string;
  shopAddress?: string;
  shopHours?: string;
  shopWebsite?: string;
  ratingAvg: number;
  ratingCount: number;
  identityVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
  activeListingsCount: number;
  responseRate: number | null; // % de conversations reçues auxquelles le vendeur a répondu
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(UserBlock) private blocksRepo: Repository<UserBlock>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(Conversation) private conversationsRepo: Repository<Conversation>,
    @InjectRepository(Message) private messagesRepo: Repository<Message>,
    @InjectRepository(Review) private reviewsRepo: Repository<Review>,
    @InjectRepository(Transaction) private transactionsRepo: Repository<Transaction>,
    @InjectRepository(Favorite) private favoritesRepo: Repository<Favorite>,
  ) {}

  findByPhone(phoneNumber: string) {
    return this.usersRepo.findOne({ where: { phoneNumber } });
  }

  findById(id: string) {
    return this.usersRepo.findOne({ where: { id } });
  }

  async createFromPhone(phoneNumber: string): Promise<User> {
    const user = this.usersRepo.create({
      phoneNumber,
      phoneVerified: true,
      displayName: 'Membre ' + phoneNumber.slice(-4),
    });
    return this.usersRepo.save(user);
  }

  async updateProfile(id: string, patch: Partial<User>): Promise<User> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length > 0) await this.usersRepo.update(id, clean);
    return this.findById(id) as Promise<User>;
  }

  async setAvatar(id: string, url: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    await deleteUploadedFile(user.avatarUrl);
    await this.usersRepo.update(id, { avatarUrl: url });
    return this.findById(id) as Promise<User>;
  }

  async setShopLogo(id: string, url: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    await deleteUploadedFile(user.shopLogoUrl);
    await this.usersRepo.update(id, { shopLogoUrl: url });
    return this.findById(id) as Promise<User>;
  }

  async becomePro(id: string, siret: string, shopName: string): Promise<User> {
    if (!isValidSiret(siret)) {
      throw new BadRequestException('SIRET invalide (clé de contrôle incorrecte).');
    }
    const other = await this.usersRepo.findOne({ where: { siret } });
    if (other && other.id !== id) {
      throw new BadRequestException('Ce SIRET est déjà rattaché à un autre compte.');
    }
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (user.accountType === 'admin') {
      throw new BadRequestException('Un compte administrateur ne peut pas devenir professionnel.');
    }
    await this.usersRepo.update(id, { accountType: 'professionnel', siret, shopName });
    return this.findById(id) as Promise<User>;
  }

  /** Profil public : jamais de téléphone / e-mail / SIRET complet exposés. */
  async findPublicProfile(id: string): Promise<PublicProfile | null> {
    const user = await this.findById(id);
    if (!user || user.deletedAt) return null;

    const activeListingsCount = await this.listingsRepo.count({
      where: { userId: id, status: 'en_ligne' },
    });

    // Taux de réponse : parmi les conversations où l'utilisateur est vendeur,
    // proportion de celles où il a envoyé au moins un message.
    const received = await this.conversationsRepo.find({ where: { sellerId: id } });
    let responseRate: number | null = null;
    if (received.length > 0) {
      let answered = 0;
      for (const c of received) {
        const count = await this.messagesRepo.count({ where: { conversationId: c.id, senderId: id } });
        if (count > 0) answered += 1;
      }
      responseRate = Math.round((answered / received.length) * 100);
    }

    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      accountType: user.accountType,
      city: user.city,
      shopName: user.shopName,
      shopDescription: user.shopDescription,
      shopLogoUrl: user.shopLogoUrl,
      shopAddress: user.shopAddress,
      shopHours: user.shopHours,
      shopWebsite: user.shopWebsite,
      ratingAvg: user.ratingAvg,
      ratingCount: user.ratingCount,
      identityVerified: user.identityVerified,
      phoneVerified: user.phoneVerified,
      createdAt: user.createdAt,
      activeListingsCount,
      responseRate,
    };
  }

  /** Version allégée pour embarquer dans une annonce / une conversation. */
  async findPublicSummary(id: string) {
    const user = await this.findById(id);
    if (!user) return null;
    return {
      id: user.id,
      displayName: user.deletedAt ? 'Compte supprimé' : user.displayName,
      avatarUrl: user.deletedAt ? undefined : user.avatarUrl,
      accountType: user.accountType,
      city: user.city,
      shopName: user.shopName,
      ratingAvg: user.ratingAvg,
      ratingCount: user.ratingCount,
      identityVerified: user.identityVerified,
      createdAt: user.createdAt,
      deleted: !!user.deletedAt,
    };
  }

  /** Recalcule la moyenne pondérée en ajoutant une nouvelle note. */
  async applyNewRating(userId: string, rating: number): Promise<void> {
    const user = await this.findById(userId);
    if (!user) return;
    const newCount = user.ratingCount + 1;
    const newAvg = (user.ratingAvg * user.ratingCount + rating) / newCount;
    await this.usersRepo.update(userId, {
      ratingAvg: Math.round(newAvg * 10) / 10,
      ratingCount: newCount,
    });
  }

  // ----- Blocage -----
  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new BadRequestException('Vous ne pouvez pas vous bloquer vous-même.');
    const target = await this.findById(blockedId);
    if (!target) throw new NotFoundException('Utilisateur introuvable.');
    const existing = await this.blocksRepo.findOne({ where: { blockerId, blockedId } });
    if (!existing) await this.blocksRepo.save(this.blocksRepo.create({ blockerId, blockedId }));
    return { blocked: true };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.blocksRepo.delete({ blockerId, blockedId });
    return { blocked: false };
  }

  async listBlocked(blockerId: string) {
    const blocks = await this.blocksRepo.find({ where: { blockerId } });
    const users = await Promise.all(blocks.map((b) => this.findPublicSummary(b.blockedId)));
    return users.filter(Boolean);
  }

  /** true si l'un a bloqué l'autre (dans un sens ou dans l'autre). */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const count = await this.blocksRepo
      .createQueryBuilder('b')
      .where('(b.blockerId = :a AND b.blockedId = :b) OR (b.blockerId = :b AND b.blockedId = :a)', { a, b })
      .getCount();
    return count > 0;
  }

  // ----- RGPD -----
  async exportData(userId: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const [listings, conversations, reviewsReceived, reviewsGiven, transactions, favorites] = await Promise.all([
      this.listingsRepo.find({ where: { userId } }),
      this.conversationsRepo
        .createQueryBuilder('c')
        .where('c.buyerId = :userId OR c.sellerId = :userId', { userId })
        .getMany(),
      this.reviewsRepo.find({ where: { reviewedId: userId } }),
      this.reviewsRepo.find({ where: { reviewerId: userId } }),
      this.transactionsRepo
        .createQueryBuilder('t')
        .where('t.buyerId = :userId OR t.sellerId = :userId', { userId })
        .getMany(),
      this.favoritesRepo.find({ where: { userId } }),
    ]);
    const messages = conversations.length
      ? await this.messagesRepo
          .createQueryBuilder('m')
          .where('m.senderId = :userId', { userId })
          .getMany()
      : [];
    return {
      exportedAt: new Date().toISOString(),
      profile: user,
      listings,
      conversations,
      messages,
      reviewsReceived,
      reviewsGiven,
      transactions,
      favorites,
    };
  }

  /**
   * Suppression de compte (droit à l'effacement) : anonymisation immédiate,
   * annonces retirées, favoris / blocages / recherches purgés. Les
   * transactions et avis sont conservés (obligation comptable) mais ne
   * pointent plus vers des données personnelles.
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (user.accountType === 'admin') {
      throw new BadRequestException('Un compte administrateur doit être rétrogradé avant suppression.');
    }
    const openTx = await this.transactionsRepo
      .createQueryBuilder('t')
      .where('(t.buyerId = :userId OR t.sellerId = :userId)', { userId })
      .andWhere('t.status IN (:...statuses)', { statuses: ['sequestre', 'livree', 'litige'] })
      .getCount();
    if (openTx > 0) {
      throw new BadRequestException(
        'Impossible de supprimer le compte : une transaction est encore en cours. Terminez-la ou contactez le support.',
      );
    }

    await deleteUploadedFile(user.avatarUrl);
    await deleteUploadedFile(user.shopLogoUrl);
    await this.listingsRepo.update({ userId }, { status: 'desactivee' });
    await this.favoritesRepo.delete({ userId });
    await this.blocksRepo.delete({ blockerId: userId });
    await this.blocksRepo.delete({ blockedId: userId });
    await this.usersRepo.update(userId, {
      // Le numéro est remplacé par un marqueur unique : il redevient
      // utilisable pour une nouvelle inscription.
      phoneNumber: `deleted:${userId}`,
      email: null as any,
      displayName: 'Compte supprimé',
      avatarUrl: null as any,
      city: null as any,
      postalCode: null as any,
      latitude: null as any,
      longitude: null as any,
      shopName: null as any,
      shopDescription: null as any,
      shopLogoUrl: null as any,
      shopAddress: null as any,
      shopHours: null as any,
      shopWebsite: null as any,
      siret: null as any,
      stripeAccountId: null as any,
      deletedAt: new Date(),
    });
  }

  // ----- Stripe Connect -----
  async setStripeAccount(userId: string, stripeAccountId: string, complete: boolean) {
    await this.usersRepo.update(userId, { stripeAccountId, stripeOnboardingComplete: complete });
  }
}
