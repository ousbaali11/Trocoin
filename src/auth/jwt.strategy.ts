import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { resolveJwtSecret } from '../config/env.validation';
import { UsersService } from '../users/users.service';

export interface AuthUser {
  userId: string;
  phoneNumber: string;
  accountType: 'particulier' | 'professionnel' | 'admin';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  /**
   * Le compte est rechargé à chaque requête : un compte supprimé ou suspendu
   * perd immédiatement l'accès, même avec un JWT encore valide. Le rôle
   * (accountType) vient de la base, jamais du token, pour qu'une
   * rétrogradation admin soit effective immédiatement.
   */
  async validate(payload: { sub: string; phoneNumber: string; purpose?: string }): Promise<AuthUser> {
    // Les jetons intermédiaires (défi de double authentification) portent un `purpose` : jamais une session.
    if (payload.purpose) throw new UnauthorizedException('Session invalide.');
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.deletedAt) throw new UnauthorizedException('Session invalide.');
    if (user.suspendedAt) throw new ForbiddenException('Ce compte est suspendu.');
    return { userId: user.id, phoneNumber: user.phoneNumber, accountType: user.accountType };
  }
}
