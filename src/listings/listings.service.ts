import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, LessThan, Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { computeCompleteness } from './listing-completeness';
import { FieldSchema, getSchemaForSlugs, validateAttributes } from '../categories/category-schemas';
import { Category } from '../categories/category.entity';
import { approximateFromPostalCode, boundingBox, haversineKm, isWithinFrance } from '../common/geo/france-geo';
import { adminLocationFromPostalCode, regionPostalPrefixes } from '../common/geo/france-admin';
import { deleteUploadedFile } from '../common/upload/image-upload';
import { GRANDES_VILLES, NB_SUGGESTIONS, NB_VILLES } from './discover-data';
import { Favorite } from '../favorites/favorite.entity';
import { Transaction } from '../payments/transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { ShopsService } from '../shops/shops.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { detectFormat, ImportRow, parseCsv, parseXml } from './import/listing-import';
import { ListingPhoto } from './listing-photo.entity';
import { ListingView } from './listing-view.entity';
import { Listing, LISTING_LIFETIME_DAYS, ListingStatus } from './listing.entity';
import { moderateText } from './moderation';

export const MAX_PHOTOS_PER_LISTING = 10;
export const BOOST_DAYS = 7;
export const URGENT_DAYS = 7;
const NO_DELIVERY_ROOTS = ['immobilier', 'vehicules', 'emploi', 'services', 'vacances', 'animaux'];

export interface ListingCard extends Listing {
  coverUrl: string | null;
  photosCount: number;
  categorySlug?: string;
  categoryName?: string;
  distanceKm?: number;
  isBoosted: boolean;
  isUrgent: boolean;
  seller?: {
    id: string;
    displayName: string;
    accountType: string;
    shopName?: string;
    identityVerified: boolean;
    ratingAvg?: number;
    ratingCount?: number;
  };
}

/**
 * Recherche plein texte PostgreSQL : accents retirés des deux côtés (translate, l'extension
 * unaccent n'est pas garantie chez tous les hébergeurs), stemming français, préfixe (:*)
 * sur chaque mot après suppression d'un pluriel simple. L'expression est STRICTEMENT la
 * même que celle de l'index GIN (migration ListingsFullText).
 */
const ACCENTS_FROM = 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ';
const ACCENTS_TO = 'aaaeeeeiioouuucAAAEEEEIIOOUUUC';
const FTS_VECTOR_SQL = `to_tsvector('french', translate(lower(coalesce(l.title, '') || ' ' || coalesce(l.description, '')), '${ACCENTS_FROM}', '${ACCENTS_TO}'))`;
export function toPrefixTsQuery(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
    .map((w) => (w.length >= 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w) + ':*')
    .join(' & ');
}

const PRICE_STOPWORDS = new Set(['les', 'des', 'une', 'pour', 'avec', 'sans', 'tres', 'bon', 'etat', 'neuf', 'neuve', 'occasion', 'vends', 'vend', 'vente', 'lot', 'the', 'and', 'par', 'sur', 'dans', 'comme', 'plus']);

@Injectable()
export class ListingsService {
  private readonly logger = new Logger('Listings');

  constructor(
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(ListingPhoto) private photosRepo: Repository<ListingPhoto>,
    @InjectRepository(ListingView) private viewsRepo: Repository<ListingView>,
    @InjectRepository(Favorite) private favoritesRepo: Repository<Favorite>,
    @InjectRepository(Transaction) private transactionsRepo: Repository<Transaction>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    private categoriesService: CategoriesService,
    private usersService: UsersService,
    private settings: SettingsService,
    private shops: ShopsService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private async resolveCategory(slug: string): Promise<{ category: Category; root: Category }> {
    const category = await this.categoriesService.findBySlug(slug);
    if (!category) throw new BadRequestException(`Catégorie inconnue : ${slug}`);
    const root = category.parentId ? await this.categoriesService.findById(category.parentId) : category;
    // Une famille qui a des sous-catégories ne peut pas recevoir directement d'annonce
    if (!category.parentId) {
      const all = await this.categoriesService.findAll();
      if (all.some((c) => c.parentId === category.id)) {
        throw new BadRequestException(`Choisissez une sous-catégorie de « ${category.name} ».`);
      }
    }
    return { category, root: root || category };
  }

  private validateAttributesFor(category: Category, root: Category, raw?: Record<string, unknown>, requireRequired = true) {
    const schema = getSchemaForSlugs(category.slug, root.slug !== category.slug ? root.slug : undefined);
    const { errors, clean } = validateAttributes(schema, raw, { requireRequired });
    if (errors.length > 0) throw new BadRequestException(errors);
    return clean;
  }

  private resolveCoordinates(dto: { latitude?: number; longitude?: number; postalCode?: string }) {
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      if (!isWithinFrance(dto.latitude, dto.longitude)) {
        throw new BadRequestException('Les coordonnées doivent se situer en France.');
      }
      return { latitude: dto.latitude, longitude: dto.longitude };
    }
    const approx = approximateFromPostalCode(dto.postalCode);
    return approx || { latitude: undefined, longitude: undefined };
  }

  private validatePrice(priceType: string, price?: number) {
    if (['fixe', 'negociable'].includes(priceType) && (price === undefined || price === null)) {
      throw new BadRequestException('Un prix est requis pour ce type d\'annonce.');
    }
  }

  /**
   * Quota de publication. RÈGLE : monétisation désactivée → aucune limite
   * (particuliers comme professionnels). Sinon : limite du plan (null =
   * illimité) ou quota particulier sur 30 jours.
   */
  private async assertQuota(ownerId: string) {
    const owner = await this.usersService.findById(ownerId);
    if (!owner) return;
    const ent = await this.settings.entitlements(ownerId, owner.accountType);
    if (!ent.monetizationEnabled || ent.listingsLimit === null) return;
    const count = ent.plan
      ? await this.listingsRepo.count({ where: { userId: ownerId, status: 'en_ligne' } })
      : await this.listingsRepo
          .createQueryBuilder('l')
          .where('l.userId = :ownerId', { ownerId })
          .andWhere('l.createdAt > :since', { since: new Date(Date.now() - 30 * 86_400_000) })
          .andWhere("l.status != 'brouillon'")
          .getCount();
    if (count >= ent.listingsLimit) {
      throw new BadRequestException(
        ent.plan
          ? `Votre formule « ${ent.plan.name} » inclut ${ent.listingsLimit} annonces en ligne. Passez à une formule supérieure pour en publier davantage.`
          : `Limite de ${ent.listingsLimit} annonces sur 30 jours atteinte. Passez en compte professionnel ou attendez.`,
      );
    }
  }

