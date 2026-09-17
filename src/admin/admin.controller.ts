import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';
import {
  AdminPageDto,
  AdminPlanDto,
  AdminSettingsDto,
  AdminAuditQueryDto,
  AdminListingsQueryDto,
  AdminReportsQueryDto,
  AdminResolveReportDto,
  AdminResolveTransactionDto,
  AdminHardDeleteDto,
  AdminReasonDto,
  AdminTransactionsQueryDto,
  AdminUpdateListingDto,
  AdminUpdateUserDto,
  AdminUsersQueryDto,
} from './dto/admin.dto';

/**
 * Back-office. TOUTES les routes exigent un JWT valide ET accountType='admin'
 * relu en base à chaque requête (JwtStrategy). Chaque écriture est
 * journalisée dans admin_audit_log.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  private ctx(req: any) {
    return { adminId: req.user.userId as string, ip: req.ip as string };
  }

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  // Users
  @Get('users')
  users(@Query() query: AdminUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getUser(id);
  }

  @Patch('users/:id')
  updateUser(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateUserDto) {
    return this.admin.updateUser(this.ctx(req), id, dto);
  }

  /** Mot de passe temporaire pour un utilisateur bloqué (affiché une fois, sessions révoquées, journalisé). */
  @Post('users/:id/reset-password')
  @HttpCode(200)
  resetUserPassword(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetUserPassword(this.ctx(req), id);
  }

  // Listings
  @Get('listings')
  listings(@Query() query: AdminListingsQueryDto) {
    return this.admin.listListings(query);
  }

  @Get('listings/:id')
  listing(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getListing(id);
  }

  @Patch('listings/:id')
  updateListing(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateListingDto) {
    return this.admin.updateListing(this.ctx(req), id, dto);
  }

  /** Retrait d'une photo par l'admin, y compris une photo verrouillée pour le vendeur (AUDIT §54) : motif obligatoire, journalisé. */
  @Delete('listings/:id/photos/:photoId')
  deleteListingPhoto(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Body() dto: AdminReasonDto) {
    return this.admin.deleteListingPhoto(this.ctx(req), id, photoId, dto.reason);
  }

  /** Suppression définitive d'une annonce : motif + confirmation explicite (corps), journalisée. */
  @Delete('listings/:id')
  deleteListing(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminHardDeleteDto) {
    return this.admin.deleteListing(this.ctx(req), id, dto.reason);
  }

  /** Suppression définitive d'un compte (particulier ou professionnel) : motif + confirmation explicite, journalisée. */
  @Delete('users/:id')
  deleteUser(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminHardDeleteDto) {
    return this.admin.deleteUser(this.ctx(req), id, dto.reason);
  }

  // Reports
  @Get('reports')
  reports(@Query() query: AdminReportsQueryDto) {
    return this.admin.listReports(query);
  }

  @Patch('reports/:id')
  resolveReport(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminResolveReportDto) {
    return this.admin.resolveReport(this.ctx(req), id, dto);
  }

  // Transactions
  @Get('transactions')
  transactions(@Query() query: AdminTransactionsQueryDto) {
    return this.admin.listTransactions(query);
  }

  /** Fiche détaillée : parties, annonce, adresse de livraison, expédition, échéances, journal d'audit lié. */
  @Get('transactions/:id')
  transaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getTransaction(id);
  }

  /** Décision admin sur une transaction en séquestre, expédiée ou en litige (fraude, conflit) : rembourser, libérer, annuler. */
  @Post('transactions/:id/resolve')
  resolveTransaction(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminResolveTransactionDto) {
    return this.admin.resolveTransaction(this.ctx(req), id, dto);
  }

  // Réglages système (monétisation) et formules
  @Get('settings')
  settings() {
    return this.admin.getSettings();
  }

  @Patch('settings')
  updateSettings(@Req() req: any, @Body() dto: AdminSettingsDto) {
    return this.admin.updateSettings(this.ctx(req), dto);
  }

  @Get('plans')
  plans() {
    return this.admin.listPlans();
  }

  @Post('plans')
  createPlan(@Req() req: any, @Body() dto: AdminPlanDto) {
    return this.admin.upsertPlan(this.ctx(req), dto);
  }

  @Patch('plans/:id')
  updatePlan(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminPlanDto) {
    return this.admin.upsertPlan(this.ctx(req), dto, id);
  }

  // CMS pages légales
  @Get('pages')
  pages() {
    return this.admin.listPages();
  }

  @Get('pages/:slug')
  page(@Param('slug') slug: string) {
    return this.admin.getPage(slug);
  }

  @Patch('pages/:slug')
  updatePage(@Req() req: any, @Param('slug') slug: string, @Body() dto: AdminPageDto) {
    return this.admin.updatePage(this.ctx(req), slug, dto);
  }

  // Audit
  @Get('audit-log')
  auditLog(@Query() query: AdminAuditQueryDto) {
    return this.admin.auditLog(query);
  }
}
