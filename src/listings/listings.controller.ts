import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { finalizeUploadedImagesWithThumbs, imageDiskStorage, imageFileFilter, MAX_IMAGE_BYTES } from '../common/upload/image-upload';
import { CreateListingDto } from './dto/create-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ReorderPhotosDto, UpdateListingDto } from './dto/update-listing.dto';
import { ListingOwnerGuard } from './listing-owner.guard';
import { ListingsService, MAX_FILES_PER_UPLOAD } from './listings.service';

class PromoteDto {
  @IsIn(['boost', 'urgent'])
  type: 'boost' | 'urgent';
}
class BulkDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID("4", { each: true })
  ids: string[];

  @IsIn(["pause", "republish", "renew"])
  action: "pause" | "republish" | "renew";
}
class ImportDto {
  @IsOptional() @IsUUID()
  onBehalfOf?: string;
}

@Controller('listings')
export class ListingsController {
  constructor(private listingsService: ListingsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  create(@Req() req: any, @Body() dto: CreateListingDto) {
    return this.listingsService.create(req.user.userId, dto);
  }

  /** Filtres spécifiques (attr.*) : clés et valeurs bornées, 10 au plus. */
  private withAttrFilters(query: SearchListingsDto, req: any): SearchListingsDto & Record<string, any> {
    const attrFilters: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query || {})) {
      if (k.startsWith('attr.') && /^attr\.[a-z0-9_]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 100) {
        attrFilters[k] = v;
        if (Object.keys(attrFilters).length >= 10) break;
      }
    }
    return { ...query, ...attrFilters };
  }

  @Get()
  search(@Query() query: SearchListingsDto, @Req() req: any) {
    return this.listingsService.search(this.withAttrFilters(query, req));
  }

  /** Compteurs par type de vendeur pour le panneau « Tous les filtres » (mêmes paramètres que la recherche). */
  @Get('facets')
  facets(@Query() query: SearchListingsDto, @Req() req: any) {
    return this.listingsService.sellerTypeFacets(this.withAttrFilters(query, req));
  }

  /** Bas de page d'une catégorie : fil d'Ariane, recherches suggérées, localisations les plus demandées. */
  @Get('discover')
  discover(@Query('category') category?: string) {
    return this.listingsService.discover((category || '').slice(0, 60));
  }

  @Get('suggest')
  suggest(@Query('q') q?: string) {
    return this.listingsService.suggest((q || '').slice(0, 60));
  }

  /** Prix moyen constaté pour aider à fixer le prix au dépôt (public, sans données personnelles). */
  @Get('price-estimate')
  priceEstimate(@Query('category') category?: string, @Query('q') q?: string) {
    return this.listingsService.priceEstimate((category || '').slice(0, 60), (q || '').slice(0, 150));
  }

  /** Actions groupées sur ses annonces : mettre en pause, remettre en ligne, renouveler (100 max). */
  @UseGuards(JwtAuthGuard)
  @Post('bulk')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  bulk(@Req() req: any, @Body() dto: BulkDto) {
    return this.listingsService.bulkOwn(req.user.userId, dto.ids, dto.action);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  findMine(@Req() req: any) {
    return this.listingsService.findMine(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine/stats')
  myStats(@Req() req: any) {
    return this.listingsService.sellerStats(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('history/ids')
  historyIds(@Req() req: any) {
    return this.listingsService.historyIds(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('history')
  history(@Req() req: any) {
    return this.listingsService.history(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('history')
  clearHistory(@Req() req: any) {
    return this.listingsService.clearHistory(req.user.userId);
  }

  /** Import de catalogue CSV/XML (comptes professionnels). Fichier en mémoire, 2 Mo max. */
  @UseGuards(JwtAuthGuard)
  @Post('import')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  importCatalog(@Req() req: any, @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined, @Body() dto: ImportDto) {
    if (!file) throw new BadRequestException('Aucun fichier reçu (champ "file").');
    return this.listingsService.importCatalog(req.user.userId, file.originalname, file.buffer.toString('utf8'), dto.onBehalfOf);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  findOne(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.findOne(id, req.user);
  }

  /** Fiche affichée dans un navigateur : compte une vue (hors propriétaire) et, pour un membre, alimente « Annonces consultées ». */
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/view')
  @HttpCode(200)
  view(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.recordView(id, req.user?.userId);
  }

  /** « Voir le numéro » : membre connecté seulement ; compte le clic pour le vendeur. Limité (anti-collecte de numéros, audit §42). */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Post(':id/phone')
  @HttpCode(200)
  revealPhone(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.revealPhone(id, req.user.userId);
  }

  @Get(':id/similar')
  similar(@Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.findSimilar(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateListingDto) {
    return this.listingsService.updateOwn(id, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/renew')
  renew(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.renewOwn(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/duplicate')
  duplicate(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.duplicateOwn(id, req.user.userId);
  }

  /** Mise en avant : boost (tête de liste) ou urgent (macaron). Gratuit si monétisation désactivée. */
  @UseGuards(JwtAuthGuard)
  @Post(':id/promote')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  promote(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PromoteDto) {
    return this.listingsService.promote(id, req.user.userId, dto.type);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    await this.listingsService.deleteOwn(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, ListingOwnerGuard)
  @Post(':id/photos')
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD, {
      storage: imageDiskStorage,
      limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_FILES_PER_UPLOAD },
      fileFilter: imageFileFilter,
    }),
  )
  async uploadPhotos(@Req() req: any, @Param('id', ParseUUIDPipe) listingId: string, @UploadedFiles() files: Array<{ path: string; filename: string }>) {
    if (!files || files.length === 0) throw new BadRequestException('Aucun fichier reçu (champ "files").');
    const stored = await finalizeUploadedImagesWithThumbs(files);
    return this.listingsService.addPhotos(listingId, req.user.userId, stored);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/photos/order')
  reorderPhotos(@Req() req: any, @Param('id', ParseUUIDPipe) listingId: string, @Body() dto: ReorderPhotosDto) {
    return this.listingsService.reorderPhotos(listingId, req.user.userId, dto.photoIds);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  async removePhoto(@Req() req: any, @Param('id', ParseUUIDPipe) listingId: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    await this.listingsService.removePhoto(listingId, req.user.userId, photoId);
  }
}