  private decideInitialStatus(draft: boolean | undefined, title: string, description: string): { status: ListingStatus; reason?: string } {
    if (draft) return { status: 'brouillon' };
    const mod = moderateText(title, description);
    if (mod.flagged) return { status: 'en_attente', reason: `Vérification requise : ${mod.reasons.join(', ')}` };
    return { status: 'en_ligne' };
  }

  /** Propriétaire effectif : soi-même, ou une boutique dont on est membre (onBehalfOf). */
  private async resolveOwner(actorId: string, onBehalfOf?: string): Promise<string> {
    if (!onBehalfOf || onBehalfOf === actorId) return actorId;
    if (!(await this.shops.canActFor(actorId, onBehalfOf))) {
      throw new ForbiddenException('Vous ne gérez pas cette boutique.');
    }
    return onBehalfOf;
  }

  // ---------------------------------------------------------------- création

  async create(actorId: string, dto: CreateListingDto): Promise<Listing> {
    const ownerId = await this.resolveOwner(actorId, dto.onBehalfOf);
    const { category, root } = await this.resolveCategory(dto.categorySlug);
    const priceType = dto.priceType || 'fixe';
    if (!dto.draft) this.validatePrice(priceType, dto.price);
    const attributes = this.validateAttributesFor(category, root, dto.attributes, !dto.draft);
    const coords = this.resolveCoordinates(dto);
    if (!dto.draft) await this.assertQuota(ownerId);

    const { status, reason } = this.decideInitialStatus(dto.draft, dto.title, dto.description);
    const now = new Date();

    const listing = this.listingsRepo.create({
      userId: ownerId,
      createdBy: ownerId !== actorId ? actorId : undefined,
      categoryId: category.id,
      rootCategoryId: root.id,
      title: dto.title.trim(),
      description: dto.description.trim(),
      price: ['gratuit', 'echange', 'sur_demande'].includes(priceType) ? undefined : dto.price,
      priceType,
      condition: dto.condition,
      attributes,
      city: dto.city?.trim(),
      postalCode: dto.postalCode,
      latitude: coords.latitude,
      longitude: coords.longitude,
      deliveryAvailable: !!dto.deliveryAvailable && !NO_DELIVERY_ROOTS.includes(root.slug),
      weightGrams: dto.weightGrams ?? null,
      lengthCm: dto.lengthCm ?? null,
      widthCm: dto.widthCm ?? null,
      heightCm: dto.heightCm ?? null,
      status,
      moderationReason: reason,
      publishedAt: status === 'en_ligne' ? now : undefined,
      expiresAt: status === 'en_ligne' ? new Date(now.getTime() + LISTING_LIFETIME_DAYS * 86_400_000) : undefined,
    });

    return this.listingsRepo.save(listing);
  }

  // ------------------------------------------------------------ propriétaire

  /** Mes annonces + celles des boutiques que je gère (marquées `shopOwnerId`). */
  async findMine(userId: string): Promise<Array<ListingCard & { shopOwnerId?: string }>> {
    const managed = await this.shops.managedOwnerIds(userId);
    const listings = await this.listingsRepo.find({
      where: { userId: In([userId, ...managed]) },
      order: { createdAt: 'DESC' },
    });
    const cards = await this.toCards(listings);
    return cards.map((c) => ({ ...c, shopOwnerId: c.userId !== userId ? c.userId : undefined }));
  }

