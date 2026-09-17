import { Controller, Get, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ShippingService } from './shipping.service';

/**
 * Avant le paiement (AUDIT §57) : ce que Colissimo et Mondial Relay proposent réellement pour l'adresse de
 * l'acheteur — envoi à domicile et/ou retrait — avec les points de retrait réels du prestataire (relais
 * commerçants, bureaux de poste, consignes automatiques). Membre connecté, 120 appels / 10 min.
 * `part=points` ou `part=prices` (AUDIT §61) : une moitié seulement — la fenêtre d'achat demande les deux en même temps
 * et affiche chacune dès qu'elle arrive (la liste des points n'attend pas la cotation, et inversement).
 *   GET /shipping/pickup-options?listingId=…&postalCode=75017&city=Paris
 */
@UseGuards(JwtAuthGuard)
@Controller('shipping')
export class ShippingOptionsController {
  constructor(private readonly shipping: ShippingService) {}

  @Get('pickup-options')
  @Throttle({ default: { limit: 120, ttl: 600_000 } })
  pickupOptions(@Query('listingId', ParseUUIDPipe) listingId: string, @Query('postalCode') postalCode?: string, @Query('city') city?: string, @Query('part') part?: string) {
    return this.shipping.pickupOptions(listingId, (postalCode || '').trim(), (city || '').trim().slice(0, 80) || undefined, part === 'points' || part === 'prices' ? part : 'all');
  }
}
