import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  finalizeUploadedImages,
  imageDiskStorage,
  imageFileFilter,
  MAX_IMAGE_BYTES,
} from '../common/upload/image-upload';
import { BecomeProDto, UpdateProfileDto } from './dto/update-profile.dto';
import { PayoutAccountDto } from './dto/payout-account.dto';
import { StripeConnectService } from './stripe-connect.service';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';

const singleImageUpload = () =>
  FileInterceptor('file', {
    storage: imageDiskStorage,
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: imageFileFilter,
  });

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private stripeConnect: StripeConnectService,
    private auth: AuthService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const user = await this.usersService.findById(req.user.userId);
    return this.sanitizeSelf(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const user = await this.usersService.updateProfile(req.user.userId, dto);
    return this.sanitizeSelf(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @UseInterceptors(singleImageUpload())
  async uploadAvatar(@Req() req: any, @UploadedFile() file?: { path: string; filename: string }) {
    if (!file) throw new BadRequestException('Aucun fichier reçu (champ "file").');
    const [url] = await finalizeUploadedImages([file]);
    return this.sanitizeSelf(await this.usersService.setAvatar(req.user.userId, url));
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/shop-logo')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @UseInterceptors(singleImageUpload())
  async uploadShopLogo(@Req() req: any, @UploadedFile() file?: { path: string; filename: string }) {
    if (!file) throw new BadRequestException('Aucun fichier reçu (champ "file").');
    const [url] = await finalizeUploadedImages([file]);
    return this.sanitizeSelf(await this.usersService.setShopLogo(req.user.userId, url));
  }

  /** Retour au compte particulier (AUDIT §68) : réversible depuis Paramètres, données d'entreprise effacées. */
  @UseGuards(JwtAuthGuard)
  @Post('me/become-individual')
  async becomeIndividual(@Req() req: any) {
    return this.sanitizeSelf(await this.usersService.becomeIndividual(req.user.userId));
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/become-pro')
  async becomePro(@Req() req: any, @Body() dto: BecomeProDto) {
    const user = await this.usersService.becomePro(req.user.userId, dto.siret, dto.shopName);
    return this.sanitizeSelf(user);
  }

  /** Crée (ou réutilise) le compte Stripe Connect Express et renvoie le lien d'onboarding. */
  @UseGuards(JwtAuthGuard)
  @Post('me/stripe-onboarding-link')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  stripeOnboardingLink(@Req() req: any) {
    return this.stripeConnect.createOnboardingLink(req.user.userId);
  }

  /** Compte de versement en un formulaire (AUDIT §63) : nom, date de naissance, adresse, IBAN — sans quitter Trocoin. */
  @UseGuards(JwtAuthGuard)
  @Post('me/payout-account')
  @Throttle({ default: { limit: 6, ttl: 600_000 } })
  payoutAccount(@Req() req: any, @Body() dto: PayoutAccountDto) {
    return this.stripeConnect.setupPayoutAccount(req.user.userId, dto, req.ip);
  }

  /** Rafraîchit l'état d'onboarding depuis Stripe (à appeler au retour du lien). */
  @UseGuards(JwtAuthGuard)
  @Get('me/stripe-status')
  stripeStatus(@Req() req: any) {
    return this.stripeConnect.refreshStatus(req.user.userId);
  }

  // ----- Blocage -----
  @UseGuards(JwtAuthGuard)
  @Get('me/blocks')
  listBlocks(@Req() req: any) {
    return this.usersService.listBlocked(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/blocks/:id')
  block(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.block(req.user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/blocks/:id')
  unblock(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.unblock(req.user.userId, id);
  }

  // ----- RGPD -----
  @UseGuards(JwtAuthGuard)
  @Get('me/export')
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  exportData(@Req() req: any) {
    return this.usersService.exportData(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me')
  @HttpCode(204)
  async deleteMe(@Req() req: any) {
    await this.stripeConnect.closeAccount(req.user.userId).catch(() => undefined);
    await this.usersService.deleteAccount(req.user.userId);
    await this.auth.revokeAllSessions(req.user.userId);
  }

  // Vitrine / profil public — pas de garde JWT, mais aucune donnée
  // sensible (téléphone, e-mail, SIRET) n'est jamais renvoyée.
  @Get(':id/profile')
  async publicProfile(@Param('id', ParseUUIDPipe) id: string) {
    const profile = await this.usersService.findPublicProfile(id);
    if (!profile) throw new NotFoundException('Utilisateur introuvable.');
    return profile;
  }

  /** Données visibles par l'utilisateur sur lui-même (jamais le SIRET masqué ni les IDs Stripe internes). */
  private sanitizeSelf(user: User | null) {
    if (!user) return user;
    const { stripeAccountId, notificationPrefs, recentLocations, ...safe } = user;
    void notificationPrefs;
    let recent: unknown[] = [];
    try {
      recent = recentLocations ? JSON.parse(recentLocations) : [];
    } catch {
      recent = [];
    }
    // AUDIT §66 : état persisté du compte de versement (sans appel au prestataire) et date du dernier webhook « comptes connectés » reçu
    return { ...safe, stripeConnected: !!stripeAccountId, payout: { complete: !!user.stripeOnboardingComplete, kind: user.payoutAccountKind ?? null, ibanLast4: user.payoutIbanLast4 ?? null, webhookAt: user.payoutWebhookAt ?? null }, notificationPrefs: UsersService.prefsOf(user), recentLocations: recent };
  }
}
