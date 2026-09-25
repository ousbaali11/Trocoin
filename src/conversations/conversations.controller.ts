import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { finalizePrivateConversationImages, imageDiskStorage, imageFileFilter, MAX_IMAGE_BYTES } from '../common/upload/image-upload';
import { IMAGE_COOKIE, IMAGE_COOKIE_TTL_S, issueImageCookie } from './image-access';
import { ConversationsService } from './conversations.service';
import { SendMessageDto } from './dto/send-message.dto';
import { StartConversationDto } from './dto/start-conversation.dto';

class OfferDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.5) @Max(10_000_000)
  amount: number;
}
class AnswerOfferDto {
  @IsIn(['acceptee', 'refusee', 'retiree'])
  decision: 'acceptee' | 'refusee' | 'retiree';
}
class BulkDeleteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID("4", { each: true })
  ids: string[];
}
class ImageCaptionDto {
  @IsOptional() @IsString() @MaxLength(500)
  caption?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private conversationsService: ConversationsService, private config: ConfigService) {}

  /** AUDIT §74 : cookie d'identité (HttpOnly, même site, 24 h) pour que les balises <img> des images privées soient authentifiées. */
  private imageCookie(res: Response, userId: string) {
    res.cookie(IMAGE_COOKIE, issueImageCookie(this.config.get<string>('JWT_SECRET') || '', userId), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: IMAGE_COOKIE_TTL_S * 1000, path: '/conversations' });
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  start(@Req() req: any, @Body() dto: StartConversationDto) {
    return this.conversationsService.startOrGet(req.user.userId, dto.listingId, dto.message);
  }

  @Get()
  listMine(@Req() req: any) {
    return this.conversationsService.listMine(req.user.userId);
  }

  @Get('unread-count')
  async unread(@Req() req: any) {
    return { unread: await this.conversationsService.unreadTotal(req.user.userId) };
  }

  /** Suppression de plusieurs conversations (masquage pour l'utilisateur, voir Conversation.hiddenForBuyerAt). */
  @Post('bulk-delete')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  async bulkDelete(@Req() req: any, @Body() dto: BulkDeleteDto) {
    return { deleted: await this.conversationsService.hideForUser(req.user.userId, dto.ids) };
  }

  @Get(':id')
  detail(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    this.imageCookie(res, req.user.userId);
    return this.conversationsService.getDetail(id, req.user.userId);
  }

  /** Suppression d'une conversation : masquée pour l'utilisateur seulement, l'autre participant garde l'historique. */
  @Delete(':id')
  @HttpCode(200)
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    // Un tiers obtient un refus explicite (audit §42) plutôt qu'un 200 sans effet ; un membre qui l'a déjà masquée obtient 0
    const deleted = await this.conversationsService.hideForUser(req.user.userId, [id]);
    if (deleted === 0) await this.conversationsService.assertParticipant(id, req.user.userId);
    return { deleted };
  }

  @Get(':id/messages')
  getMessages(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    this.imageCookie(res, req.user.userId);
    return this.conversationsService.getMessages(id, req.user.userId);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  postMessage(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.conversationsService.postMessage(id, req.user.userId, dto.content);
  }

  /** Photo dans la conversation : mêmes contrôles que les photos d'annonce (MIME + signature). */
  @Post(':id/images')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: imageDiskStorage, limits: { fileSize: MAX_IMAGE_BYTES, files: 1 }, fileFilter: imageFileFilter }))
  async postImage(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: { path: string; filename: string } | undefined, @Body() dto: ImageCaptionDto) {
    if (!file) throw new BadRequestException('Aucun fichier reçu (champ "file").');
    // Vérification d'appartenance AVANT de conserver le fichier
    try {
      await this.conversationsService.assertWritable(id, req.user.userId);
    } catch (err) {
      const { deleteUploadedFile } = await import('../common/upload/image-upload');
      await deleteUploadedFile(`/uploads/${file.filename}`);
      throw err;
    }
    const [key] = await finalizePrivateConversationImages([file]); // AUDIT §74 : espace privé, jamais /uploads
    return this.conversationsService.postImage(id, req.user.userId, key, dto.caption);
  }

  @Post(':id/offers')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  postOffer(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OfferDto) {
    return this.conversationsService.postOffer(id, req.user.userId, dto.amount);
  }

  @Post(':id/offers/:messageId')
  answerOffer(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: AnswerOfferDto) {
    return this.conversationsService.answerOffer(id, messageId, req.user.userId, dto.decision);
  }
}
