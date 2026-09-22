import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Conversation } from '../conversations/conversation.entity';
import { Listing } from '../listings/listing.entity';
import { User } from '../users/user.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { Report } from './report.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private reportsRepo: Repository<Report>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Conversation) private conversationsRepo: Repository<Conversation>,
  ) {}

  async create(reporterId: string, dto: CreateReportDto): Promise<Report> {
    if (!dto.listingId && !dto.reportedUserId && !dto.conversationId) {
      throw new BadRequestException('Indiquez une annonce, un utilisateur ou une conversation à signaler.');
    }
    let reportedUserId = dto.reportedUserId;
    let listingId = dto.listingId;

    if (dto.conversationId) {
      const c = await this.conversationsRepo.findOne({ where: { id: dto.conversationId } });
      if (!c || (c.buyerId !== reporterId && c.sellerId !== reporterId)) {
        throw new NotFoundException('Conversation introuvable.');
      }
      reportedUserId = c.buyerId === reporterId ? c.sellerId : c.buyerId;
      listingId = listingId || c.listingId;
    }
    if (listingId) {
      const listing = await this.listingsRepo.findOne({ where: { id: listingId } });
      if (!listing) throw new NotFoundException('Annonce introuvable.');
      if (listing.userId === reporterId) throw new BadRequestException('Vous ne pouvez pas signaler votre propre annonce.');
      reportedUserId = reportedUserId || listing.userId;
    }
    if (reportedUserId) {
      if (reportedUserId === reporterId) throw new BadRequestException('Vous ne pouvez pas vous signaler vous-même.');
      const u = await this.usersRepo.findOne({ where: { id: reportedUserId } });
      if (!u) throw new NotFoundException('Utilisateur introuvable.');
    }

    // Un seul signalement ouvert par (auteur, cible)
    const dup = await this.reportsRepo.findOne({
      // AUDIT §63 : `undefined` était ignoré par TypeORM (signaler un membre passait pour un doublon d'un signalement d'annonce)
      where: { reporterId, listingId: listingId ?? IsNull(), reportedUserId: reportedUserId ?? IsNull(), status: 'ouvert' },
    });
    if (dup) throw new BadRequestException('Vous avez déjà signalé ce contenu ; notre équipe l\'examine.');

    return this.reportsRepo.save(
      this.reportsRepo.create({
        reporterId,
        listingId,
        reportedUserId,
        conversationId: dto.conversationId,
        reason: dto.reason,
        details: dto.details?.trim(),
      }),
    );
  }

  listMine(reporterId: string) {
    return this.reportsRepo.find({ where: { reporterId }, order: { createdAt: 'DESC' } });
  }
}
