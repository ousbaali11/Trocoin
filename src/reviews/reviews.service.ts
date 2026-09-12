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

    const review = await this.reviewsRepo.save(
      this.reviewsRepo.create({
        transactionId,
        reviewerId,
        reviewedId,
        rating: dto.rating,
        comment: dto.comment?.trim(),
      }),
    );

    await this.usersService.applyNewRating(reviewedId, dto.rating);
    return review;
  }

  /** Avis reçus, avec le pseudo public de l'auteur. */
  async listForUser(userId: string) {
    const reviews = await this.reviewsRepo.find({ where: { reviewedId: userId }, order: { createdAt: 'DESC' } });
    return this.withAuthors(reviews, 'reviewerId');
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
