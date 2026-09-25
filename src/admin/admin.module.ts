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
import { ConversationsModule } from '../conversations/conversations.module';
import { Transaction } from '../payments/transaction.entity';
import { Report } from '../reports/report.entity';
import { Review } from '../reviews/review.entity';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { AdminAuditLog } from './admin-audit-log.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Listing, ListingPhoto, Report, Transaction, Review, Conversation, AdminAuditLog]),
    ListingsModule,
    PaymentsModule,
    ConversationsModule, // AUDIT §73 : fermeture des sockets d'un compte suspendu
    NotificationsModule,
    CategoriesModule,
    PagesModule,
    UsersModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
