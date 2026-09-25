import { Controller, Get, Inject, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoxtalShippingProvider } from './boxtal-shipping.provider';
import { IShippingProvider } from './shipping-provider.interface';
import { SHIPPING_PROVIDER } from './shipping.constants';

/**
 * Diagnostic de la connexion Boxtal, **sandbox uniquement** (404 sinon) : jeton v3, cotation v1 d'un colis
 * type Lyon → Paris, points relais, et avec `?label=1` une commande d'expédition de test (étiquette PDF,
 * suivi, puis annulation). Aucune donnée d'identification n'est renvoyée ; les clés vivent sur l'hébergeur,
 * cette route est le seul moyen de vérifier la connexion sans les copier ailleurs. 5 appels / 10 min / IP.
 */
@UseGuards(JwtAuthGuard, AdminGuard) // AUDIT §73 : la longueur des clés et une commande de test ne regardent que l'administration
@Controller('shipping')
export class ShippingDiagnosticController {
  constructor(@Inject(SHIPPING_PROVIDER) private readonly provider: IShippingProvider) {}

  @Get('diagnostic')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async diagnostic(@Query('label') label?: string) {
    if (!(this.provider instanceof BoxtalShippingProvider) || this.provider.environment !== 'sandbox') throw new NotFoundException();
    return this.provider.diagnostic(label === '1');
  }
}