  /** Annonce que `userId` a le droit de gérer (propriétaire ou membre de sa boutique). */
  async getManaged(listingId: string, userId: string): Promise<Listing> {
    const listing = await this.listingsRepo.findOne({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Annonce introuvable.');
    if (listing.userId !== userId && !(await this.shops.canActFor(userId, listing.userId))) {
      throw new ForbiddenException("Vous n'êtes pas propriétaire de cette annonce.");
    }
    return listing;
  }

  /** @deprecated alias conservé pour compatibilité */
  getOwned(listingId: string, userId: string) {
    return this.getManaged(listingId, userId);
  }

  async updateOwn(listingId: string, userId: string, dto: UpdateListingDto): Promise<Listing> {
    const listing = await this.getManaged(listingId, userId);
    if (listing.status === 'refusee') {
      throw new BadRequestException('Cette annonce a été refusée ; créez-en une nouvelle conforme aux règles.');
    }

    const patch: Partial<Listing> = {};
    let category: Category | null = null;
    let root: Category | null = null;
    if (dto.categorySlug) {
      const r = await this.resolveCategory(dto.categorySlug);
      category = r.category;
      root = r.root;
      patch.categoryId = category.id;
      patch.rootCategoryId = root.id;
    } else {
      category = await this.categoriesService.findById(listing.categoryId);
      root = category?.parentId ? await this.categoriesService.findById(category.parentId) : category;
    }

    const willPublish = dto.status === 'en_ligne' || (dto.status === undefined && listing.status === 'en_ligne');
    if (dto.attributes !== undefined || dto.categorySlug) {
      patch.attributes = this.validateAttributesFor(category!, root!, dto.attributes ?? listing.attributes, willPublish);
    }

    const priceType = dto.priceType ?? listing.priceType;
    const price = dto.price ?? listing.price;
    if (willPublish) this.validatePrice(priceType, price);
    if (dto.priceType !== undefined) patch.priceType = dto.priceType;
    if (dto.price !== undefined) patch.price = dto.price;
    if (['gratuit', 'echange', 'sur_demande'].includes(priceType)) patch.price = undefined as any;

    for (const key of ['title', 'description', 'condition', 'city', 'postalCode', 'deliveryAvailable', 'weightGrams', 'lengthCm', 'widthCm', 'heightCm'] as const) {
      if (dto[key] !== undefined) (patch as any)[key] = typeof dto[key] === 'string' ? (dto[key] as string).trim() : dto[key];
    }
    if (dto.latitude !== undefined || dto.longitude !== undefined || dto.postalCode !== undefined) {
      const coords = this.resolveCoordinates({ latitude: dto.latitude, longitude: dto.longitude, postalCode: dto.postalCode ?? listing.postalCode });
      patch.latitude = coords.latitude;
      patch.longitude = coords.longitude;
    }

    if (dto.status !== undefined) {
      const from = listing.status;
      if (dto.status === 'en_ligne') {
        if (!['brouillon', 'desactivee', 'expiree', 'en_ligne', 'vendue'].includes(from)) {
          throw new BadRequestException(`Impossible de publier depuis le statut "${from}".`);
        }
        if (from !== 'en_ligne') await this.assertQuota(listing.userId);
      }
      patch.status = dto.status;
    }

    const newTitle = patch.title ?? listing.title;
    const newDesc = patch.description ?? listing.description;
    const targetStatus = patch.status ?? listing.status;
    if (targetStatus === 'en_ligne' && (dto.title !== undefined || dto.description !== undefined || dto.status === 'en_ligne')) {
      const mod = moderateText(newTitle, newDesc);
      if (mod.flagged) {
        patch.status = 'en_attente';
        patch.moderationReason = `Vérification requise : ${mod.reasons.join(', ')}`;
      } else {
        patch.moderationReason = null as any;
      }
    }
    if (patch.status === 'en_ligne' && listing.status !== 'en_ligne') {
      const now = new Date();
      patch.publishedAt = now;
      patch.expiresAt = new Date(now.getTime() + LISTING_LIFETIME_DAYS * 86_400_000);
    }
    if (listing.userId !== userId) patch.createdBy = userId;

    await this.listingsRepo.update(listingId, patch);
    return this.listingsRepo.findOne({ where: { id: listingId } }) as Promise<Listing>;
  }

  /**
   * Actions groupées de « Mes annonces » (comptes avec plusieurs annonces) : pause, remise en
   * ligne ou renouvellement de plusieurs annonces d'un coup. Chaque annonce passe par les mêmes
   * règles que l'action unitaire ; une annonce refusée est comptée, pas bloquante.
   */
  async bulkOwn(userId: string, ids: string[], action: 'pause' | 'republish' | 'renew'): Promise<{ done: number; failed: Array<{ id: string; reason: string }> }> {
    let done = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of [...new Set(ids)]) {
      try {
        if (action === 'pause') await this.updateOwn(id, userId, { status: 'desactivee' } as UpdateListingDto);
        else if (action === 'republish') await this.updateOwn(id, userId, { status: 'en_ligne' } as UpdateListingDto);
        else await this.renewOwn(id, userId);
        done += 1;
      } catch (err) {
        const message = (err as { message?: unknown }).message;
        failed.push({ id, reason: Array.isArray(message) ? message.join(' ') : String(message ?? 'Action impossible') });
      }
    }
    return { done, failed };
  }

  async renewOwn(listingId: string, userId: string): Promise<Listing> {
    const listing = await this.getManaged(listingId, userId);
    if (!['en_ligne', 'expiree', 'desactivee'].includes(listing.status)) {
      throw new BadRequestException(`Impossible de renouveler une annonce "${listing.status}".`);
    }
    if (listing.status !== 'en_ligne') await this.assertQuota(listing.userId);
    const now = new Date();
    await this.listingsRepo.update(listingId, {
      status: 'en_ligne',
      publishedAt: now,
      expiresAt: new Date(now.getTime() + LISTING_LIFETIME_DAYS * 86_400_000),
      moderationReason: null as any,
    });
    return this.listingsRepo.findOne({ where: { id: listingId } }) as Promise<Listing>;
  }

  async deleteOwn(listingId: string, userId: string): Promise<void> {
    const listing = await this.getManaged(listingId, userId);
    await this.deleteListing(listing);
  }

  async deleteListing(listing: Listing): Promise<{ deleted: boolean }> {
    const txCount = await this.transactionsRepo.count({ where: { listingId: listing.id } });
    if (txCount > 0) {
      await this.listingsRepo.update(listing.id, { status: 'desactivee' });
      return { deleted: false };
    }
    const photos = await this.photosRepo.find({ where: { listingId: listing.id } });
    await Promise.all(photos.flatMap((p) => [deleteUploadedFile(p.url), deleteUploadedFile(p.thumbUrl)]));
    await this.photosRepo.delete({ listingId: listing.id });
    await this.favoritesRepo.delete({ listingId: listing.id });
    await this.viewsRepo.delete({ listingId: listing.id });
    await this.listingsRepo.delete(listing.id);
    return { deleted: true };
  }

  async duplicateOwn(listingId: string, userId: string): Promise<Listing> {
    const source = await this.getManaged(listingId, userId);
    const copy = this.listingsRepo.create({
      ...source,
      id: undefined,
      status: 'brouillon',
      moderationReason: undefined,
      viewsCount: 0,
      boostedUntil: undefined,
      urgentUntil: undefined,
      externalRef: undefined,
      publishedAt: undefined,
      expiresAt: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      createdBy: source.userId !== userId ? userId : undefined,
    });
    return this.listingsRepo.save(copy);
  }

  // ------------------------------------------------------------ mise en avant

  /**
   * Boost (remontée en tête, 7 jours) ou Urgent (macaron, 7 jours).
   * Gratuit tant que la monétisation est désactivée. Sinon : décompté du
   * plan, ou facturé au prix configuré (paiement à brancher en phase 3 —
   * pour l'instant refusé si aucun crédit de plan n'est disponible).
   */
  async promote(listingId: string, userId: string, type: 'boost' | 'urgent') {
    const listing = await this.getManaged(listingId, userId);
    if (listing.status !== 'en_ligne') throw new BadRequestException('Seule une annonce en ligne peut être mise en avant.');
    const owner = await this.usersService.findById(listing.userId);
    const ent = await this.settings.entitlements(listing.userId, owner?.accountType ?? 'particulier');
    let charged = 0;
    if (ent.monetizationEnabled) {
      if (ent.boostsLimit !== null) {
        const since = new Date(Date.now() - 30 * 86_400_000);
        const used = await this.listingsRepo
          .createQueryBuilder('l')
          .where('l.userId = :ownerId', { ownerId: listing.userId })
          .andWhere('(l.boostedUntil > :since OR l.urgentUntil > :since)', { since })
          .getCount();
        if (used >= ent.boostsLimit) {
          const price = type === 'boost' ? ent.boostPrice : ent.urgentPrice;
          throw new BadRequestException(
            `Vos mises en avant incluses sont épuisées. Cette option coûte ${price.toFixed(2)} € ; le paiement à l'unité sera disponible prochainement.`,
          );
        }
      }
    }
    const days = type === 'boost' ? BOOST_DAYS : URGENT_DAYS;
    const until = new Date(Date.now() + days * 86_400_000);
    await this.listingsRepo.update(listingId, type === 'boost' ? { boostedUntil: until } : { urgentUntil: until });
    const updated = (await this.listingsRepo.findOne({ where: { id: listingId } }))!;
    return { listing: updated, type, until, charged, monetizationEnabled: ent.monetizationEnabled };
  }

  // ------------------------------------------------------------------ photos

  async addPhotos(listingId: string, userId: string, urls: Array<{ url: string; thumbUrl: string | null }>): Promise<ListingPhoto[]> {
    const listing = await this.getManaged(listingId, userId);
    // Plafond glissant par compte (MAX_PHOTOS_PER_DAY, défaut 150) : limite l'abus de stockage
    // et de bande passante ; 10 annonces complètes par jour restent possibles.
    const maxPerDay = Number(process.env.MAX_PHOTOS_PER_DAY || 150);
    const since = new Date(Date.now() - 86_400_000);
    const uploadedToday = await this.photosRepo
      .createQueryBuilder('p')
      .innerJoin(Listing, 'l', 'CAST(l.id AS varchar) = p."listingId"')
      .where('l.userId = :ownerId', { ownerId: listing.userId })
      .andWhere('p.createdAt > :since', { since })
      .getCount();
    if (uploadedToday + urls.length > maxPerDay) {
      await Promise.all(urls.flatMap((u) => [deleteUploadedFile(u.url), deleteUploadedFile(u.thumbUrl)]));
      throw new BadRequestException(`Limite de ${maxPerDay} photos par 24 h atteinte pour ce compte. Réessayez demain.`);
    }
    const existingCount = await this.photosRepo.count({ where: { listingId } });
    if (existingCount + urls.length > MAX_PHOTOS_PER_LISTING) {
      await Promise.all(urls.flatMap((u) => [deleteUploadedFile(u.url), deleteUploadedFile(u.thumbUrl)]));
      throw new BadRequestException(`Maximum ${MAX_PHOTOS_PER_LISTING} photos par annonce.`);
    }
    const photos = urls.map((u, i) => this.photosRepo.create({ listingId: listing.id, url: u.url, thumbUrl: u.thumbUrl, sortOrder: existingCount + i }));
    return this.photosRepo.save(photos);
  }

  async removePhoto(listingId: string, userId: string, photoId: string): Promise<void> {
    await this.getManaged(listingId, userId);
    const photo = await this.photosRepo.findOne({ where: { id: photoId, listingId } });
    if (!photo) throw new NotFoundException('Photo introuvable.');
    await this.photosRepo.delete({ id: photoId, listingId });
    await deleteUploadedFile(photo.url);
    await deleteUploadedFile(photo.thumbUrl);
  }

  async reorderPhotos(listingId: string, userId: string, photoIds: string[]): Promise<ListingPhoto[]> {
    await this.getManaged(listingId, userId);
    const photos = await this.photosRepo.find({ where: { listingId } });
    const known = new Set(photos.map((p) => p.id));
    if (photoIds.length !== photos.length || photoIds.some((id) => !known.has(id))) {
      throw new BadRequestException('La liste doit contenir exactement toutes les photos de l\'annonce.');
    }
    await Promise.all(photoIds.map((id, i) => this.photosRepo.update({ id, listingId }, { sortOrder: i })));
    return this.photosRepo.find({ where: { listingId }, order: { sortOrder: 'ASC' } });
  }

  // ------------------------------------------------------------------ lecture

  async findOne(id: string, viewer?: { userId: string; accountType: string }) {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) throw new NotFoundException('Annonce introuvable.');
    const isOwner = !!viewer && (viewer.userId === listing.userId || (await this.shops.canActFor(viewer.userId, listing.userId)));
    const isAdmin = viewer?.accountType === 'admin';
    if (listing.status !== 'en_ligne' && !isOwner && !isAdmin && !['vendue', 'expiree'].includes(listing.status)) {
      throw new NotFoundException('Annonce introuvable.');
    }
    if (!isOwner && listing.status === 'en_ligne') {
      await this.listingsRepo.increment({ id }, 'viewsCount', 1);
      listing.viewsCount += 1;
    }
    if (viewer && !isOwner) {
      // Historique de consultation (une ligne par annonce, date rafraîchie)
      await this.viewsRepo.save(this.viewsRepo.create({ userId: viewer.userId, listingId: id, viewedAt: new Date() }));
    }
    const photos = await this.photosRepo.find({ where: { listingId: id }, order: { sortOrder: 'ASC' } });
    const category = await this.categoriesService.findById(listing.categoryId);
    const root = category?.parentId ? await this.categoriesService.findById(category.parentId) : category;
    const seller = await this.usersService.findPublicSummary(listing.userId);
    const favoritesCount = await this.favoritesRepo.count({ where: { listingId: id } });
    const schema = category ? getSchemaForSlugs(category.slug, root && root.slug !== category.slug ? root.slug : undefined) : [];
    const attributesLabeled = (schema || [])
      .filter((f) => listing.attributes && listing.attributes[f.key] !== undefined)
      .map((f) => ({ key: f.key, label: f.label, value: listing.attributes![f.key], unit: f.unit }));
    const now = Date.now();

    return {
      ...listing,
      latitude: isOwner ? listing.latitude : listing.latitude != null ? Math.round(listing.latitude * 100) / 100 : listing.latitude,
      longitude: isOwner ? listing.longitude : listing.longitude != null ? Math.round(listing.longitude * 100) / 100 : listing.longitude,
      photos,
      category: category ? { id: category.id, slug: category.slug, name: category.name } : null,
      rootCategory: root ? { id: root.id, slug: root.slug, name: root.name } : null,
      seller,
      favoritesCount,
      attributesLabeled,
      isOwner,
      isBoosted: !!listing.boostedUntil && new Date(listing.boostedUntil).getTime() > now,
      isUrgent: !!listing.urgentUntil && new Date(listing.urgentUntil).getTime() > now,
      completeness: computeCompleteness(listing, photos.length, schema || []),
      // Fil d'Ariane « Région › Département › Ville » (dérivé du code postal, jamais de l'adresse exacte)
      location: adminLocationFromPostalCode(listing.postalCode),
    };
  }

