import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
    return this.paymentsService.createTransaction(req.user.userId, dto.listingId, dto.deliveryMethod);
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
    return this.paymentsService.markShipped(id, req.user.userId, dto.trackingNumber);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-delivery')
  confirmDelivery(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.confirmDelivery(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/handover')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  handover(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HandoverDto) {
    return this.paymentsService.confirmHandover(id, req.user.userId, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/cancel')
  cancel(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.cancel(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/dispute')
  dispute(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeTransactionDto) {
    return this.paymentsService.openDispute(id, req.user.userId, dto.reason);
  }
}
