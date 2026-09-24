import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLog } from '../admin/admin-audit-log.entity';
import { Conversation } from '../conversations/conversation.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { Message } from '../conversations/message.entity';
import { ListingPhoto } from '../listings/listing-photo.entity';
import { Listing } from '../listings/listing.entity';
import { ListingsModule } from '../listings/listings.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { DemoCatalogueController } from './demo-catalogue.controller';
import { DemoCatalogueService } from './demo-catalogue.service';

/** Catalogue de démonstration (AUDIT §71). */
@Module({
  imports: [TypeOrmModule.forFeature([User, Listing, ListingPhoto, Conversation, Message, AdminAuditLog]), UsersModule, ListingsModule, ConversationsModule],
  controllers: [DemoCatalogueController],
  providers: [DemoCatalogueService],
  exports: [DemoCatalogueService],
})
export class DemoCatalogueModule {}
