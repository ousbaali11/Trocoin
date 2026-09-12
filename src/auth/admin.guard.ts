import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from './jwt.strategy';

/**
 * À utiliser TOUJOURS après JwtAuthGuard : @UseGuards(JwtAuthGuard, AdminGuard).
 * Le rôle est lu depuis la base à chaque requête (JwtStrategy.validate),
 * jamais depuis le contenu du token.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Authentification requise.');
    if (user.accountType !== 'admin') {
      throw new ForbiddenException('Accès réservé aux administrateurs.');
    }
    return true;
  }
}