  private isPostgres(): boolean {
    return this.listingsRepo.manager.connection.options.type === 'postgres';
  }

  /** Schéma de champs d'une catégorie (avec celui de sa famille) à partir du cache des catégories. */
  private schemaForCategory(c: Category | undefined, catById: Map<number, Category>): FieldSchema[] {
    if (!c) return [];
    const parent = c.parentId ? catById.get(c.parentId) : undefined;
    return getSchemaForSlugs(c.slug, parent && parent.slug !== c.slug ? parent.slug : undefined);
  }

  /**
   * « Prix moyen constaté » : médiane et fourchette (quartiles) des annonces en
   * ligne de la même catégorie, en priorité celles dont le titre partage des
   * mots avec celui saisi. Aide le vendeur à fixer un prix réaliste au dépôt,
   * ce que leboncoin ne propose pas pour les particuliers.
   */
  async priceEstimate(categorySlug?: string, rawQ?: string): Promise<{ count: number; median: number | null; low: number | null; high: number | null; basis: 'mots' | 'categorie' | null }> {
    const none = { count: 0, median: null, low: null, high: null, basis: null as null };
    if (!categorySlug) return none;
    const ids = await this.categoriesService.idsIncludingChildren(categorySlug);
    if (!ids) return none;
    const words = (rawQ || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !PRICE_STOPWORDS.has(w))
      .slice(0, 4);
    const base = () =>
      this.listingsRepo
        .createQueryBuilder('l')
        .select(['l.price'])
        .where('l.status = :status', { status: 'en_ligne' })
        .andWhere('l.categoryId IN (:...ids)', { ids })
        .andWhere("l.priceType IN ('fixe', 'negociable')")
        .andWhere('l.price IS NOT NULL AND l.price > 0')
        .orderBy('l.publishedAt', 'DESC')
        .limit(300);
    const stats = (prices: number[], basis: 'mots' | 'categorie') => {
      const sorted = [...prices].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
      return { count: sorted.length, median: Math.round(q(0.5)), low: Math.round(q(0.25)), high: Math.round(q(0.75)), basis };
    };
    if (words.length) {
      const qb = base();
      qb.andWhere(
        new Brackets((w) => {
          words.forEach((word, i) => w.orWhere('LOWER(l.title) LIKE :w' + i, { ['w' + i]: '%' + escapeLike(word) + '%' }));
        }),
      );
      const rows = await qb.getMany();
      if (rows.length >= 3) return stats(rows.map((r) => Number(r.price)), 'mots');
    }
    const rows = await base().getMany();
    if (rows.length >= 3) return stats(rows.map((r) => Number(r.price)), 'categorie');
    return { ...none, count: rows.length };
  }

