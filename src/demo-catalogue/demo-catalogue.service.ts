import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { In, IsNull, Like, Not, Repository } from 'typeorm';
import { hashPassword } from '../auth/password';
import { normalizeFrenchMobile } from '../common/validators/french-phone';
import { processImage, sniffImageExtension, THUMB_SIDE } from '../common/upload/image-upload';
import { getStorage, publicUploadPath } from '../common/upload/storage.service';
import { Conversation } from '../conversations/conversation.entity';
import { ConversationsService, DEMO_AUTO_REPLY } from '../conversations/conversations.service';
export { DEMO_AUTO_REPLY };
import { Message } from '../conversations/message.entity';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { Listing } from '../listings/listing.entity';
import { ListingsService } from '../listings/listings.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import accountsData from './data/accounts.json';
import listingsData from './data/listings.json';
import photosData from './data/photos.json';

/** Compte vendeur de démonstration (jeu de données versionné, sans mot de passe). */
export interface DemoAccount { key: string; firstName: string; lastName: string; username: string; phone: string; city: string; postalCode: string }
export interface DemoListing {
  key: string; slug: string; family: string; title: string; description: string; price: number | null; priceType: string;
  condition?: string; attributes: Record<string, string | number | boolean>; photosWanted: number; photoQueries: string[];
  publishedDaysAgo: number; sellerKey: string; city: string; postalCode: string;
}
/** Photo libre de droits résolue avant le déploiement (source, auteur et page d'origine consignés). */
export interface DemoPhoto { url: string; source: string; id: string; author: string; authorUrl?: string; landing: string; license: string; width?: number; height?: number }

export interface DemoRunState {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  done: number;
  accounts: { created: number; existing: number };
  listings: { created: number; existing: number; failed: number; withoutPhoto: number };
  photos: { created: number; failed: number };
  errors: string[];
  lastError: string | null;
}

const DEMO_EMAIL_PREFIX = 'ousbaali11+demo-';
const DEMO_EMAIL_DOMAIN = '@gmail.com';
const DEMO_REF_PREFIX = 'demo:';
const FETCH_TIMEOUT_MS = 25_000;
const UA = 'Trocoin-demo-catalogue/1.0 (https://www.trocoin.fr)';


/**
 * Catalogue de démonstration (AUDIT §71) : ~600 annonces réalistes réparties par catégorie sur 50 comptes vendeurs fictifs,
 * créées côté serveur par un administrateur (les limites de débit de l'API publique interdisent un envoi externe de cette
 * taille). Idempotent et repris là où il s'était arrêté : comptes retrouvés par leur e-mail, annonces par `externalRef`
 * (`demo:<clé>`), photos téléchargées depuis leur source libre de droits puis passées par le même traitement que les envois
 * des membres (ré-encodage, vignette, stockage courant). Les comptes portent `isDemoAccount`, `securePaymentDisabled` et
 * `phonePublic: false` : aucun paiement en ligne, numéro jamais révélé.
 */
