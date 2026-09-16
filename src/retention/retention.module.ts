import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailVerificationToken } from '../auth/email-verification-token.entity';
import { PasswordResetToken } from '../auth/password-reset-token.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
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
import { RetentionService } from './retention.service';

/** Règles de conservation et suppression réelle des données (AUDIT §41) : un seul endroit, partagé par les membres et l'admin. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, UserBlock, Listing, ListingPhoto, ListingView, Favorite, Transaction, Shipment, Review, Notification, SavedSearch, Subscription,
      RefreshToken, EmailVerificationToken, PasswordResetToken,
    ]),
  ],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