  async findSimilar(id: string, limit = 8): Promise<ListingCard[]> {
    const listing = await this.listingsRepo.findOne({ where: { id } });
    if (!listing) return [];
    let items = await this.listingsRepo
      .createQueryBuilder('l')
      .where('l.status = :status', { status: 'en_ligne' })
      .andWhere('l.id != :id', { id })
      .andWhere('l.categoryId = :categoryId', { categoryId: listing.categoryId })
      .orderBy('l.publishedAt', 'DESC')
      .take(limit * 3)
      .getMany();
    if (items.length < limit && listing.rootCategoryId) {
      const more = await this.listingsRepo
        .createQueryBuilder('l')
        .where('l.status = :status', { status: 'en_ligne' })
        .andWhere('l.id != :id', { id })
        .andWhere('l.rootCategoryId = :root', { root: listing.rootCategoryId })
        .andWhere('l.categoryId != :categoryId', { categoryId: listing.categoryId })
        .orderBy('l.publishedAt', 'DESC')
        .take(limit)
        .getMany();
      items = [...items, ...more];
    }
    const dep = listing.postalCode?.slice(0, 2);
    items.sort((a, b) => {
      const da = a.postalCode?.slice(0, 2) === dep ? 0 : 1;
      const db = b.postalCode?.slice(0, 2) === dep ? 0 : 1;
      if (da !== db) return da - db;
      return Math.abs((a.price ?? 0) - (listing.price ?? 0)) - Math.abs((b.price ?? 0) - (listing.price ?? 0));
    });
    return this.toCards(items.slice(0, limit));
  }

  // -------------------------------------------------------------- historique

  async history(userId: string, limit = 40): Promise<ListingCard[]> {
    const views = await this.viewsRepo.find({ where: { userId }, order: { viewedAt: 'DESC' }, take: limit });
    if (views.length === 0) return [];
    const listings = await this.listingsRepo.find({ where: { id: In(views.map((v) => v.listingId)), status: In(['en_ligne', 'vendue', 'expiree']) } });
    const order = new Map(views.map((v, i) => [v.listingId, i]));
    listings.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return this.toCards(listings);
  }

  /** Identifiants des annonces déjà consultées (badge « Déjà vu » sur les cartes de résultats). */
  async historyIds(userId: string, limit = 200): Promise<string[]> {
    const views = await this.viewsRepo.find({ where: { userId }, order: { viewedAt: 'DESC' }, take: limit });
    return views.map((v) => v.listingId);
  }

  async clearHistory(userId: string) {
    await this.viewsRepo.delete({ userId });
    return { cleared: true };
  }

  // ------------------------------------------------------------- suggestions

