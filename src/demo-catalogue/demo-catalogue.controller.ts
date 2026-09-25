import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Repository } from 'typeorm';
import { AdminAuditLog } from '../admin/admin-audit-log.entity';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DemoCatalogueService } from './demo-catalogue.service';

class RunDemoCatalogueDto {
  @IsOptional() @IsInt() @Min(1) @Max(1000)
  limit?: number;

  @IsOptional() @IsBoolean()
  photos?: boolean;

  /** Passe outre la couverture minimale en photos (répétition locale seulement). */
  @IsOptional() @IsBoolean()
  force?: boolean;
}
class DemoReplyDto {
  @IsString() @MinLength(1) @MaxLength(2000)
  content: string;
}

/** Console d'administration — catalogue de démonstration (AUDIT §71) : ensemencement côté serveur et suivi des conversations. */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/demo-catalogue')
export class DemoCatalogueController {
  constructor(
    private demo: DemoCatalogueService,
    @InjectRepository(AdminAuditLog) private auditRepo: Repository<AdminAuditLog>,
  ) {}

  private async audit(req: any, action: string, targetId: string, details?: Record<string, unknown>) {
    await this.auditRepo.save(this.auditRepo.create({ adminId: req.user.userId, action, targetType: 'demo-catalogue', targetId, details: details ?? undefined, ip: req.ip }));
  }

  @Get()
  summary() {
    return this.demo.summary();
  }

  /** Lance (ou reprend) l'ensemencement en arrière-plan ; le résultat se lit sur GET. */
  @Post('run')
  @Throttle({ default: { limit: 10, ttl: 600_000 } }) // AUDIT §73 : écritures d'administration bornées
  @HttpCode(202)
  async run(@Req() req: any, @Body() dto: RunDemoCatalogueDto) {
    const state = this.demo.start({ limit: dto.limit, photos: dto.photos, force: dto.force });
    await this.audit(req, 'demo_catalogue.run', 'run', { limit: dto.limit ?? null, photos: dto.photos ?? true, force: dto.force ?? false });
    return state;
  }

  /** Identifiants des comptes créés par la dernière exécution : remis une seule fois (effacés de la mémoire après lecture). */
  @Post('credentials')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @HttpCode(200)
  async credentials(@Req() req: any) {
    const items = this.demo.takeCredentials();
    await this.audit(req, 'demo_catalogue.credentials', 'credentials', { count: items.length });
    return { items };
  }

  /** AUDIT §73 : identifiants perdus (API endormie avant la lecture) → nouveaux mots de passe pour tous les comptes démo, remis une fois. */
  @Post('credentials/regenerate')
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @HttpCode(200)
  async regenerateCredentials(@Req() req: any) {
    const items = await this.demo.regenerateCredentials();
    await this.audit(req, 'demo_catalogue.credentials_regenerate', 'credentials', { count: items.length });
    return { items };
  }

  @Get('conversations')
  conversations() {
    return this.demo.listConversations();
  }

  @Get('conversations/:id')
  messages(@Param('id', ParseUUIDPipe) id: string) {
    return this.demo.conversationMessages(id);
  }

  @Post('conversations/:id/reply')
  async reply(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DemoReplyDto) {
    const message = await this.demo.replyAsDemoSeller(id, dto.content);
    await this.audit(req, 'demo_catalogue.reply', id, { messageId: message.id });
    return message;
  }
}
