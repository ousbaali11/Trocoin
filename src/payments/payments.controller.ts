import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import {
  CreateTransactionDto,
  DisputeTransactionDto,
  HandoverDto,
  ShipTransactionDto,
} from './dto/create-transaction.dto';
import { PaymentsService } from './payments.service';

@Controller('transactions')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  /**
   * Webhook Stripe (déclaré avant les routes « :id »). Pas d'authentification utilisateur :
   * la signature du corps brut (STRIPE_WEBHOOK_SECRET) fait foi ; 400 si elle est absente ou fausse.
   */
  @Post('webhook/stripe')
  @SkipThrottle()
  @HttpCode(200)
  stripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.paymentsService.handleWebhook(req.rawBody, signature);
  }

  /** Devis public (frais affichés avant d'acheter, même sans compte). */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('quote')
  quote(@Req() req: any, @Query('listingId', ParseUUIDPipe) listingId: string) {
    return this.paymentsService.quote(listingId, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  create(@Req() req: any, @Body() dto: CreateTransactionDto) {
    return this.paymentsService.createTransaction(req.user.userId, dto.listingId, dto.deliveryMethod, dto.shippingAddress, dto.expectedTotal, dto.deliveryMode, dto.pickupPoint);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  listMine(@Req() req: any) {
    return this.paymentsService.listMine(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getOne(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getOne(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/ship')
  ship(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipTransactionDto) {
    return this.paymentsService.markShipped(id, req.user.userId, dto.trackingNumber).then((tx) => this.paymentsService.viewFor(tx, req.user.userId));
  }

  /** Le vendeur confirme que l'article est disponible et prêt à partir (bouton de la conversation et de la page de la vente). */
  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-availability')
  @HttpCode(200)
  confirmAvailability(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.confirmAvailability(id, req.user.userId).then((tx) => this.paymentsService.viewFor(tx, req.user.userId));
  }

  /** L'acheteur renonce à un paiement non finalisé : la page de paiement est fermée, l'annonce redevient achetable. */
  @UseGuards(JwtAuthGuard)
  @Post(':id/abandon')
  @HttpCode(200)
  abandon(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.abandonPending(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-delivery')
  confirmDelivery(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.confirmDelivery(id, req.user.userId).then((tx) => this.paymentsService.viewFor(tx, req.user.userId));
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/handover')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  handover(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HandoverDto) {
    return this.paymentsService.confirmHandover(id, req.user.userId, dto.code).then((tx) => this.paymentsService.viewFor(tx, req.user.userId));
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/cancel')
  cancel(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.cancel(id, req.user.userId).then((tx) => this.paymentsService.viewFor(tx, req.user.userId));
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/dispute')
  dispute(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeTransactionDto) {
    return this.paymentsService.openDispute(id, req.user.userId, dto.reason).then((tx) => this.paymentsService.viewFor(tx, req.user.userId));
  }
}
