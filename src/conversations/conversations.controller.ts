import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { finalizeUploadedImages, imageDiskStorage, imageFileFilter, MAX_IMAGE_BYTES } from '../common/upload/image-upload';
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
class ImageCaptionDto {
  @IsOptional() @IsString() @MaxLength(500)
  caption?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private conversationsService: ConversationsService) {}

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

  @Get(':id')
  detail(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversationsService.getDetail(id, req.user.userId);
  }

  @Get(':id/messages')
  getMessages(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
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
      await this.conversationsService.assertMember(id, req.user.userId);
    } catch (err) {
      const { deleteUploadedFile } = await import('../common/upload/image-upload');
      await deleteUploadedFile(`/uploads/${file.filename}`);
      throw err;
    }
    const [url] = await finalizeUploadedImages([file]);
    return this.conversationsService.postImage(id, req.user.userId, url, dto.caption);
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