  /**
   * Suggestions de recherche : titres d'annonces en ligne commençant par ou
   * contenant le terme, + noms de catégories. Si rien ne correspond, propose
   * une correction simple (distance de Levenshtein ≤ 2 sur les mots des titres).
   * LIMITE (documentée dans AUDIT.md) : requête LIKE sans index full-text,
   * suffisante jusqu'à quelques dizaines de milliers d'annonces.
   */
  async suggest(rawQ: string): Promise<{ suggestions: Array<{ type: 'titre' | 'categorie'; label: string; slug?: string }>; correction: string | null }> {
    const q = (rawQ || '').trim().toLowerCase();
    if (q.length < 2) return { suggestions: [], correction: null };
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const rows = await this.listingsRepo
      .createQueryBuilder('l')
      .select('l.title', 'title')
      .where('l.status = :s', { s: 'en_ligne' })
      .andWhere('LOWER(l.title) LIKE :like', { like })
      .orderBy('l.publishedAt', 'DESC')
      .limit(40)
      .getRawMany<{ title: string }>();
    const seen = new Set<string>();
    const suggestions: Array<{ type: 'titre' | 'categorie'; label: string; slug?: string }> = [];
    for (const r of rows) {
      const key = r.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ type: 'titre', label: r.title });
      if (suggestions.length >= 6) break;
    }
    const categories = await this.categoriesService.findAll();
    for (const c of categories) {
      if (c.name.toLowerCase().includes(q)) suggestions.push({ type: 'categorie', label: c.name, slug: c.slug });
      if (suggestions.length >= 9) break;
    }
    let correction: string | null = null;
    if (suggestions.length === 0 && q.length >= 4 && !q.includes(' ')) {
      const words = await this.listingsRepo
        .createQueryBuilder('l')
        .select('l.title', 'title')
        .where('l.status = :s', { s: 'en_ligne' })
        .orderBy('l.publishedAt', 'DESC')
        .limit(500)
        .getRawMany<{ title: string }>();
      const freq = new Map<string, number>();
      for (const w of words) for (const tok of w.title.toLowerCase().split(/[^a-zà-ÿ0-9]+/)) if (tok.length >= 4) freq.set(tok, (freq.get(tok) || 0) + 1);
      let best: { word: string; d: number; n: number } | null = null;
      for (const [word, n] of freq) {
        if (Math.abs(word.length - q.length) > 2) continue;
        const d = levenshtein(q, word);
        if (d <= 2 && (!best || d < best.d || (d === best.d && n > best.n))) best = { word, d, n };
      }
      correction = best?.word ?? null;
    }
    return { suggestions, correction };
  }

  // ---------------------------------------------------------------- import

  /**
   * Import de catalogue (CSV/XML) pour les comptes professionnels : création
   * ou mise à jour (par `reference`) en masse. Chaque ligne passe par les
   * mêmes validations qu'un dépôt manuel (catégorie, attributs, prix,
   * pré-modération). Les photos ne sont pas importées par URL (risque SSRF /
   * droits) : elles s'ajoutent ensuite depuis l'interface.
   */
  async importCatalog(actorId: string, filename: string, content: string, onBehalfOf?: string) {
    const ownerId = await this.resolveOwner(actorId, onBehalfOf);
    const owner = await this.usersService.findById(ownerId);
    if (!owner || owner.accountType !== 'professionnel') {
      throw new BadRequestException('L\'import de catalogue est réservé aux comptes professionnels.');
    }
    const format = detectFormat(filename, content);
    if (!format) throw new BadRequestException('Format non reconnu : envoyez un fichier .csv ou .xml.');
    const rows: ImportRow[] = format === 'csv' ? parseCsv(content) : parseXml(content);
    if (rows.length === 0) throw new BadRequestException('Aucune ligne exploitable dans le fichier.');
    if (rows.length > 500) throw new BadRequestException('Maximum 500 annonces par fichier.');

    const report = { total: rows.length, created: 0, updated: 0, pending: 0, errors: [] as Array<{ line: number; reference?: string; error: string }> };
    for (const row of rows) {
      try {
        if (!row.title || !row.description || !row.categorySlug) throw new Error('titre, description et categorie sont obligatoires');
        const dto: CreateListingDto = {
          title: row.title.slice(0, 150),
          description: row.description.slice(0, 5000),
          categorySlug: row.categorySlug,
          price: row.price,
          priceType: (row.priceType as any) || (row.price === undefined ? 'sur_demande' : 'fixe'),
          condition: row.condition as any,
          attributes: row.attributes,
          city: row.city,
          postalCode: row.postalCode,
          latitude: row.latitude,
          longitude: row.longitude,
          deliveryAvailable: row.deliveryAvailable,
          onBehalfOf: ownerId !== actorId ? ownerId : undefined,
        };
        if (dto.condition && !['neuf', 'tres_bon_etat', 'bon_etat', 'etat_satisfaisant', 'pour_pieces'].includes(dto.condition)) delete dto.condition;
        if (dto.postalCode && !/^\d{5}$/.test(dto.postalCode)) delete dto.postalCode;
        if (!['fixe', 'negociable', 'gratuit', 'echange', 'sur_demande'].includes(dto.priceType as string)) dto.priceType = 'fixe';

        const existing = row.externalRef
          ? await this.listingsRepo.findOne({ where: { userId: ownerId, externalRef: row.externalRef } })
          : null;
        if (existing) {
          const updated = await this.updateOwn(existing.id, actorId, {
            title: dto.title, description: dto.description, categorySlug: dto.categorySlug, price: dto.price,
            priceType: dto.priceType, condition: dto.condition, attributes: dto.attributes, city: dto.city,
            postalCode: dto.postalCode, latitude: dto.latitude, longitude: dto.longitude, deliveryAvailable: dto.deliveryAvailable,
            status: existing.status === 'desactivee' || existing.status === 'expiree' ? 'en_ligne' : undefined,
          } as UpdateListingDto);
          report.updated += 1;
          if (updated.status === 'en_attente') report.pending += 1;
        } else {
          const created = await this.create(actorId, dto);
          if (row.externalRef) await this.listingsRepo.update(created.id, { externalRef: row.externalRef });
          report.created += 1;
          if (created.status === 'en_attente') report.pending += 1;
        }
      } catch (err) {
        const msg = err instanceof BadRequestException ? String((err.getResponse() as any)?.message ?? err.message) : (err as Error).message;
        report.errors.push({ line: row.line, reference: row.externalRef, error: Array.isArray(msg) ? msg.join(' ') : msg });
      }
    }
    this.logger.log(`Import ${format} par ${actorId} pour ${ownerId} : ${report.created} créées, ${report.updated} mises à jour, ${report.errors.length} erreurs.`);
    return report;
  }

  // ---------------------------------------------------------------- recherche

  async search(query: SearchListingsDto & Record<string, any>) {
    const page = query.page || 1;
    const pageSize = query.page_size || 20;
    const useDistance = query.lat !== undefined && query.lng !== undefined;
    const radius = query.radius || 30;
    const now = new Date();

    const qb = this.listingsRepo.createQueryBuilder('l').where('l.status = :status', { status: 'en_ligne' });

    if (query.category) {
      const ids = await this.categoriesService.idsIncludingChildren(query.category);
      if (!ids) return { items: [], total: 0, page, pageSize };
      qb.andWhere('l.categoryId IN (:...ids)', { ids });
    }
    // « Étendre à la livraison » : le critère de lieu (commune, code postal, rayon) laisse aussi passer
    // les annonces livrables, où qu'elles soient en France.
    const deliveryAnywhere = query.delivery_anywhere === 'true';
    const orDelivery = (sql: string, params: Record<string, unknown>) => {
      if (deliveryAnywhere) qb.andWhere(new Brackets((b) => b.where(sql, params).orWhere('l.deliveryAvailable = :anyDelivery', { anyDelivery: true })));
      else qb.andWhere(sql, params);
    };
    if (query.city) orDelivery('LOWER(l.city) LIKE :city', { city: `%${escapeLike(query.city.toLowerCase())}%` });
    if (query.postal_code) orDelivery('l.postalCode LIKE :cp', { cp: `${query.postal_code}%` });
    if (query.region) {
      // Région administrative = liste de préfixes de code postal (fil d'Ariane des fiches)
      const prefixes = regionPostalPrefixes(query.region);
      if (prefixes.length === 0) return { items: [], total: 0, page, pageSize };
      const sql = prefixes.map((_, i) => `l.postalCode LIKE :reg${i}`).join(' OR ');
      const params = Object.fromEntries(prefixes.map((p, i) => [`reg${i}`, `${p}%`]));
      orDelivery(`(${sql})`, params);
    }
    if (query.seller) qb.andWhere('l.userId = :sellerId', { sellerId: query.seller });
    if (query.seller_type) qb.andWhere('l.userId IN (SELECT CAST(u.id AS varchar) FROM users u WHERE u."accountType" = :sellerType)', { sellerType: query.seller_type });
    if (query.q) {
      const q = `%${escapeLike(query.q.toLowerCase())}%`;
      if (this.isPostgres()) {
        // Plein texte français (index GIN, migration ListingsFullText) : pluriels, accents, ordre des mots.
        // Le LIKE reste en OR pour les codes/modèles courts (« 208 », « A3 ») que le stemming ignore.
        const fts = toPrefixTsQuery(query.q);
        if (fts) {
          qb.andWhere(`(${FTS_VECTOR_SQL} @@ to_tsquery('french', :fts) OR LOWER(l.title) LIKE :q)`, { fts, q });
        } else {
          qb.andWhere('(LOWER(l.title) LIKE :q OR LOWER(l.description) LIKE :q)', { q });
        }
      } else {
        qb.andWhere('(LOWER(l.title) LIKE :q OR LOWER(l.description) LIKE :q)', { q });
      }
    }
    if (query.price_min !== undefined) qb.andWhere('l.price >= :priceMin', { priceMin: query.price_min });
    if (query.price_max !== undefined) qb.andWhere('l.price <= :priceMax', { priceMax: query.price_max });
    if (query.condition && query.condition.length > 0) qb.andWhere('l.condition IN (:...conditions)', { conditions: query.condition });
    if (query.delivery === 'true') qb.andWhere('l.deliveryAvailable = :delivery', { delivery: true });
    if (query.with_photo === 'true') qb.andWhere('EXISTS (SELECT 1 FROM listing_photos p WHERE p."listingId" = CAST(l.id AS varchar))');
    if (query.urgent === 'true') qb.andWhere('l.urgentUntil > :now', { now });
    if (query.price_type) qb.andWhere('l.priceType = :priceType', { priceType: query.price_type });
    if (query.since_days) qb.andWhere('l.publishedAt > :since', { since: new Date(Date.now() - query.since_days * 86_400_000) });
    if (useDistance) {
      const box = boundingBox(query.lat!, query.lng!, radius);
      orDelivery('(l.latitude BETWEEN :minLat AND :maxLat AND l.longitude BETWEEN :minLng AND :maxLng)', { minLat: box.minLat, maxLat: box.maxLat, minLng: box.minLng, maxLng: box.maxLng });
    }

    const attrFilters = Object.entries(query)
      .filter(([k, v]) => k.startsWith('attr.') && v !== undefined && v !== '')
      .map(([k, v]) => ({ key: k.slice(5), value: String(v) }));

    // Les annonces boostées passent en tête (sauf tri par prix explicite)
    switch (query.sort) {
      case 'price_asc':
        qb.orderBy('l.price', 'ASC');
        break;
      case 'price_desc':
        qb.orderBy('l.price', 'DESC');
        break;
      case 'oldest':
        qb.orderBy('l.publishedAt', 'ASC').addOrderBy('l.createdAt', 'ASC');
        break;
      case 'relevance':
        // Pertinence (mot-clé) : score plein texte PostgreSQL, puis annonces mises en avant, puis fraîcheur.
        // Sans mot-clé ou sur SQLite, revient au tri par date.
        if (this.isPostgres() && query.q && toPrefixTsQuery(query.q)) {
          qb.addSelect(`ts_rank_cd(${FTS_VECTOR_SQL}, to_tsquery('french', :fts))`, 'fts_rank')
            .addSelect('CASE WHEN l.boostedUntil > :now THEN 1 ELSE 0 END', 'boost_rank')
            .setParameter('now', now)
            .orderBy('fts_rank', 'DESC')
            .addOrderBy('boost_rank', 'DESC')
            .addOrderBy('l.publishedAt', 'DESC');
          break;
        }
      // eslint-disable-next-line no-fallthrough
      default:
        qb.addSelect('CASE WHEN l.boostedUntil > :now THEN 1 ELSE 0 END', 'boost_rank')
          .setParameter('now', now)
          .orderBy('boost_rank', 'DESC')
          .addOrderBy('l.publishedAt', 'DESC')
          .addOrderBy('l.createdAt', 'DESC');
    }

    const needsMemoryPass = useDistance || attrFilters.length > 0 || query.sort === 'distance';
    if (!needsMemoryPass) {
      qb.skip((page - 1) * pageSize).take(pageSize);
      const [items, total] = await qb.getManyAndCount();
      return { items: await this.toCards(items), total, page, pageSize };
    }

    const candidates = await qb.take(2000).getMany();
    let filtered = candidates;
    if (attrFilters.length > 0) filtered = filtered.filter((l) => attrFilters.every((f) => matchAttr(l.attributes, f.key, f.value)));
    let withDistance: Array<Listing & { distanceKm?: number }> = filtered;
    if (useDistance) {
      withDistance = filtered
        .map((l) => ({ ...l, distanceKm: l.latitude != null && l.longitude != null ? Math.round(haversineKm(query.lat!, query.lng!, l.latitude!, l.longitude!) * 10) / 10 : undefined }))
        // Dans le rayon, ou livrable partout si « Étendre à la livraison » est coché
        .filter((l) => (l.distanceKm !== undefined && l.distanceKm <= radius) || (deliveryAnywhere && l.deliveryAvailable));
      if (query.sort === 'distance' || !query.sort) {
        withDistance.sort((a, b) => {
          const ba = a.boostedUntil && new Date(a.boostedUntil) > now ? 1 : 0;
          const bb = b.boostedUntil && new Date(b.boostedUntil) > now ? 1 : 0;
          if (ba !== bb) return bb - ba;
          // Les annonces hors rayon (livrables) passent après celles qui sont proches
          const da = a.distanceKm !== undefined && a.distanceKm <= radius ? a.distanceKm : Number.POSITIVE_INFINITY;
          const db = b.distanceKm !== undefined && b.distanceKm <= radius ? b.distanceKm : Number.POSITIVE_INFINITY;
          return da - db;
        });
      }
    }
    const total = withDistance.length;
    const pageItems = withDistance.slice((page - 1) * pageSize, page * pageSize);
    const cards = await this.toCards(pageItems);
    return { items: cards.map((c, i) => ({ ...c, distanceKm: pageItems[i].distanceKm })), total, page, pageSize };
  }

  async toCards(listings: Listing[]): Promise<ListingCard[]> {
    if (listings.length === 0) return [];
    const ids = listings.map((l) => l.id);
    const photos = await this.photosRepo.find({ where: { listingId: In(ids) }, order: { sortOrder: 'ASC' } });
    const photosByListing = new Map<string, ListingPhoto[]>();
    for (const p of photos) {
      if (!photosByListing.has(p.listingId)) photosByListing.set(p.listingId, []);
      photosByListing.get(p.listingId)!.push(p);
    }
    const userIds = [...new Set(listings.map((l) => l.userId))];
    const users = await this.usersRepo.find({ where: { id: In(userIds) } });
    const usersById = new Map(users.map((u) => [u.id, u]));
    const categories = await this.categoriesService.findAll();
    const catById = new Map(categories.map((c) => [c.id, c]));
    const now = Date.now();

    return listings.map((l) => {
      const ph = photosByListing.get(l.id) || [];
      const u = usersById.get(l.userId);
      const c = catById.get(l.categoryId);
      return {
        ...l,
        latitude: l.latitude != null ? Math.round(l.latitude * 100) / 100 : l.latitude,
        longitude: l.longitude != null ? Math.round(l.longitude * 100) / 100 : l.longitude,
        coverUrl: ph[0]?.thumbUrl || ph[0]?.url || null,
        photosCount: ph.length,
        categorySlug: c?.slug,
        categoryName: c?.name,
        isBoosted: !!l.boostedUntil && new Date(l.boostedUntil).getTime() > now,
        isUrgent: !!l.urgentUntil && new Date(l.urgentUntil).getTime() > now,
        isComplete: computeCompleteness(l, ph.length, this.schemaForCategory(c, catById)).complete,
        seller: u
          ? { id: u.id, displayName: u.deletedAt ? 'Compte supprimé' : u.displayName, accountType: u.accountType, shopName: u.shopName, identityVerified: u.identityVerified, ratingAvg: u.ratingAvg, ratingCount: u.ratingCount }
          : undefined,
      };
    });
  }

  /**
   * Nombre d'annonces par type de vendeur pour la recherche courante (affiché à côté des cases
   * « Particuliers » / « Professionnels » du panneau de filtres), et total sans ce filtre.
   */
  async sellerTypeFacets(query: SearchListingsDto & Record<string, any>): Promise<{ total: number; particulier: number; professionnel: number }> {
    const base = { ...query, page: 1, page_size: 1 };
    const [all, particulier, professionnel] = await Promise.all([
      this.search({ ...base, seller_type: undefined }),
      this.search({ ...base, seller_type: 'particulier' }),
      this.search({ ...base, seller_type: 'professionnel' }),
    ]);
    return { total: all.total, particulier: particulier.total, professionnel: professionnel.total };
  }

  /**
   * Sections de découverte en bas d'une page de catégorie : fil d'Ariane, recherches suggérées
   * (sous-catégories et valeurs des critères de la catégorie, marques pour les véhicules) et
   * localisations les plus demandées (villes des annonces en ligne de la catégorie, complétées par
   * les grandes villes tant que le site est jeune). Aucune donnée personnelle, rien d'inventé.
   */
  async discover(slug: string): Promise<{ breadcrumb: Array<{ slug: string; name: string }>; suggestions: Array<{ label: string; href: string }>; cities: Array<{ city: string; count: number }> }> {
    const category = await this.categoriesService.findBySlug(slug);
    if (!category) throw new NotFoundException('Catégorie inconnue.');
    const all = await this.categoriesService.findAll();
    const byId = new Map(all.map((c) => [c.id, c]));
    const parent = category.parentId ? byId.get(category.parentId) : undefined;
    const breadcrumb = [...(parent ? [{ slug: parent.slug, name: parent.name }] : []), { slug: category.slug, name: category.name }];

    const suggestions: Array<{ label: string; href: string }> = [];
    const children = all.filter((c) => c.parentId === category.id).sort((a, b) => a.sortOrder - b.sortOrder);
    for (const c of children) suggestions.push({ label: c.name, href: `/recherche?category=${c.slug}` });
    const schema = getSchemaForSlugs(category.slug, parent?.slug);
    for (const field of schema.filter((f) => f.filterable && f.type === 'select' && f.options && f.options.length > 0)) {
      for (const option of field.options!.filter((o) => o !== 'Autre').slice(0, field.key === 'marque' ? 12 : 8)) {
        if (suggestions.length >= NB_SUGGESTIONS) break;
        suggestions.push({ label: `${category.name} ${option}`, href: `/recherche?category=${category.slug}&attr.${field.key}=${encodeURIComponent(option)}` });
      }
      if (suggestions.length >= NB_SUGGESTIONS) break;
    }

    const ids = (await this.categoriesService.idsIncludingChildren(category.slug)) || [];
    const rows: Array<{ city: string; n: string | number }> = ids.length
      ? await this.listingsRepo
          .createQueryBuilder('l')
          .select('l.city', 'city')
          .addSelect('COUNT(*)', 'n')
          .where('l.status = :status', { status: 'en_ligne' })
          .andWhere('l.categoryId IN (:...ids)', { ids })
          .andWhere('l.city IS NOT NULL')
          .groupBy('l.city')
          .orderBy('n', 'DESC')
          .limit(NB_VILLES)
          .getRawMany()
      : [];
    const cities = rows.map((r) => ({ city: r.city, count: Number(r.n) }));
    for (const city of GRANDES_VILLES) {
      if (cities.length >= NB_VILLES) break;
      if (!cities.some((c) => c.city.toLowerCase() === city.toLowerCase())) cities.push({ city, count: 0 });
    }
    return { breadcrumb, suggestions: suggestions.slice(0, NB_SUGGESTIONS), cities };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expireListings(): Promise<number> {
    const result = await this.listingsRepo.update({ status: 'en_ligne', expiresAt: LessThan(new Date()) }, { status: 'expiree' });
    const n = result.affected || 0;
    if (n > 0) this.logger.log(`${n} annonce(s) expirée(s).`);
    return n;
  }

  async sellerStats(userId: string) {
    const listings = await this.listingsRepo.find({ where: { userId } });
    const ids = listings.map((l) => l.id);
    const favorites = ids.length ? await this.favoritesRepo.count({ where: { listingId: In(ids) } }) : 0;
    const byStatus: Record<string, number> = {};
    let views = 0;
    let boosted = 0;
    const now = Date.now();
    for (const l of listings) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      views += l.viewsCount;
      if (l.boostedUntil && new Date(l.boostedUntil).getTime() > now) boosted += 1;
    }
    return { total: listings.length, byStatus, views, favorites, boosted };
  }
}

function escapeLike(s: string): string {
  return s.replace(/[%_]/g, (m) => `\\${m}`);
}

function matchAttr(attrs: Record<string, unknown> | undefined, key: string, value: string): boolean {
  if (!attrs) return false;
  if (key.endsWith('_min')) {
    const v = attrs[key.slice(0, -4)];
    return typeof v === 'number' && v >= Number(value);
  }
  if (key.endsWith('_max')) {
    const v = attrs[key.slice(0, -4)];
    return typeof v === 'number' && v <= Number(value);
  }
  const v = attrs[key];
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return String(v) === value;
  return String(v).toLowerCase() === value.toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[m][n];
}
