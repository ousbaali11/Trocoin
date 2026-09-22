import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { EmailVerificationToken } from '../auth/email-verification-token.entity';
import { PasswordResetToken } from '../auth/password-reset-token.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { deleteUploadedFile } from '../common/upload/image-upload';
import { Favorite } from '../favorites/favorite.entity';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { ListingView } from '../listings/listing-view.entity';
import { Listing } from '../listings/listing.entity';
import { Notification } from '../notifications/notification.entity';
import { Transaction } from '../payments/transaction.entity';
import { Review } from '../reviews/review.entity';
import { SavedSearch } from '../saved-searches/saved-search.entity';
import { Subscription } from '../settings/subscription.entity';
import { Shipment } from '../shipping/shipment.entity';
import { UserBlock } from '../users/user-block.entity';
import { User } from '../users/user.entity';

/** Libellés génériques affichés partout où une donnée effacée est encore référencée. */
export const DELETED_ACCOUNT_LABEL = 'Compte supprimé';
export const DELETED_LISTING_LABEL = 'Annonce supprimée';

/**
 * Suppression réelle et règles de conservation (AUDIT §41).
 *
 * Une annonce ou un compte supprimé (par le membre ou par un administrateur) est **effacé de la base** :
 * plus aucune ligne dans les listes du panneau admin, photos et fichiers effacés, données personnelles
 * effacées, identifiants (numéro, e-mail, pseudo) libérés.
 *
 * Seule exception, imposée par l'obligation de conserver une trace comptable des ventes (code de
 * commerce, art. L123-22 : 10 ans) : une **transaction payée** (une autorisation bancaire a eu lieu,
 * `paidAt` renseigné, quel que soit son sort ensuite : confirmée, remboursée, annulée) est conservée avec
 * ses montants, ses dates et ses références (identifiants, référence du paiement et du virement), et le
 * titre de l'annonce (pas une donnée personnelle) ; tout ce qui identifie une personne y est effacé
 * (adresse de livraison, adresses de l'étiquette, code de remise) et les parties s'affichent sous le
 * libellé « Compte supprimé » / « Annonce supprimée ». Une transaction jamais payée (page de paiement
 * abandonnée) est effacée.
 *
 * Conservés volontairement : le **journal d'audit** (qui a supprimé quoi, quand, pourquoi — c'est une
 * entrée séparée, pas une copie du contenu), les **signalements** (historique de modération, parties
 * affichées comme supprimées), les **conversations et messages** (historique de l'autre partie, qui voit
 * « Compte supprimé » / « Cette annonce n'existe plus »), les **avis rédigés** par le compte supprimé (la
 * note des autres vendeurs ne doit pas changer ; l'auteur s'affiche « Compte supprimé »).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger('Rétention');

  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(UserBlock) private blocksRepo: Repository<UserBlock>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    @InjectRepository(ListingPhoto) private photosRepo: Repository<ListingPhoto>,
    @InjectRepository(ListingView) private viewsRepo: Repository<ListingView>,
    @InjectRepository(Favorite) private favoritesRepo: Repository<Favorite>,
    @InjectRepository(Transaction) private transactionsRepo: Repository<Transaction>,
    @InjectRepository(Shipment) private shipmentsRepo: Repository<Shipment>,
    @InjectRepository(Review) private reviewsRepo: Repository<Review>,
    @InjectRepository(Notification) private notificationsRepo: Repository<Notification>,
    @InjectRepository(SavedSearch) private savedSearchesRepo: Repository<SavedSearch>,
    @InjectRepository(Subscription) private subscriptionsRepo: Repository<Subscription>,
    @InjectRepository(RefreshToken) private refreshTokensRepo: Repository<RefreshToken>,
    @InjectRepository(EmailVerificationToken) private emailTokensRepo: Repository<EmailVerificationToken>,
    @InjectRepository(PasswordResetToken) private resetTokensRepo: Repository<PasswordResetToken>,
  ) {}

  /** Efface les transactions jamais payées (et leurs étiquettes éventuelles) ; renvoie les identifiants effacés. */
  private async deleteUnpaidTransactions(transactions: Transaction[]): Promise<string[]> {
    const ids = transactions.filter((t) => !t.paidAt).map((t) => t.id);
    if (ids.length === 0) return [];
    await this.shipmentsRepo.delete({ transactionId: In(ids) });
    await this.transactionsRepo.delete({ id: In(ids) });
    return ids;
  }

  /**
   * Annonce : effacée de la base (photos et fichiers, favoris, historique de consultation). Les ventes
   * payées la concernant gardent leur trace comptable avec le titre de l'annonce ; les autres sont effacées.
   */
  /** Délai de conservation d'une annonce archivée (jours) avant effacement réel — prolongé tant qu'un litige est possible. */
  static readonly ARCHIVE_DAYS = 90;

  /**
   * Archivage (AUDIT §63) : à la fin d'une vente, l'annonce n'est plus effacée sur-le-champ mais **archivée** — retirée
   * de tout ce que voient les membres (recherche, fiche, « Mes annonces », favoris, historique), conservée avec ses
   * photos pour l'administration (un litige peut s'ouvrir après la réception ; l'admin doit pouvoir consulter l'annonce
   * telle qu'elle était). Effacement réel par `purgeArchived` après ARCHIVE_DAYS, jamais tant qu'un litige est ouvert
   * ou possible.
   */
  async archiveListing(listing: Listing): Promise<void> {
    if (listing.status === 'archivee') return;
    const transactions = await this.transactionsRepo.find({ where: { listingId: listing.id } });
    for (const tx of transactions) if (tx.paidAt && !tx.listingTitle) await this.transactionsRepo.update(tx.id, { listingTitle: listing.title });
    await this.deleteUnpaidTransactions(transactions);
    await this.favoritesRepo.delete({ listingId: listing.id });
    await this.viewsRepo.delete({ listingId: listing.id });
    await this.listingsRepo.update(listing.id, { status: 'archivee', archivedAt: new Date() });
    this.logger.log(`Annonce ${listing.id} archivée (consultable par l'administration, effacée dans ${RetentionService.ARCHIVE_DAYS} jours)`);
  }

  /** Annonces archivées arrivées à échéance : effacées, sauf litige ouvert ou fenêtre de litige encore ouverte. */
  @Cron('40 4 * * *')
  async purgeArchived(now: Date = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - RetentionService.ARCHIVE_DAYS * 86_400_000);
    const archived = await this.listingsRepo.find({ where: { status: 'archivee', archivedAt: LessThan(limit) }, take: 200 });
    let purged = 0;
    for (const listing of archived) {
      const txs = await this.transactionsRepo.find({ where: { listingId: listing.id } });
      const blocked = txs.some((t) => t.status === 'litige' || (t.disputeAllowedUntil && new Date(t.disputeAllowedUntil) > now));
      if (blocked) continue;
      await this.purgeListing(listing);
      purged += 1;
    }
    if (purged) this.logger.log(`${purged} annonce(s) archivée(s) effacée(s) après ${RetentionService.ARCHIVE_DAYS} jours`);
    return purged;
  }

  async purgeListing(listing: Listing): Promise<{ keptTransactions: number; deletedTransactions: number }> {
    const transactions = await this.transactionsRepo.find({ where: { listingId: listing.id } });
    const paid = transactions.filter((t) => !!t.paidAt);
    for (const tx of paid) if (!tx.listingTitle) await this.transactionsRepo.update(tx.id, { listingTitle: listing.title });
    const deleted = await this.deleteUnpaidTransactions(transactions);
    const photos = await this.photosRepo.find({ where: { listingId: listing.id } });
    await Promise.all(photos.flatMap((p) => [deleteUploadedFile(p.url), deleteUploadedFile(p.thumbUrl)]));
    await this.photosRepo.delete({ listingId: listing.id });
    await this.favoritesRepo.delete({ listingId: listing.id });
    await this.viewsRepo.delete({ listingId: listing.id });
    await this.listingsRepo.delete(listing.id);
    this.logger.log(`Annonce ${listing.id} effacée (${paid.length} vente(s) payée(s) conservée(s), ${deleted.length} transaction(s) non payée(s) effacée(s))`);
    return { keptTransactions: paid.length, deletedTransactions: deleted.length };
  }

  /**
   * Compte : annonces effacées (règle ci-dessus), transactions payées conservées sans données personnelles,
   * transactions non payées effacées, avis reçus effacés, données propres au compte effacées, fichiers
   * effacés, puis la ligne utilisateur elle-même. Les identifiants redeviennent utilisables.
   */
  async purgeUser(user: User): Promise<{ listings: number; keptTransactions: number; deletedTransactions: number }> {
    const listings = await this.listingsRepo.find({ where: { userId: user.id } });
    let deletedTransactions = 0;
    for (const l of listings) deletedTransactions += (await this.purgeListing(l)).deletedTransactions;

    const asParty = await this.transactionsRepo.find({ where: [{ buyerId: user.id }, { sellerId: user.id }] });
    deletedTransactions += (await this.deleteUnpaidTransactions(asParty)).length;
    const kept = asParty.filter((t) => !!t.paidAt);
    for (const tx of kept) {
      // Trace comptable conservée ; données personnelles effacées : adresse de livraison de l'acheteur, code de remise
      const patch: Partial<Transaction> = { handoverCode: null as any };
      if (tx.buyerId === user.id) patch.shippingAddress = null;
      await this.transactionsRepo.update(tx.id, patch);
      // Étiquettes : adresses d'expédition remplacées par un libellé générique, référence et suivi conservés
      const shipments = await this.shipmentsRepo.find({ where: { transactionId: tx.id } });
      for (const s of shipments) {
        const blank = { ...s.recipient, name: DELETED_ACCOUNT_LABEL, line1: '', line2: undefined, phone: undefined, email: undefined } as Shipment['recipient'];
        await this.shipmentsRepo.update(s.id, tx.buyerId === user.id ? { recipient: blank } : { sender: { ...blank, ...(s.sender ? { postalCode: s.sender.postalCode, city: s.sender.city } : {}) } as Shipment['sender'] });
      }
    }

    await this.reviewsRepo.delete({ reviewedId: user.id });
    await this.favoritesRepo.delete({ userId: user.id });
    await this.viewsRepo.delete({ userId: user.id });
    await this.blocksRepo.delete({ blockerId: user.id });
    await this.blocksRepo.delete({ blockedId: user.id });
    await this.savedSearchesRepo.delete({ userId: user.id });
    await this.notificationsRepo.delete({ userId: user.id });
    await this.subscriptionsRepo.delete({ userId: user.id });
    await this.refreshTokensRepo.delete({ userId: user.id });
    await this.emailTokensRepo.delete({ userId: user.id });
    await this.resetTokensRepo.delete({ userId: user.id });
    await deleteUploadedFile(user.avatarUrl);
    await deleteUploadedFile(user.shopLogoUrl);
    await this.usersRepo.delete(user.id);
    this.logger.log(`Compte ${user.id} effacé (${listings.length} annonce(s), ${kept.length} vente(s) payée(s) conservée(s) sans données personnelles, ${deletedTransactions} transaction(s) non payée(s) effacée(s))`);
    return { listings: listings.length, keptTransactions: kept.length, deletedTransactions };
  }
}
