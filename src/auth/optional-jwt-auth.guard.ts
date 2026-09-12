import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Pour les routes publiques qui adaptent leur réponse si un utilisateur est
 * connecté (ex. : le propriétaire voit sa propre annonce désactivée).
 * Sans token, ou avec un token invalide, req.user reste undefined.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!req.headers?.authorization) return true;
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) return undefined;
    return user;
  }
}
