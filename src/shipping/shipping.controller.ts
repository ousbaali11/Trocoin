import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateShipmentDto, QuoteShipmentDto } from './dto/shipment.dto';
import { ShippingService } from './shipping.service';

/**
 * Expédition d'une vente (fonds bloqués, envoi par transporteur) :
 *   POST /transactions/:id/shipment/quote        vendeur : tarifs pour le colis déclaré
 *   GET  /transactions/:id/shipment/relay-points  vendeur : points relais autour d'un code postal
 *   POST /transactions/:id/shipment               vendeur : achat de l'étiquette (numéro de suivi)
 *   GET  /transactions/:id/shipment               vendeur et acheteur : état, suivi, prix
 *   GET  /transactions/:id/shipment/label.pdf     vendeur : l'étiquette à imprimer
 *   GET  /transactions/:id/shipment/tracking      vendeur et acheteur : suivi du colis
 */
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Post(':id/shipment/quote')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 600_000 } })
  quote(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteShipmentDto) {
    return this.shipping.quote(id, req.user.userId, dto);
  }

  @Get(':id/shipment/relay-points')
  relayPoints(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query('postalCode') postalCode?: string) {
    return this.shipping.relayPoints(id, req.user.userId, (postalCode || '').trim());
  }

  @Post(':id/shipment')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  create(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateShipmentDto) {
    return this.shipping.createLabel(id, req.user.userId, dto);
  }

  @Get(':id/shipment')
  get(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.shipping.getForViewer(id, req.user.userId);
  }

  @Get(':id/shipment/label.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'private, no-store')
  async label(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.shipping.labelPdf(id, req.user.userId);
    res.setHeader('Content-Disposition', `attachment; filename="etiquette-${id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  }

  @Get(':id/shipment/tracking')
  tracking(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.shipping.tracking(id, req.user.userId);
  }
}
