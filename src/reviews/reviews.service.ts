import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from '../payments/transaction.entity';
import { UsersService } from '../users/users.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { Review } from './review.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private reviewsRepo: Repository<Review>,
    @InjectRepository(Transaction) private transactionsRepo: Repository<Transaction>,
    private usersService: UsersService,
  ) {}

  async createForTransaction(transactionId: string, reviewerId: string, dto: CreateReviewDto): Promise<Review> {
    const tx = await this.transactionsRepo.findOne({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction introuvable.');

    if (tx.buyerId !== reviewerId && tx.sellerId !== reviewerId) {
      throw new ForbiddenException("Vous n'avez pas accès à cette transaction.");
    }
    if (tx.status !== 'confirme') {
      throw new BadRequestException("Vous ne pouvez laisser un avis qu'après confirmation de la transaction.");
    }

    const existing = await this.reviewsRepo.findOne({ where: { transactionId, reviewerId } });
    if (existing) {
      throw new BadRequestException('Vous avez déjà laissé un avis pour cette transaction.');
    }

    const reviewedId = tx.buyerId === reviewerId ? tx.sellerId : tx.buyerId;

    let review: Review;
    try {
      review = await this.reviewsRepo.save(
        this.reviewsRepo.create({
          transactionId,
          reviewerId,
          reviewedId,
          rating: dto.rating,
          comment: dto.comment?.trim(),
        }),
      );
    } catch (err) {
      // AUDIT §73 : deux envois simultanés passaient tous deux la vérification ci-dessus ; l'index unique tranche
      if (/UNIQUE|unique|duplicate key/i.test((err as Error).message || '')) throw new BadRequestException('Vous avez déjà laissé un avis pour cette transaction.');
      throw err;
    }

    await this.recomputeRating(reviewedId);
    return review;
  }

  /** AUDIT §73 : note moyenne et nombre d'avis recalculés depuis la table (avant : lecture puis écriture, avis perdus en cas de concurrence). */
  async recomputeRating(userId: string): Promise<void> {
    const row = await this.reviewsRepo.createQueryBuilder('r').select('COUNT(*)', 'n').addSelect('AVG(r.rating)', 'avg').where('r.reviewedId = :userId', { userId }).getRawOne<{ n: string; avg: string | null }>();
    const count = Number(row?.n ?? 0);
    const avg = count ? Math.round(Number(row?.avg ?? 0) * 10) / 10 : 0;
    await this.usersService.setRating(userId, avg, count);
  }

  /** Avis reçus, avec le pseudo public de l'auteur. */
  async listForUser(userId: string) {
    const reviews = await this.reviewsRepo.find({ where: { reviewedId: userId }, order: { createdAt: 'DESC' } });
    // AUDIT §69 : route publique — ni identifiant de vente ni identifiants des deux membres
    return (await this.withAuthors(reviews, 'reviewerId')).map(({ transactionId, reviewerId, reviewedId, ...pub }) => (void transactionId, void reviewerId, void reviewedId, pub));
  }

  async listMine(reviewerId: string) {
    const reviews = await this.reviewsRepo.find({ where: { reviewerId }, order: { createdAt: 'DESC' } });
    return this.withAuthors(reviews, 'reviewedId');
  }

  private async withAuthors(reviews: Review[], field: 'reviewerId' | 'reviewedId') {
    const cache = new Map<string, any>();
    const out: any[] = [];
    for (const r of reviews) {
      const id = r[field];
      if (!cache.has(id)) cache.set(id, await this.usersService.findPublicSummary(id));
      out.push({ ...r, [field === 'reviewerId' ? 'reviewer' : 'reviewed']: cache.get(id) });
    }
    return out;
  }
}