@Injectable()
export class DemoCatalogueService {
  private readonly logger = new Logger('CatalogueDemo');
  private readonly accounts = accountsData as unknown as DemoAccount[];
  private readonly listings = listingsData as unknown as DemoListing[];
  private readonly photos = photosData as unknown as Record<string, DemoPhoto[]>;
  /** Identifiants générés pendant l'exécution en cours : remis une seule fois à l'administrateur, jamais conservés. */
  private pendingCredentials: Array<{ name: string; email: string; username: string; password: string; phone: string }> = [];
  private state: DemoRunState = { status: 'idle', startedAt: null, finishedAt: null, total: 0, done: 0, accounts: { created: 0, existing: 0 }, listings: { created: 0, existing: 0, failed: 0, withoutPhoto: 0 }, photos: { created: 0, failed: 0 }, errors: [], lastError: null };
  /** Téléchargement des photos (remplaçable par les tests : aucun réseau). */
  fetchImage: (url: string) => Promise<Buffer> = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': UA, Accept: 'image/jpeg,image/png,image/webp,image/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000 || buf.length > 12_000_000) throw new Error(`taille ${buf.length}`);
    return buf;
  };

  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(ListingPhoto) private photosRepo: Repository<ListingPhoto>,
    @InjectRepository(Conversation) private conversationsRepo: Repository<Conversation>,
    @InjectRepository(Message) private messagesRepo: Repository<Message>,
    private usersService: UsersService,
    private listingsService: ListingsService,
    private conversations: ConversationsService,
  ) {}

  emailOf(a: DemoAccount): string { return `${DEMO_EMAIL_PREFIX}${a.username.replace(/_/g, '.')}${DEMO_EMAIL_DOMAIN}`; }

  /** Résumé du jeu de données et de ce qui existe déjà en base. */
  async summary() {
    const byFamily: Record<string, number> = {};
    for (const l of this.listings) byFamily[l.family] = (byFamily[l.family] || 0) + 1;
    const photosPlanned = Object.values(this.photos).reduce((s, arr) => s + arr.length, 0);
    const usernames = this.accounts.map((a) => a.username);
    const accountsInDb = await this.usersRepo.count({ where: { username: In(usernames), deletedAt: IsNull() } });
    const listingsInDb = await this.listingsRepo.count({ where: { externalRef: Like(`${DEMO_REF_PREFIX}%`) } });
    const online = await this.listingsRepo.count({ where: { externalRef: Like(`${DEMO_REF_PREFIX}%`), status: 'en_ligne' } });
    return {
      dataset: { accounts: this.accounts.length, listings: this.listings.length, photosPlanned, listingsWithPhotos: this.listings.filter((l) => (this.photos[l.key] || []).length > 0).length, minPhotoCoverage: DemoCatalogueService.MIN_PHOTO_COVERAGE, byFamily },
      database: { accounts: accountsInDb, listings: listingsInDb, online },
      run: this.state,
      credentialsPending: this.pendingCredentials.length,
    };
  }

  /** Lance l'ensemencement en arrière-plan (une seule exécution à la fois). `limit` : nombre d'annonces (tests, essai). */
  /** Part minimale d'annonces avec photos pour lancer l'ensemencement (un catalogue sans photos ne ressemble à rien). */
  static readonly MIN_PHOTO_COVERAGE = 0.9;

  start(opts: { limit?: number; photos?: boolean; force?: boolean } = {}): DemoRunState {
    if (this.state.status === 'running') throw new ConflictException('Une exécution est déjà en cours.');
    const selection = opts.limit ? this.listings.slice(0, opts.limit) : this.listings;
    // AUDIT §71 : les photos sont résolues avant le déploiement (resolve-photos.js) ; sans elles, rien n'est créé
    const covered = selection.filter((l) => (this.photos[l.key] || []).length > 0).length;
    if (opts.photos !== false && !opts.force && covered < selection.length * DemoCatalogueService.MIN_PHOTO_COVERAGE) {
      throw new BadRequestException(`Le jeu de données n'a pas encore ses photos (${covered} annonces sur ${selection.length}) : lancez scripts/demo-catalogue/resolve-photos.js avant de créer le catalogue.`);
    }
    this.state = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, total: selection.length, done: 0, accounts: { created: 0, existing: 0 }, listings: { created: 0, existing: 0, failed: 0, withoutPhoto: 0 }, photos: { created: 0, failed: 0 }, errors: [], lastError: null };
    void this.run(selection, opts.photos !== false).catch((err) => {
      this.state.status = 'error';
      this.state.lastError = (err as Error).message;
      this.state.finishedAt = new Date().toISOString();
      this.logger.error(`Catalogue de démonstration interrompu : ${(err as Error).message}`);
    });
    return this.state;
  }

  /** Exécution synchrone (tests) : mêmes étapes, résultat attendu. */
  async runNow(opts: { limit?: number; photos?: boolean; force?: boolean } = {}): Promise<DemoRunState> {
    const state = this.start(opts);
    while (state.status === 'running') await new Promise((r) => setTimeout(r, 25));
    return this.state;
  }

  /**
   * AUDIT §73 : les identifiants ne vivent qu'en mémoire jusqu'à leur lecture ; si l'API s'est endormie (offre gratuite) ou a
   * redémarré avant, ils sont perdus. Nouveaux mots de passe pour TOUS les comptes de démonstration, remis une seule fois
   * (sessions ouvertes de ces comptes conservées : aucun membre réel n'est concerné).
   */
  async regenerateCredentials(): Promise<Array<{ name: string; email: string; username: string; password: string; phone: string }>> {
    const users = await this.usersRepo.find({ where: { isDemoAccount: true, deletedAt: IsNull() }, order: { createdAt: 'ASC' } });
    const items: Array<{ name: string; email: string; username: string; password: string; phone: string }> = [];
    for (const u of users) {
      const password = randomBytes(9).toString('base64url') + '-Tr0c';
      await this.usersService.setPasswordHash(u.id, await hashPassword(password));
      items.push({ name: `${u.firstName} ${u.lastName}`, email: u.email ?? '', username: u.username ?? '', password, phone: u.phoneNumber ?? '' });
    }
    this.pendingCredentials = [];
    this.logger.log(`Catalogue de démonstration : mots de passe régénérés pour ${items.length} compte(s)`);
    return items;
  }

  /** Identifiants des comptes créés pendant l'exécution : lus une seule fois, puis effacés de la mémoire. */
  takeCredentials() {
    const out = this.pendingCredentials;
    this.pendingCredentials = [];
    return out;
  }

  private async run(selection: DemoListing[], withPhotos: boolean): Promise<void> {
    const users = new Map<string, User>();
    const needed = new Set(selection.map((l) => l.sellerKey));
    for (const a of this.accounts) {
      if (!needed.has(a.key)) continue;
      users.set(a.key, await this.ensureAccount(a));
    }
    for (const l of selection) {
      try {
        await this.ensureListing(l, users.get(l.sellerKey)!, withPhotos);
      } catch (err) {
        this.state.listings.failed += 1;
        this.recordError(`${l.key} (${l.title}) : ${(err as Error).message}`);
      }
      this.state.done += 1;
    }
    this.state.status = 'done';
    this.state.finishedAt = new Date().toISOString();
    this.logger.log(`Catalogue de démonstration : ${this.state.listings.created} annonce(s) créée(s), ${this.state.listings.existing} déjà présente(s), ${this.state.listings.failed} échec(s), ${this.state.photos.created} photo(s)`);
  }

  private recordError(message: string) {
    this.state.lastError = message.slice(0, 300);
    if (this.state.errors.length < 60) this.state.errors.push(message.slice(0, 300));
    this.logger.warn(`Catalogue de démonstration — ${message.slice(0, 300)}`);
  }

  private async ensureAccount(a: DemoAccount): Promise<User> {
    const email = this.emailOf(a);
    const existing = (await this.usersService.findByEmail(email)) ?? (await this.usersRepo.findOne({ where: { username: a.username } }));
    if (existing) {
      this.state.accounts.existing += 1;
      // Les garde-fous sont réaffirmés à chaque passage (un compte réutilisé ne doit jamais retrouver un numéro visible ou le paiement)
      await this.usersRepo.update(existing.id, { isDemoAccount: true, securePaymentDisabled: true, phonePublic: false });
      return existing;
    }
    const password = randomBytes(9).toString('base64url') + '-Tr0c';
    const user = await this.usersService.createWithCredentials({ accountType: 'particulier', firstName: a.firstName, lastName: a.lastName, username: a.username, email, phoneNumber: normalizeFrenchMobile(a.phone) || a.phone, passwordHash: await hashPassword(password) });
    await this.usersRepo.update(user.id, { isDemoAccount: true, securePaymentDisabled: true, phonePublic: false, emailVerified: true, city: a.city, postalCode: a.postalCode });
    this.state.accounts.created += 1;
    this.pendingCredentials.push({ name: `${a.firstName} ${a.lastName}`, email, username: a.username, password, phone: a.phone });
    this.logger.log(`Compte de démonstration créé : ${a.username}`);
    return user;
  }

  private async ensureListing(l: DemoListing, seller: User, withPhotos: boolean): Promise<void> {
    const ref = `${DEMO_REF_PREFIX}${l.key}`;
    let listing = await this.listingsRepo.findOne({ where: { userId: seller.id, externalRef: ref } });
    if (listing) {
      this.state.listings.existing += 1;
    } else {
      listing = await this.listingsService.create(seller.id, {
        title: l.title,
        description: l.description,
        categorySlug: l.slug,
        price: l.price ?? undefined,
        priceType: l.priceType as never,
        condition: l.condition as never,
        attributes: l.attributes,
        city: l.city,
        postalCode: l.postalCode,
        deliveryAvailable: false,
      });
      const when = new Date(Date.now() - l.publishedDaysAgo * 86_400_000 - Math.floor(Math.random() * 6 * 3_600_000));
      await this.listingsRepo.update(listing.id, { externalRef: ref, createdAt: when, publishedAt: listing.status === 'en_ligne' ? when : listing.publishedAt } as Partial<Listing>);
      this.state.listings.created += 1;
    }
    if (!withPhotos) return;
    const planned = this.photos[l.key] || [];
    if (planned.length === 0) {
      this.state.listings.withoutPhoto += 1;
      return;
    }
    const have = await this.photosRepo.count({ where: { listingId: listing.id } });
    for (let i = have; i < planned.length; i += 1) {
      try {
        await this.storePhoto(listing.id, planned[i], i);
        this.state.photos.created += 1;
      } catch (err) {
        this.state.photos.failed += 1;
        this.recordError(`${l.key} photo ${i + 1} (${planned[i].source}) : ${(err as Error).message}`);
      }
    }
  }

  /** Téléchargement, ré-encodage (métadonnées purgées), vignette et stockage : le même chemin que les photos des membres. */
  private async storePhoto(listingId: string, photo: DemoPhoto, sortOrder: number): Promise<void> {
    const raw = await this.fetchImage(photo.url);
    const ext = sniffImageExtension(raw.subarray(0, 16));
    if (!ext) throw new Error('fichier reçu non reconnu comme image');
    const processed = await processImage(raw, ext);
    const thumb = await processImage(processed, ext, THUMB_SIDE);
    const storage = getStorage();
    const base = randomUUID();
    const contentType = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
    const url = await storage.put(publicUploadPath(`${base}.${ext}`), processed, contentType);
    const thumbUrl = await storage.put(publicUploadPath(`${base}-min.${ext}`), thumb, contentType);
    await this.photosRepo.save(this.photosRepo.create({ listingId, url, thumbUrl, sortOrder, lockedAt: new Date() }));
  }

  // ------------------------------------------------------------------ suivi des conversations (AUDIT §71, option A)

  private async demoSellerIds(): Promise<string[]> {
    const rows = await this.usersRepo.find({ where: { isDemoAccount: true, deletedAt: IsNull() }, select: ['id'] });
    return rows.map((r) => r.id);
  }

  /** Conversations ouvertes avec un compte de démonstration : les plus récentes d'abord, avec ce qui attend une réponse. */
  async listConversations(limit = 100) {
    const sellerIds = await this.demoSellerIds();
    if (sellerIds.length === 0) return [];
    const convs = await this.conversationsRepo.find({ where: { sellerId: In(sellerIds) }, order: { lastMessageAt: 'DESC', createdAt: 'DESC' }, take: limit });
    if (convs.length === 0) return [];
    const ids = convs.map((c) => c.id);
    const lastMessages = await this.messagesRepo.createQueryBuilder('m')
      .where('m.conversationId IN (:...ids)', { ids })
      .andWhere('m.id IN (SELECT m2.id FROM messages m2 WHERE m2."conversationId" = m."conversationId" ORDER BY m2."createdAt" DESC LIMIT 1)')
      .getMany();
    const lastBy = new Map(lastMessages.map((m) => [m.conversationId, m]));
    const listings = await this.listingsRepo.find({ where: { id: In([...new Set(convs.map((c) => c.listingId))]) } });
    const listingById = new Map(listings.map((l) => [l.id, l]));
    const users = await this.usersRepo.find({ where: { id: In([...new Set(convs.flatMap((c) => [c.buyerId, c.sellerId]))]) }, select: ['id', 'displayName', 'isDemoAccount'] });
    const userById = new Map(users.map((u) => [u.id, u]));
    const out: Array<Record<string, unknown>> = [];
    for (const c of convs) {
      const last = lastBy.get(c.id);
      const unread = await this.messagesRepo.count({ where: { conversationId: c.id, senderId: Not(c.sellerId), readAt: IsNull() } });
      const l = listingById.get(c.listingId);
      out.push({
        id: c.id,
        listing: l ? { id: l.id, title: l.title, price: l.price, status: l.status } : null,
        buyer: { id: c.buyerId, displayName: userById.get(c.buyerId)?.displayName ?? 'Membre' },
        seller: { id: c.sellerId, displayName: userById.get(c.sellerId)?.displayName ?? 'Compte de démonstration' },
        lastMessage: last ? { content: last.type === 'text' ? (last.content ?? '') : `[${last.type}]`, senderId: last.senderId, createdAt: last.createdAt, auto: last.meta?.auto === 'demo', staff: last.meta?.staff === 1 } : null,
        unreadFromBuyer: unread,
        needsReply: !!last && last.senderId === c.buyerId,
        lastMessageAt: c.lastMessageAt,
      });
    }
    return out;
  }

  /** Réponse de l'équipe au nom du compte de démonstration : signée « Équipe Trocoin », visible comme telle. */
  async replyAsDemoSeller(conversationId: string, content: string): Promise<Message> {
    const c = await this.conversationsRepo.findOne({ where: { id: conversationId } });
    if (!c) throw new NotFoundException('Conversation introuvable.');
    const seller = await this.usersRepo.findOne({ where: { id: c.sellerId } });
    if (!seller?.isDemoAccount) throw new BadRequestException("Cette conversation n'implique pas un compte de démonstration.");
    const text = (content || '').trim();
    if (!text) throw new BadRequestException('Message vide.');
    const message = await this.conversations.postMessage(conversationId, c.sellerId, `Équipe Trocoin — ${text}`, { staff: 1 });
    await this.conversations.markRead(conversationId, c.sellerId);
    return message;
  }

  /** Messages d'une conversation (lecture par l'administration, pour répondre en connaissance de cause). */
  async conversationMessages(conversationId: string) {
    const c = await this.conversationsRepo.findOne({ where: { id: conversationId } });
    if (!c) throw new NotFoundException('Conversation introuvable.');
    const seller = await this.usersRepo.findOne({ where: { id: c.sellerId } });
    if (!seller?.isDemoAccount) throw new BadRequestException("Cette conversation n'implique pas un compte de démonstration.");
    const messages = (await this.messagesRepo.find({ where: { conversationId }, order: { createdAt: 'ASC' }, take: 200 })).map((m) => this.conversations.attachmentViewFor(m)); // AUDIT §74
    return messages.map((m) => ({ id: m.id, senderId: m.senderId, fromSeller: m.senderId === c.sellerId, type: m.type, content: m.content ?? null, createdAt: m.createdAt, readAt: m.readAt ?? null, auto: m.meta?.auto === 'demo', staff: m.meta?.staff === 1 }));
  }
}
