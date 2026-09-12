import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from '../categories/categories.module';
import { Conversation } from '../conversations/conversation.entity';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { Listing } from '../listings/listing.entity';
import { ListingsModule } from '../listings/listings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PagesModule } from '../pages/pages.module';
import { PaymentsModule } from '../payments/payments.module';
import { Transaction } from '../payments/transaction.entity';
import { Report } from '../reports/report.entity';
import { Review } from '../reviews/review.entity';
import { User } from '../users/user.entity';
import { AdminAuditLog } from './admin-audit-log.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Listing, ListingPhoto, Report, Transaction, Review, Conversation, AdminAuditLog]),
    ListingsModule,
    PaymentsModule,
    NotificationsModule,
    CategoriesModule,
    PagesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
