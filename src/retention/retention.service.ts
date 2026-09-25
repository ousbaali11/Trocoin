import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, LessThan, Not, Repository } from 'typeorm';
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
import { ShopMember } from '../shops/shop-member.entity';
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
    @InjectDataSource() private dataSource: DataSource,
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
  private async deleteUnpaidTransactions(transactions: Transaction[], m?: EntityManager): Promise<string[]> {
    const ids = transactions.filter((t) => !t.paidAt).map((t) => t.id);
    if (ids.length === 0) return [];
    await (m ? m.getRepository(Shipment) : this.shipmentsRepo).delete({ transactionId: In(ids) });
    await (m ? m.getRepository(Transaction) : this.transactionsRepo).delete({ id: In(ids) });
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
    // AUDIT §69 : une seule transaction SQL (un redémarrage au milieu laissait des favoris effacés et une annonce encore en ligne)
    await this.dataSource.transaction(async (m) => {
      const txRepo = m.getRepository(Transaction);
      const transactions = await txRepo.find({ where: { listingId: listing.id } });
      for (const tx of transactions) if (tx.paidAt && !tx.listingTitle) await txRepo.update(tx.id, { listingTitle: listing.title });
      await this.deleteUnpaidTransactions(transactions, m);
      await m.getRepository(Favorite).delete({ listingId: listing.id });
      await m.getRepository(ListingView).delete({ listingId: listing.id });
      await m.getRepository(Listing).update(listing.id, { status: 'archivee', archivedAt: new Date() });
    });
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

  /**
   * Effacement d'une annonce. AUDIT §69 : toutes les lignes partent dans une seule transaction SQL ; les fichiers ne sont
   * effacés qu'après validation (sans `manager`, la méthode ouvre sa propre transaction ; avec, elle s'inscrit dans celle de
   * l'appelant, qui efface alors les fichiers renvoyés une fois sa transaction validée).
   */
  async purgeListing(listing: Listing, manager?: EntityManager): Promise<{ keptTransactions: number; deletedTransactions: number; files: Array<string | null | undefined> }> {
    const run = async (m: EntityManager) => {
      const txRepo = m.getRepository(Transaction);
      const transactions = await txRepo.find({ where: { listingId: listing.id } });
      const paid = transactions.filter((t) => !!t.paidAt);
      for (const tx of paid) if (!tx.listingTitle) await txRepo.update(tx.id, { listingTitle: listing.title });
      const deleted = await this.deleteUnpaidTransactions(transactions, m);
      const photos = await m.getRepository(ListingPhoto).find({ where: { listingId: listing.id } });
      await m.getRepository(ListingPhoto).delete({ listingId: listing.id });
      await m.getRepository(Favorite).delete({ listingId: listing.id });
      await m.getRepository(ListingView).delete({ listingId: listing.id });
      await m.getRepository(Listing).delete(listing.id);
      return { keptTransactions: paid.length, deletedTransactions: deleted.length, files: photos.flatMap((p) => [p.url, p.thumbUrl]) };
    };
    const result = manager ? await run(manager) : await this.dataSource.transaction(run);
    if (!manager) await Promise.all(result.files.map((u) => deleteUploadedFile(u)));
    this.logger.log(`Annonce ${listing.id} effacée (${result.keptTransactions} vente(s) payée(s) conservée(s), ${result.deletedTransactions} transaction(s) non payée(s) effacée(s))`);
    return result;
  }

  /**
   * Compte : annonces effacées (règle ci-dessus), transactions payées conservées sans données personnelles,
   * transactions non payées effacées, avis reçus effacés, données propres au compte effacées, fichiers
   * effacés, puis la ligne utilisateur elle-même. Les identifiants redeviennent utilisables.
   * AUDIT §69 : le tout dans une seule transaction SQL — un redémarrage au milieu laissait un compte à moitié effacé.
   */
  async purgeUser(user: User): Promise<{ listings: number; keptTransactions: number; deletedTransactions: number }> {
    const listings = await this.listingsRepo.find({ where: { userId: user.id } });
    const files: Array<string | null | undefined> = [user.avatarUrl, user.shopLogoUrl];
    const out = await this.dataSource.transaction(async (m) => {
      let deletedTransactions = 0;
      for (const l of listings) {
        const r = await this.purgeListing(l, m);
        deletedTransactions += r.deletedTransactions;
        files.push(...r.files);
      }
      const txRepo = m.getRepository(Transaction);
      const shipmentsRepo = m.getRepository(Shipment);
      const asParty = await txRepo.find({ where: [{ buyerId: user.id }, { sellerId: user.id }] });
      deletedTransactions += (await this.deleteUnpaidTransactions(asParty, m)).length;
      const kept = asParty.filter((t) => !!t.paidAt);
      for (const tx of kept) {
        // Trace comptable conservée ; données personnelles effacées : adresse de livraison de l'acheteur, code de remise
        const patch: Partial<Transaction> = { handoverCode: null as any };
        if (tx.buyerId === user.id) patch.shippingAddress = null;
        await txRepo.update(tx.id, patch);
        // Étiquettes : adresses d'expédition remplacées par un libellé générique, référence et suivi conservés
        const shipments = await shipmentsRepo.find({ where: { transactionId: tx.id } });
        for (const s of shipments) {
          const blank = { ...s.recipient, name: DELETED_ACCOUNT_LABEL, line1: '', line2: undefined, phone: undefined, email: undefined } as Shipment['recipient'];
          await shipmentsRepo.update(s.id, tx.buyerId === user.id ? { recipient: blank } : { sender: { ...blank, ...(s.sender ? { postalCode: s.sender.postalCode, city: s.sender.city } : {}) } as Shipment['sender'] });
        }
      }
      await m.getRepository(Review).delete({ reviewedId: user.id });
      await m.getRepository(Favorite).delete({ userId: user.id });
      await m.getRepository(ListingView).delete({ userId: user.id });
      await m.getRepository(UserBlock).delete({ blockerId: user.id });
      await m.getRepository(UserBlock).delete({ blockedId: user.id });
      await m.getRepository(ShopMember).delete({ ownerId: user.id }); // AUDIT §73 : plus de membres d'une boutique effacée, ni d'appartenance fantôme
      await m.getRepository(ShopMember).delete({ memberId: user.id });
      await m.getRepository(SavedSearch).delete({ userId: user.id });
      await m.getRepository(Notification).delete({ userId: user.id });
      await m.getRepository(Subscription).delete({ userId: user.id });
      await m.getRepository(RefreshToken).delete({ userId: user.id });
      await m.getRepository(EmailVerificationToken).delete({ userId: user.id });
      await m.getRepository(PasswordResetToken).delete({ userId: user.id });
      await m.getRepository(User).delete(user.id);
      return { keptTransactions: kept.length, deletedTransactions };
    });
    await Promise.all(files.map((u) => deleteUploadedFile(u)));
    this.logger.log(`Compte ${user.id} effacé (${listings.length} annonce(s), ${out.keptTransactions} vente(s) payée(s) conservée(s) sans données personnelles, ${out.deletedTransactions} transaction(s) non payée(s) effacée(s))`);
    return { listings: listings.length, ...out };
  }
}
