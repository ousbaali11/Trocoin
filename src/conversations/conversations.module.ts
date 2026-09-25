import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { Listing } from '../listings/listing.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { Conversation } from './conversation.entity';
import { ConversationImagesController } from './conversation-images.controller';
import { ConversationsController } from './conversations.controller';
import { ConversationsGateway } from './conversations.gateway';
import { ConversationsService } from './conversations.service';
import { Message } from './message.entity';
import { Shipment } from '../shipping/shipment.entity';
import { Transaction } from '../payments/transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message, Listing, ListingPhoto, Transaction, Shipment]),
    UsersModule,
    NotificationsModule,
  ],
  controllers: [ConversationsController, ConversationImagesController],
  providers: [ConversationsService, ConversationsGateway],
  exports: [ConversationsService, ConversationsGateway],
})
export class ConversationsModule {}
