import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../conversations/conversation.entity';
import { Message } from '../conversations/message.entity';
import { Favorite } from '../favorites/favorite.entity';
import { Listing } from '../listings/listing.entity';
import { Transaction } from '../payments/transaction.entity';
import { RetentionModule } from '../retention/retention.module';
import { Review } from '../reviews/review.entity';
import { StripeConnectService } from './stripe-connect.service';
import { UserBlock } from './user-block.entity';
import { User } from './user.entity';
import { UsersController } from './users.controller';
import { SiretVerificationService } from './siret-verification.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersService } from './users.service';

@Module({
  imports: [
    RetentionModule,
    NotificationsModule,
    TypeOrmModule.forFeature([User, UserBlock, Listing, Conversation, Message, Review, Transaction, Favorite]),
  ],
  controllers: [UsersController],
  providers: [UsersService, SiretVerificationService, StripeConnectService],
  exports: [UsersService, StripeConnectService, SiretVerificationService],
})
export class UsersModule {}
