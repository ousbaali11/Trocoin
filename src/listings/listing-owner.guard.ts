import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ListingsService } from './listings.service';

/**
 * Vérifie le droit de gérer l'annonce (propriétaire OU membre de la boutique
 * propriétaire) AVANT que multer n'écrive quoi que ce soit sur le disque
 * (les guards s'exécutent avant les interceptors).
 */
@Injectable()
export class ListingOwnerGuard implements CanActivate {
  constructor(private listingsService: ListingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    await this.listingsService.getManaged(req.params.id, req.user.userId);
    return true;
  }
}
