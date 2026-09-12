import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Listing } from '../listings/listing.entity';
import { ListingsService } from '../listings/listings.service';
import { Favorite } from './favorite.entity';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite) private favoritesRepo: Repository<Favorite>,
    @InjectRepository(Listing) private listingsRepo: Repository<Listing>,
    private listingsService: ListingsService,
  ) {}

  async add(userId: string, listingId: string): Promise<{ favorited: true }> {
    const listing = await this.listingsRepo.findOne({ where: { id: listingId } });
    if (!listing || !['en_ligne', 'vendue', 'expiree'].includes(listing.status)) {
      throw new NotFoundException('Annonce introuvable.');
    }
    const existing = await this.favoritesRepo.findOne({ where: { userId, listingId } });
    if (!existing) {
      await this.favoritesRepo.save(this.favoritesRepo.create({ userId, listingId }));
    }
    return { favorited: true };
  }

  async remove(userId: string, listingId: string): Promise<{ favorited: false }> {
    await this.favoritesRepo.delete({ userId, listingId });
    return { favorited: false };
  }

  async listMine(userId: string) {
    const favorites = await this.favoritesRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    if (favorites.length === 0) return [];
    const listings = await this.listingsRepo.findBy({ id: In(favorites.map((f) => f.listingId)) });
    const order = new Map(favorites.map((f, i) => [f.listingId, i]));
    listings.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return this.listingsService.toCards(listings);
  }

  /** IDs des annonces favorites (pour afficher l'état du cœur dans les listes). */
  async listMineIds(userId: string): Promise<string[]> {
    const favorites = await this.favoritesRepo.find({ where: { userId } });
    return favorites.map((f) => f.listingId);
  }
}
