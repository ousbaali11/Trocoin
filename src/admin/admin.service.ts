import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { Conversation } from '../conversations/conversation.entity';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { Listing } from '../listings/listing.entity';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ESCROW_ADMIN_ALERT_HOURS, PaymentsService } from '../payments/payments.service';
import { Transaction } from '../payments/transaction.entity';
import { Report } from '../reports/report.entity';
import { Review } from '../reviews/review.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AdminAuditLog } from './admin-audit-log.entity';
import { PagesService } from '../pages/pages.service';
import { AuthService } from '../auth/auth.service';
import { escapeLike } from '../common/sql';
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
    private usersService: UsersService,
  ) {}

  // ---------------------------------------------------- réglages / formules

  async getSettings() {
    return { settings: await this.settings.all(), plans: await this.settings.listPlans(true), fees: await this.settings.feesInfo() };
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
    // Certaines entrées ne viennent pas d'un compte : le script `create-admin` écrit adminId = 'cli'. Sur Postgres,
    // comparer 'cli' à la colonne uuid des utilisateurs échouait (« invalid input syntax for type uuid ») et la
    // page Traçabilité répondait 500 (AUDIT §41) : seuls les identifiants de forme uuid sont recherchés.
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const adminIds = [...new Set(items.map((i) => i.adminId).filter(isUuid))];
    const admins = adminIds.length ? await this.usersRepo.find({ where: { id: In(adminIds) } }) : [];
    const byId = new Map(admins.map((a) => [a.id, a.displayName]));
    const label = (adminId: string) => byId.get(adminId) ?? (adminId === 'cli' ? "Script d'administration (CLI)" : isUuid(adminId) ? 'Compte administrateur supprimé' : adminId);
    return { items: items.map((i) => ({ ...i, adminName: label(i.adminId) })), total, page, pageSize };
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

    // Filet de sécurité : séquestres dont la date limite de capture approche (mécanisme automatique en plus, AUDIT §37)
    const escrowDueSoon = (await this.paymentsService.escrowDueSoon()).length;
    return {
      users: { total: usersTotal, pro: usersPro, suspended: usersSuspended, newToday: usersToday },
      listings: { active: listingsActive, pending: listingsPending, newToday: listingsToday },
      transactions: { today: txToday, month: txMonth, disputes: txDisputes, escrowDueSoon, gmvMonth: Number(gmvMonth?.sum || 0), revenueMonth: Number(revenueMonth?.sum || 0) },
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
      const q = `%${escapeLike(query.q.toLowerCase())}%`;
      qb.andWhere(
        '(LOWER(u.phoneNumber) LIKE :q OR LOWER(u.displayName) LIKE :q OR LOWER(u.email) LIKE :q OR LOWER(u.username) LIKE :q OR u.siret LIKE :q OR LOWER(u.shopName) LIKE :q OR CAST(u.id AS varchar) = :exact)',
        { q, exact: query.q },
      );
    }
    if (query.city) qb.andWhere('LOWER(u.city) LIKE :city', { city: `%${escapeLike(query.city.toLowerCase())}%` });
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
    return { ...this.userView(user), listings, reportsAgainst, reportsByCount: reportsBy, transactions: transactions.map(({ handoverCode, ...t }) => t), reviews };
  }

  async resetUserPassword(ctx: AdminContext, id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (user.deletedAt) throw new BadRequestException('Compte supprimé : non modifiable.');
    const result = await this.auth.adminResetPassword(id);
    await this.audit(ctx, 'user.reset_password', 'user', id, { hasEmail: !!user.email });
    return result;
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
    for (const key of ['displayName', 'city', 'postalCode', 'accountType', 'identityVerified', 'isDemoAccount', 'shopName', 'shopDescription', 'siret'] as const) {
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
      changed.listingsRestored = await this.restoreListingsAfterSuspension(id);
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
      const q = `%${escapeLike(query.q.toLowerCase())}%`;
      qb.andWhere('(LOWER(l.title) LIKE :q OR LOWER(l.description) LIKE :q OR CAST(l.id AS varchar) = :exact)', { q, exact: query.q });
    }
    if (query.status) qb.andWhere('l.status = :status', { status: query.status });
    if (query.flagged === 'true') qb.andWhere('l.status = :pending', { pending: 'en_attente' });
    if (query.user_id) qb.andWhere('l.userId = :userId', { userId: query.user_id });
    if (query.city) qb.andWhere('LOWER(l.city) LIKE :city', { city: `%${escapeLike(query.city.toLowerCase())}%` });
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
    return { ...listing, photos, reports, owner: owner ? this.userView(owner) : null, transactions: transactions.map(({ handoverCode, ...t }) => t), category };
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
      // AUDIT §63 : publier depuis un brouillon (le vendeur n'a pas fini) ou une annonce vendue / archivée, ou pendant une
      // vente payée, rendait l'article achetable une seconde fois
      if (dto.status === 'en_ligne' && !['en_attente', 'refusee', 'desactivee', 'expiree'].includes(listing.status)) throw new BadRequestException(`Impossible de publier une annonce « ${listing.status} » : seules les annonces en vérification, refusées, en pause ou expirées se publient.`);
      if (dto.status === 'en_ligne' && (await this.listingsService.hasActiveSale(id))) throw new BadRequestException('Une vente payée est en cours sur cette annonce : elle ne peut pas être remise en ligne.');
      patch.status = dto.status;
      changed.status = { from: listing.status, to: dto.status };
      if (dto.status === 'en_ligne') {
        const now = new Date();
        patch.publishedAt = listing.publishedAt || now;
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

  /** Retrait d'une photo (signalement, donnée personnelle visible, litige) : le verrou du vendeur ne s'applique pas à l'admin. */
  async deleteListingPhoto(ctx: AdminContext, id: string, photoId: string, reason: string) {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Annonce introuvable.');
    const photo = await this.listingsService.removePhotoAsAdmin(id, photoId);
    await this.audit(ctx, 'listing.photo.delete', 'listing', id, { photoId, wasLocked: !!photo.lockedAt, reason });
    await this.notifications.notify(listing.userId, { type: 'moderation', title: 'Une photo de votre annonce a été retirée', body: `Motif : ${reason}`, link: `/annonces/${id}` });
    return { deleted: true };
  }

  async deleteListing(ctx: AdminContext, id: string, reason: string) {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Annonce introuvable.');
    // AUDIT §63 : une vente payée est en cours → l'annonce reste (preuves du litige éventuel) ; retirez-la (refusée) à la place
    if (await this.listingsService.hasActiveSale(id)) throw new BadRequestException("Une vente payée est en cours sur cette annonce : elle ne peut pas être supprimée. Retirez-la (statut « refusée ») ou tranchez d'abord la vente.");
    const result = await this.listingsService.deleteListing(listing);
    // hardDeleted : l'annonce n'existe plus en base ; keptTransactions : ventes payées conservées (trace comptable anonymisée)
    await this.audit(ctx, 'listing.delete', 'listing', id, { title: listing.title, ownerId: listing.userId, reason, hardDeleted: result.deleted, keptTransactions: result.keptTransactions });
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
      // AUDIT §63 : une annonce vendue (vente en cours) ou archivée ne se « retire » pas — l'acheteur verrait sa vente refusée
      await this.listingsRepo.update({ id: report.listingId, status: In(['en_ligne', 'en_attente', 'desactivee', 'expiree']) }, {
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
      await this.auth.revokeAllSessions(report.reportedUserId); // AUDIT §69 : comme la suspension depuis la fiche
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
    if (query.due === '1') {
      // Séquestres à échéance sous ESCROW_ADMIN_ALERT_HOURS : ancien modèle → date limite de capture ;
      // modèle platform → délai d'expédition / de remise ou réception présumée (mêmes règles que PaymentsService.escrowDueSoon)
      // Ventes ouvertes à échéance, litiges anciens, expéditions déclarées à la main, et — quel que soit leur statut — les paiements inconnus du prestataire (AUDIT §65)
      qb.andWhere(`((t.status IN (:...open) AND ((t.escrowModel = 'destination' AND t.captureBefore < :limit) OR (t.escrowModel = 'platform' AND t.status IN ('sequestre', 'livree') AND COALESCE(t.autoConfirmAt, t.shipBy) < :limit) OR (t.status = 'litige' AND t.updatedAt < :stale) OR (t.status = 'livree' AND t.escrowModel = 'platform' AND t.autoConfirmAt IS NULL AND t.shippedAt < :manual))) OR t.paymentIssue IS NOT NULL)`, { open: ['sequestre', 'livree', 'litige'], limit: new Date(Date.now() + ESCROW_ADMIN_ALERT_HOURS * 3_600_000), stale: new Date(Date.now() - 7 * 86_400_000), manual: new Date(Date.now() - 10 * 86_400_000) })
        .orderBy('COALESCE(t.autoConfirmAt, t.shipBy, t.captureBefore)', 'ASC');
    }
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
    const before = await this.transactionsRepo.findOne({ where: { id } });
    const tx = await this.paymentsService.resolveDispute(id, dto.decision, dto.note);
    // Action journalisée selon le contexte : arbitrage d'un litige, ou décision forcée hors litige (fraude, conflit)
    const action = before?.status === 'litige' ? 'transaction.resolve' : dto.decision === 'rembourser' ? 'transaction.force_refund' : dto.decision === 'liberer' ? 'transaction.force_capture' : 'transaction.cancel';
    await this.audit(ctx, action, 'transaction', id, { decision: dto.decision, note: dto.note, amount: tx.amount, fromStatus: before?.status, toStatus: tx.status, buyerId: tx.buyerId, sellerId: tx.sellerId });
    const { handoverCode, ...safe } = tx;
    return safe;
  }

  /** Fiche détaillée d'une transaction : parties, annonce, expédition, échéances, journal lié. */
  /** L'administration lève le signalement « paiement inconnu » : la tâche périodique reprend la vente (journalisé). */
  async retryPayment(ctx: AdminContext, id: string) {
    const tx = await this.paymentsService.clearPaymentIssue(id);
    await this.audit(ctx, 'transaction.retry_payment', 'transaction', id, { status: tx.status });
    return this.getTransaction(id);
  }

  async getTransaction(id: string) {
    const tx = await this.transactionsRepo.findOne({ where: { id } });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    const [buyer, seller, listing, shipment, audit] = await Promise.all([
      this.usersRepo.findOne({ where: { id: tx.buyerId } }),
      this.usersRepo.findOne({ where: { id: tx.sellerId } }),
      this.listingsRepo.findOne({ where: { id: tx.listingId } }),
      this.paymentsService.shipmentOf(tx.id),
      this.auditRepo.find({ where: { targetType: 'transaction', targetId: tx.id }, order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    const party = (u: User | null) => (u ? { id: u.id, displayName: u.displayName, phoneNumber: u.phoneNumber, email: u.email, accountType: u.accountType, suspended: !!u.suspendedAt, deleted: !!u.deletedAt, ratingAvg: u.ratingAvg, ratingCount: u.ratingCount } : null);
    const { handoverCode, ...safe } = tx;
    const open = ['sequestre', 'livree', 'litige'].includes(tx.status);
    const refundableAfterCapture = tx.status === 'confirme' && !!tx.autoResolution && !!tx.disputeAllowedUntil && new Date(tx.disputeAllowedUntil).getTime() > Date.now();
    // État réel chez le prestataire (AUDIT §63) : une autorisation expirée ne se libère pas au vendeur — seule l'annulation
    // reste possible ; un paiement déjà remboursé ne se tranche plus.
    const provider = open || refundableAfterCapture ? await this.paymentsService.inspectPayment(tx) : { state: 'inconnue' as const };
    // Décisions possibles maintenant (mêmes règles que PaymentsService.resolveDispute)
    let decisions = [...(open || refundableAfterCapture ? ['rembourser'] : []), ...(open ? ['liberer'] : []), ...(open && !tx.confirmedAt ? ['annuler'] : [])];
    if (provider.state === 'annulee') decisions = open && !tx.confirmedAt ? ['annuler'] : [];
    if (provider.state === 'remboursee') decisions = [];
    return {
      ...safe,
      provider,
      hasHandoverCode: !!handoverCode,
      decisions,
      buyer: party(buyer),
      seller: party(seller),
      listing: listing ? { id: listing.id, title: listing.title, price: listing.price, status: listing.status } : null,
      shipment: shipment ? { status: shipment.status, carrier: shipment.carrier, mode: shipment.mode, trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl, priceCents: shipment.priceCents, createdAt: shipment.createdAt } : null,
      audit: audit.map((e) => ({ id: e.id, action: e.action, adminId: e.adminId, details: e.details, createdAt: e.createdAt })),
    };
  }

  /**
   * Suppression définitive d'un compte par un administrateur : les transactions encore ouvertes sont
   * d'abord annulées avec remboursement de l'acheteur (le compte disparaît, personne ne doit rester
   * bloqué), les annonces sont retirées, puis le compte est anonymisé (même routine que l'auto-suppression
   * RGPD). Irréversible : motif obligatoire, confirmation explicite côté interface, journal d'audit.
   */
  /**
   * Réactivation : les annonces mises en pause par la suspension (et seulement elles) reviennent en ligne ;
   * depuis AUDIT §54 il n'y a plus de durée de vie : toutes reviennent en ligne (`expired` reste à 0, gardé pour le journal).
   */
  private async restoreListingsAfterSuspension(userId: string): Promise<{ republished: number; expired: number }> {
    const paused = await this.listingsRepo.find({ where: { userId, status: 'desactivee', moderationReason: 'Compte suspendu' } });
    const now = Date.now();
    let republished = 0;
    let expired = 0;
    for (const l of paused) {
      // AUDIT §54 : plus d'expiration dans le temps, toute annonce mise en pause par la suspension revient en ligne
      await this.listingsRepo.update(l.id, { status: 'en_ligne', moderationReason: null as any });
      republished += 1;
    }
    return { republished, expired };
  }

  async deleteUser(ctx: AdminContext, id: string, reason: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (user.deletedAt) throw new BadRequestException('Ce compte est déjà supprimé.');
    if (id === ctx.adminId) throw new BadRequestException('Vous ne pouvez pas supprimer votre propre compte depuis la console.');
    if (user.accountType === 'admin') throw new BadRequestException('Rétrogradez ce compte administrateur avant de le supprimer.');
    const open = await this.transactionsRepo
      .createQueryBuilder('t')
      .where('(t.buyerId = :id OR t.sellerId = :id)', { id })
      .andWhere('t.status IN (:...statuses)', { statuses: ['sequestre', 'livree', 'litige'] })
      .getMany();
    // Une vente déjà expédiée (ou remise en attente de confirmation) ou en litige bloque la suppression : l'autre
    // partie attend un colis, une confirmation ou une décision. Suspendre le compte (réversible) reste possible.
    const blocking = open.filter((t) => t.status === 'livree' || t.status === 'litige');
    if (blocking.length > 0) {
      const shipped = blocking.filter((t) => t.status === 'livree').length;
      const disputed = blocking.length - shipped;
      const parts = [shipped ? `${shipped} vente${shipped > 1 ? 's' : ''} expédiée${shipped > 1 ? 's' : ''} ou remise${shipped > 1 ? 's' : ''} en attente de confirmation` : '', disputed ? `${disputed} litige${disputed > 1 ? 's' : ''} en cours` : ''].filter(Boolean).join(' et ');
      throw new BadRequestException(`Suppression impossible : ${parts}. Attendez la confirmation de réception (ou tranchez le litige) avant de supprimer ce compte ; pour agir tout de suite, suspendez-le (réversible).`);
    }
    const cancelled: string[] = [];
    for (const tx of open) {
      const note = `Compte ${tx.sellerId === id ? 'vendeur' : 'acheteur'} supprimé par la modération : ${reason}`;
      await this.paymentsService.resolveDispute(tx.id, 'rembourser', note);
      await this.audit(ctx, 'transaction.force_refund', 'transaction', tx.id, { decision: 'rembourser', note, cause: 'user.delete', deletedUserId: id, amount: tx.amount });
      cancelled.push(tx.id);
    }
    await this.auth.revokeAllSessions(id);
    const purge = await this.usersService.deleteAccount(id, { force: true });
    // Journal conservé après l'effacement réel : entrée séparée (qui, quoi, quand, pourquoi), pas une copie du contenu
    await this.audit(ctx, 'user.delete', 'user', id, { reason, displayName: user.displayName, accountType: user.accountType, refundedTransactions: cancelled, listingsDeleted: purge.listings, keptTransactions: purge.keptTransactions, deletedTransactions: purge.deletedTransactions });
    return { deleted: true, refundedTransactions: cancelled, ...purge };
  }
}
