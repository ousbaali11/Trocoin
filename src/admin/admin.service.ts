import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { Conversation } from '../conversations/conversation.entity';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { Listing } from '../listings/listing.entity';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { Transaction } from '../payments/transaction.entity';
import { Report } from '../reports/report.entity';
import { Review } from '../reviews/review.entity';
import { User } from '../users/user.entity';
import { AdminAuditLog } from './admin-audit-log.entity';
import { PagesService } from '../pages/pages.service';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../settings/settings.service';
import {
  AdminPageDto,
  AdminPlanDto,
  AdminSettingsDto,
  AdminAuditQueryDto,
  AdminListingsQueryDto,
  AdminReportsQueryDto,
  AdminResolveReportDto,
  AdminResolveTransactionDto,
  AdminTransactionsQueryDto,
  AdminUpdateListingDto,
  AdminUpdateUserDto,
  AdminUsersQueryDto,
} from './dto/admin.dto';

interface AdminContext {
  adminId: string;
  ip?: string;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(ListingPhoto) private photosRepo: Repository<ListingPhoto>,
    @InjectRepository(Report) private reportsRepo: Repository<Report>,
    @InjectRepository(Transaction) private transactionsRepo: Repository<Transaction>,
    @InjectRepository(Review) private reviewsRepo: Repository<Review>,
    @InjectRepository(Conversation) private conversationsRepo: Repository<Conversation>,
    @InjectRepository(AdminAuditLog) private auditRepo: Repository<AdminAuditLog>,
    private listingsService: ListingsService,
    private paymentsService: PaymentsService,
    private notifications: NotificationsService,
    private categoriesService: CategoriesService,
    private settings: SettingsService,
    private pages: PagesService,
    private auth: AuthService,
  ) {}

  // ---------------------------------------------------- réglages / formules

  async getSettings() {
    return { settings: await this.settings.all(), plans: await this.settings.listPlans(true) };
  }

  async updateSettings(ctx: AdminContext, dto: AdminSettingsDto) {
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      const before = this.settings.get(key, undefined);
      if (before !== value) {
        await this.settings.set(key, value, ctx.adminId);
        changed[key] = { from: before, to: value };
      }
    }
    if (Object.keys(changed).length > 0) await this.audit(ctx, 'settings.update', 'settings', 'global', changed);
    return this.getSettings();
  }

  listPlans() {
    return this.settings.listPlans(true);
  }

  async upsertPlan(ctx: AdminContext, dto: AdminPlanDto, id?: string) {
    const plan = await this.settings.upsertPlan(dto as any, id);
    await this.audit(ctx, id ? 'plan.update' : 'plan.create', 'plan', plan.id, dto as Record<string, unknown>);
    return plan;
  }

  // ------------------------------------------------------------- CMS pages

  listPages() {
    return this.pages.list();
  }

  getPage(slug: string) {
    return this.pages.get(slug, true);
  }

  async updatePage(ctx: AdminContext, slug: string, dto: AdminPageDto) {
    const page = await this.pages.update(slug, dto, ctx.adminId);
    await this.audit(ctx, 'page.update', 'page', slug, { title: dto.title, published: dto.published, contentLength: dto.content?.length });
    return page;
  }

  // ------------------------------------------------------------------ audit

  private async audit(ctx: AdminContext, action: string, targetType: string, targetId: string, details?: Record<string, unknown>) {
    await this.auditRepo.save(this.auditRepo.create({ adminId: ctx.adminId, action, targetType, targetId, details, ip: ctx.ip }));
  }

  async auditLog(query: AdminAuditQueryDto) {
    const page = query.page || 1;
    const pageSize = query.page_size || 50;
    const qb = this.auditRepo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (query.admin_id) qb.andWhere('a.adminId = :adminId', { adminId: query.admin_id });
    if (query.target_id) qb.andWhere('a.targetId = :targetId', { targetId: query.target_id });
    if (query.action) qb.andWhere('a.action LIKE :action', { action: `${query.action}%` });
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    const adminIds = [...new Set(items.map((i) => i.adminId))];
    const admins = adminIds.length ? await this.usersRepo.find({ where: { id: In(adminIds) } }) : [];
    const byId = new Map(admins.map((a) => [a.id, a.displayName]));
    return { items: items.map((i) => ({ ...i, adminName: byId.get(i.adminId) })), total, page, pageSize };
  }

  // ------------------------------------------------------------------ stats

  async stats() {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [
      usersTotal, usersPro, usersSuspended, usersToday,
      listingsActive, listingsPending, listingsToday,
      txToday, txMonth, txDisputes, reportsOpen,
    ] = await Promise.all([
      this.usersRepo.createQueryBuilder('u').where('u.deletedAt IS NULL').getCount(),
      this.usersRepo.count({ where: { accountType: 'professionnel' } }),
      this.usersRepo.createQueryBuilder('u').where('u.suspendedAt IS NOT NULL').getCount(),
      this.usersRepo.createQueryBuilder('u').where('u.createdAt >= :d', { d: dayStart }).getCount(),
      this.listingsRepo.count({ where: { status: 'en_ligne' } }),
      this.listingsRepo.count({ where: { status: 'en_attente' } }),
      this.listingsRepo.createQueryBuilder('l').where('l.createdAt >= :d', { d: dayStart }).getCount(),
      this.transactionsRepo.createQueryBuilder('t').where('t.createdAt >= :d', { d: dayStart }).getCount(),
      this.transactionsRepo.createQueryBuilder('t').where('t.createdAt >= :d', { d: monthStart }).getCount(),
      this.transactionsRepo.count({ where: { status: 'litige' } }),
      this.reportsRepo.count({ where: { status: 'ouvert' } }),
    ]);
    const revenueMonth = await this.transactionsRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.commission + t.buyerFee), 0)', 'sum')
      .where('t.status = :s', { s: 'confirme' })
      .andWhere('t.confirmedAt >= :d', { d: monthStart })
      .getRawOne<{ sum: number }>();
    const gmvMonth = await this.transactionsRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'sum')
      .where('t.status = :s', { s: 'confirme' })
      .andWhere('t.confirmedAt >= :d', { d: monthStart })
      .getRawOne<{ sum: number }>();

    return {
      users: { total: usersTotal, pro: usersPro, suspended: usersSuspended, newToday: usersToday },
      listings: { active: listingsActive, pending: listingsPending, newToday: listingsToday },
      transactions: { today: txToday, month: txMonth, disputes: txDisputes, gmvMonth: Number(gmvMonth?.sum || 0), revenueMonth: Number(revenueMonth?.sum || 0) },
      reports: { open: reportsOpen },
      generatedAt: now,
    };
  }

  // ------------------------------------------------------------------ users

  async listUsers(query: AdminUsersQueryDto) {
    const page = query.page || 1;
    const pageSize = query.page_size || 25;
    const qb = this.usersRepo.createQueryBuilder('u').orderBy('u.createdAt', 'DESC');
    if (query.q) {
      const q = `%${query.q.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(u.phoneNumber) LIKE :q OR LOWER(u.displayName) LIKE :q OR LOWER(u.email) LIKE :q OR u.siret LIKE :q OR LOWER(u.shopName) LIKE :q OR CAST(u.id AS varchar) = :exact)',
        { q, exact: query.q },
      );
    }
    if (query.city) qb.andWhere('LOWER(u.city) LIKE :city', { city: `%${query.city.toLowerCase()}%` });
    if (query.account_type) qb.andWhere('u.accountType = :t', { t: query.account_type });
    if (query.status === 'suspendu') qb.andWhere('u.suspendedAt IS NOT NULL');
    if (query.status === 'supprime') qb.andWhere('u.deletedAt IS NOT NULL');
    if (query.status === 'actif') qb.andWhere('u.suspendedAt IS NULL AND u.deletedAt IS NULL');
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items: items.map((u) => this.userView(u)), total, page, pageSize };
  }

  async getUser(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const [listings, reportsAgainst, reportsBy, transactions, reviews] = await Promise.all([
      this.listingsRepo.find({ where: { userId: id }, order: { createdAt: 'DESC' }, take: 50 }),
      this.reportsRepo.find({ where: { reportedUserId: id }, order: { createdAt: 'DESC' }, take: 50 }),
      this.reportsRepo.count({ where: { reporterId: id } }),
      this.transactionsRepo
        .createQueryBuilder('t')
        .where('t.buyerId = :id OR t.sellerId = :id', { id })
        .orderBy('t.createdAt', 'DESC')
        .take(50)
        .getMany(),
      this.reviewsRepo.find({ where: { reviewedId: id }, order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    return { ...this.userView(user), listings, reportsAgainst, reportsByCount: reportsBy, transactions, reviews };
  }

  async updateUser(ctx: AdminContext, id: string, dto: AdminUpdateUserDto) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (user.deletedAt) throw new BadRequestException('Compte supprimé : non modifiable.');
    if (id === ctx.adminId && (dto.suspended === true || (dto.accountType && dto.accountType !== 'admin'))) {
      throw new BadRequestException('Vous ne pouvez pas vous suspendre ni vous rétrograder vous-même.');
    }

    const patch: Partial<User> = {};
    const changed: Record<string, unknown> = {};
    for (const key of ['displayName', 'city', 'postalCode', 'accountType', 'identityVerified', 'shopName', 'shopDescription', 'siret'] as const) {
      if (dto[key] !== undefined && dto[key] !== (user as any)[key]) {
        (patch as any)[key] = dto[key];
        changed[key] = { from: (user as any)[key], to: dto[key] };
      }
    }
    if (dto.suspended === true && !user.suspendedAt) {
      patch.suspendedAt = new Date();
      patch.suspensionReason = dto.suspensionReason || 'Suspendu par un administrateur';
      changed.suspended = { to: true, reason: patch.suspensionReason };
      await this.listingsRepo.update({ userId: id, status: 'en_ligne' }, { status: 'desactivee', moderationReason: 'Compte suspendu' });
      await this.auth.revokeAllSessions(id);
    } else if (dto.suspended === false && user.suspendedAt) {
      patch.suspendedAt = null as any;
      patch.suspensionReason = null as any;
      changed.suspended = { to: false };
    }
    if (Object.keys(patch).length === 0) return this.userView(user);

    await this.usersRepo.update(id, patch);
    await this.audit(ctx, 'user.update', 'user', id, changed);
    if (changed.suspended) {
      await this.notifications.notify(id, {
        type: 'moderation',
        title: dto.suspended ? 'Votre compte a été suspendu' : 'Votre compte a été réactivé',
        body: dto.suspended ? (patch.suspensionReason as string) : 'Vous pouvez de nouveau utiliser Trocoin.',
      });
    }
    return this.userView((await this.usersRepo.findOne({ where: { id } }))!);
  }

  private userView(u: User) {
    // L'admin voit le téléphone (support) mais jamais l'ID Stripe brut
    const { stripeAccountId, ...rest } = u;
    return { ...rest, stripeConnected: !!stripeAccountId, suspended: !!u.suspendedAt, deleted: !!u.deletedAt };
  }

  // --------------------------------------------------------------- listings

  async listListings(query: AdminListingsQueryDto) {
    const page = query.page || 1;
    const pageSize = query.page_size || 25;
    const qb = this.listingsRepo.createQueryBuilder('l').orderBy('l.createdAt', 'DESC');
    if (query.q) {
      const q = `%${query.q.toLowerCase()}%`;
      qb.andWhere('(LOWER(l.title) LIKE :q OR LOWER(l.description) LIKE :q OR CAST(l.id AS varchar) = :exact)', { q, exact: query.q });
    }
    if (query.status) qb.andWhere('l.status = :status', { status: query.status });
    if (query.flagged === 'true') qb.andWhere('l.status = :pending', { pending: 'en_attente' });
    if (query.user_id) qb.andWhere('l.userId = :userId', { userId: query.user_id });
    if (query.city) qb.andWhere('LOWER(l.city) LIKE :city', { city: `%${query.city.toLowerCase()}%` });
    if (query.category) {
      const ids = await this.categoriesService.idsIncludingChildren(query.category);
      if (ids) qb.andWhere('l.categoryId IN (:...ids)', { ids });
    }
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items: await this.listingsService.toCards(items), total, page, pageSize };
  }

  async getListing(id: string) {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Annonce introuvable.');
    const [photos, reports, owner, transactions] = await Promise.all([
      this.photosRepo.find({ where: { listingId: id }, order: { sortOrder: 'ASC' } }),
      this.reportsRepo.find({ where: { listingId: id }, order: { createdAt: 'DESC' } }),
      this.usersRepo.findOne({ where: { id: listing.userId } }),
      this.transactionsRepo.find({ where: { listingId: id } }),
    ]);
    const category = await this.categoriesService.findById(listing.categoryId);
    return { ...listing, photos, reports, owner: owner ? this.userView(owner) : null, transactions, category };
  }

  async updateListing(ctx: AdminContext, id: string, dto: AdminUpdateListingDto) {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Annonce introuvable.');
    const patch: Partial<Listing> = {};
    const changed: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'city', 'moderationReason'] as const) {
      if (dto[key] !== undefined && dto[key] !== listing[key]) {
        (patch as any)[key] = dto[key];
        changed[key] = { from: listing[key], to: dto[key] };
      }
    }
    if (dto.status && dto.status !== listing.status) {
      if (dto.status === 'refusee' && !dto.moderationReason) {
        throw new BadRequestException('Un motif est requis pour refuser une annonce (il est transmis au vendeur).');
      }
      patch.status = dto.status;
      changed.status = { from: listing.status, to: dto.status };
      if (dto.status === 'en_ligne') {
        const now = new Date();
        patch.publishedAt = listing.publishedAt || now;
        patch.expiresAt = listing.expiresAt || new Date(now.getTime() + 60 * 86_400_000);
        if (dto.moderationReason === undefined) patch.moderationReason = null as any;
      }
    }
    if (Object.keys(patch).length === 0) return listing;
    await this.listingsRepo.update(id, patch);
    await this.audit(ctx, 'listing.update', 'listing', id, changed);
    if (changed.status) {
      const to = (changed.status as any).to;
      await this.notifications.notify(listing.userId, {
        type: 'moderation',
        title:
          to === 'en_ligne' ? 'Votre annonce est en ligne' :
          to === 'refusee' ? 'Votre annonce a été refusée' : `Statut de votre annonce : ${to}`,
        body: to === 'refusee' ? `Motif : ${dto.moderationReason || listing.moderationReason}` : listing.title,
        link: `/compte/annonces`,
      });
    }
    return this.listingsRepo.findOne({ where: { id } });
  }

  async deleteListing(ctx: AdminContext, id: string, reason?: string) {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Annonce introuvable.');
    const result = await this.listingsService.deleteListing(listing);
    await this.audit(ctx, 'listing.delete', 'listing', id, { title: listing.title, ownerId: listing.userId, reason, hardDeleted: result.deleted });
    await this.notifications.notify(listing.userId, {
      type: 'moderation',
      title: 'Votre annonce a été retirée',
      body: reason ? `Motif : ${reason}` : listing.title,
    });
    return result;
  }

  // ---------------------------------------------------------------- reports

  async listReports(query: AdminReportsQueryDto) {
    const page = query.page || 1;
    const pageSize = query.page_size || 25;
    const qb = this.reportsRepo.createQueryBuilder('r').orderBy('r.createdAt', 'DESC');
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.reason) qb.andWhere('r.reason = :reason', { reason: query.reason });
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    const enriched: any[] = [];
    for (const r of items) {
      const [reporter, reported, listing] = await Promise.all([
        this.usersRepo.findOne({ where: { id: r.reporterId } }),
        r.reportedUserId ? this.usersRepo.findOne({ where: { id: r.reportedUserId } }) : null,
        r.listingId ? this.listingsRepo.findOne({ where: { id: r.listingId } }) : null,
      ]);
      enriched.push({
        ...r,
        reporter: reporter ? { id: reporter.id, displayName: reporter.displayName } : null,
        reportedUser: reported ? { id: reported.id, displayName: reported.displayName, suspended: !!reported.suspendedAt } : null,
        listing: listing ? { id: listing.id, title: listing.title, status: listing.status } : null,
      });
    }
    return { items: enriched, total, page, pageSize };
  }

  async resolveReport(ctx: AdminContext, id: string, dto: AdminResolveReportDto) {
    const report = await this.reportsRepo.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Signalement introuvable.');
    if (report.status !== 'ouvert') throw new BadRequestException('Ce signalement est déjà traité.');

    const action = dto.status === 'traite' ? dto.action || 'aucune' : 'aucune';
    const details: Record<string, unknown> = { status: dto.status, action, note: dto.note };

    if ((action === 'retirer_annonce' || action === 'retirer_et_suspendre') && report.listingId) {
      await this.listingsRepo.update(report.listingId, {
        status: 'refusee',
        moderationReason: dto.note || `Retirée suite à un signalement (${report.reason})`,
      });
      details.listingRemoved = report.listingId;
      const listing = await this.listingsRepo.findOne({ where: { id: report.listingId } });
      if (listing) {
        await this.notifications.notify(listing.userId, {
          type: 'moderation',
          title: 'Votre annonce a été retirée',
          body: `Motif : ${dto.note || report.reason}`,
          link: '/compte/annonces',
        });
      }
    }
    if ((action === 'suspendre_utilisateur' || action === 'retirer_et_suspendre') && report.reportedUserId) {
      if (report.reportedUserId === ctx.adminId) throw new BadRequestException('Impossible de vous suspendre vous-même.');
      await this.usersRepo.update(report.reportedUserId, {
        suspendedAt: new Date(),
        suspensionReason: dto.note || `Suspendu suite à un signalement (${report.reason})`,
      });
      await this.listingsRepo.update({ userId: report.reportedUserId, status: 'en_ligne' }, { status: 'desactivee', moderationReason: 'Compte suspendu' });
      details.userSuspended = report.reportedUserId;
      await this.notifications.notify(report.reportedUserId, {
        type: 'moderation',
        title: 'Votre compte a été suspendu',
        body: dto.note || 'Suite à un signalement vérifié par notre équipe.',
      });
    }

    await this.reportsRepo.update(id, {
      status: dto.status,
      handledBy: ctx.adminId,
      handledAt: new Date(),
      resolutionNote: dto.note,
    });
    await this.audit(ctx, 'report.resolve', 'report', id, details);
    await this.notifications.notify(report.reporterId, {
      type: 'moderation',
      title: 'Votre signalement a été examiné',
      body: dto.status === 'traite' ? 'Merci, nous avons pris les mesures nécessaires.' : 'Après examen, aucune infraction n\'a été constatée.',
    });
    return this.reportsRepo.findOne({ where: { id } });
  }

  // ----------------------------------------------------------- transactions

  async listTransactions(query: AdminTransactionsQueryDto) {
    const page = query.page || 1;
    const pageSize = query.page_size || 25;
    const qb = this.transactionsRepo.createQueryBuilder('t').orderBy('t.createdAt', 'DESC');
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    const enriched: any[] = [];
    for (const t of items) {
      const [buyer, seller, listing] = await Promise.all([
        this.usersRepo.findOne({ where: { id: t.buyerId } }),
        this.usersRepo.findOne({ where: { id: t.sellerId } }),
        this.listingsRepo.findOne({ where: { id: t.listingId } }),
      ]);
      const { handoverCode, ...safe } = t;
      enriched.push({
        ...safe,
        buyer: buyer ? { id: buyer.id, displayName: buyer.displayName } : null,
        seller: seller ? { id: seller.id, displayName: seller.displayName } : null,
        listing: listing ? { id: listing.id, title: listing.title } : null,
      });
    }
    return { items: enriched, total, page, pageSize };
  }

  async resolveTransaction(ctx: AdminContext, id: string, dto: AdminResolveTransactionDto) {
    const tx = await this.paymentsService.resolveDispute(id, dto.decision, dto.note);
    await this.audit(ctx, 'transaction.resolve', 'transaction', id, { decision: dto.decision, note: dto.note, amount: tx.amount });
    const { handoverCode, ...safe } = tx;
    return safe;
  }
}
