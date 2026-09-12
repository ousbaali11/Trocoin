import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSavedSearchDto, UpdateSavedSearchDto } from './dto/saved-search.dto';
import { SavedSearch, SavedSearchQuery } from './saved-search.entity';

export const MAX_SAVED_SEARCHES = 50;

@Injectable()
export class SavedSearchesService {
  private readonly logger = new Logger('SavedSearches');
  private running = false;

  constructor(
    @InjectRepository(SavedSearch) private savedRepo: Repository<SavedSearch>,
    private listingsService: ListingsService,
    private notifications: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateSavedSearchDto): Promise<SavedSearch> {
    const count = await this.savedRepo.count({ where: { userId } });
    if (count >= MAX_SAVED_SEARCHES) {
      throw new BadRequestException(`Vous avez atteint la limite de ${MAX_SAVED_SEARCHES} recherches sauvegardées.`);
    }
    const q = dto.query;
    if (!q.q && !q.category && !q.city && !q.postal_code && q.lat === undefined) {
      throw new BadRequestException('Une recherche sauvegardée doit contenir au moins un critère.');
    }
    return this.savedRepo.save(
      this.savedRepo.create({
        userId,
        name: dto.name.trim(),
        query: q as SavedSearchQuery,
        notifyPush: dto.notifyPush ?? true,
        notifySms: dto.notifySms ?? false,
        lastCheckedAt: new Date(),
      }),
    );
  }

  listMine(userId: string) {
    return this.savedRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async update(userId: string, id: string, dto: UpdateSavedSearchDto) {
    const s = await this.savedRepo.findOne({ where: { id, userId } });
    if (!s) throw new NotFoundException('Recherche introuvable.');
    await this.savedRepo.update(id, dto);
    return this.savedRepo.findOne({ where: { id } });
  }

  async remove(userId: string, id: string) {
    const r = await this.savedRepo.delete({ id, userId });
    if (!r.affected) throw new NotFoundException('Recherche introuvable.');
    return { deleted: true };
  }

  /** Exécute la recherche sauvegardée (pour l'afficher). */
  async run(userId: string, id: string) {
    const s = await this.savedRepo.findOne({ where: { id, userId } });
    if (!s) throw new NotFoundException('Recherche introuvable.');
    return this.listingsService.search(this.toSearchParams(s.query));
  }

  private toSearchParams(q: SavedSearchQuery, sinceDate?: Date) {
    return {
      q: q.q,
      category: q.category,
      city: q.city,
      postal_code: q.postal_code,
      price_min: q.price_min,
      price_max: q.price_max,
      condition: q.condition,
      delivery: q.delivery ? 'true' : undefined,
      seller_type: q.seller_type,
      lat: q.lat,
      lng: q.lng,
      radius: q.radius,
      sort: 'recent' as const,
      page: 1,
      page_size: 20,
      __since: sinceDate,
    };
  }

  /**
   * Job planifié : toutes les 5 minutes (configurable), pour chaque
   * recherche, cherche les annonces publiées depuis la dernière vérification
   * et notifie l'utilisateur. En production, à déplacer dans une file
   * BullMQ + Redis pour ne pas charger le processus API.
   */
  @Cron(process.env.SAVED_SEARCH_CRON || CronExpression.EVERY_5_MINUTES)
  async checkAll(): Promise<{ checked: number; notified: number }> {
    if (this.running) return { checked: 0, notified: 0 };
    this.running = true;
    let notified = 0;
    let checked = 0;
    try {
      const searches = await this.savedRepo.find();
      for (const s of searches) {
        checked += 1;
        const since = s.lastCheckedAt || s.createdAt;
        const now = new Date();
        const result = await this.listingsService.search(this.toSearchParams(s.query));
        const fresh = result.items.filter(
          (l) => l.publishedAt && new Date(l.publishedAt).getTime() > new Date(since).getTime() && l.userId !== s.userId,
        );
        if (fresh.length > 0) {
          const first = fresh[0];
          await this.notifications.notify(s.userId, {
            type: 'alerte_recherche',
            title: `${fresh.length} nouvelle${fresh.length > 1 ? 's' : ''} annonce${fresh.length > 1 ? 's' : ''} : ${s.name}`,
            body: fresh.length === 1 ? first.title : `${first.title} et ${fresh.length - 1} autre(s)`,
            link: fresh.length === 1 ? `/annonces/${first.id}` : `/recherche?saved=${s.id}`,
          });
          notified += 1;
          await this.savedRepo.update(s.id, { lastCheckedAt: now, matchesNotified: s.matchesNotified + fresh.length });
        } else {
          await this.savedRepo.update(s.id, { lastCheckedAt: now });
        }
      }
      if (notified > 0) this.logger.log(`Alertes : ${notified} utilisateur(s) notifié(s) sur ${checked} recherche(s).`);
    } catch (err) {
      this.logger.error(`Vérification des alertes échouée : ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return { checked, notified };
  }
}
