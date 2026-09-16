import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from '../categories/categories.module';
import { Conversation } from '../conversations/conversation.entity';
import { Favorite } from '../favorites/favorite.entity';
import { Transaction } from '../payments/transaction.entity';
import { ShopsModule } from '../shops/shops.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { ListingOwnerGuard } from './listing-owner.guard';
import { ListingPhoto } from './listing-photo.entity';
import { ListingView } from './listing-view.entity';
import { Listing } from './listing.entity';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Listing, ListingPhoto, ListingView, Favorite, Transaction, User, Conversation]),
    CategoriesModule,
    UsersModule,
    ShopsModule,
  ],
  controllers: [ListingsController],
  providers: [ListingsService, ListingOwnerGuard],
  exports: [ListingsService],
})
export class ListingsModule {}
