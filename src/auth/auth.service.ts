import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { normalizeFrenchMobile } from '../common/validators/french-phone';
import { DATE_TYPE } from '../config/db';
import { OtpService } from '../otp/otp.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './refresh-token.entity';

export const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || '15m';
export const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private otpService: OtpService,
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectRepository(RefreshToken) private refreshRepo: Repository<RefreshToken>,
  ) {}

  /**
   * Étape 1 : demande de code. Rejette explicitement tout numéro qui
   * n'est pas un mobile français — c'est la règle non négociable du produit.
   */
  async requestPhoneOtp(rawPhoneNumber: string): Promise<{ phoneNumber: string }> {
    const normalized = normalizeFrenchMobile(rawPhoneNumber);
    if (!normalized) {
      throw new BadRequestException(
        'Seuls les numéros de mobile français (+33 6 ou 7) sont acceptés sur cette plateforme.',
      );
    }
    await this.otpService.requestOtp(normalized);
    return { phoneNumber: normalized };
  }

  /**
   * Étape 2 : vérification du code -> crée le compte si besoin -> ouvre une
   * session (access token court + refresh token rotatif).
   */
  async verifyPhoneOtp(rawPhoneNumber: string, code: string, meta: { userAgent?: string; ip?: string } = {}) {
    const normalized = normalizeFrenchMobile(rawPhoneNumber);
    if (!normalized) throw new BadRequestException('Numéro de téléphone invalide.');

    await this.otpService.verifyOtp(normalized, code);

    let user = await this.usersService.findByPhone(normalized);
    if (user?.deletedAt) throw new ForbiddenException('Ce compte a été supprimé.');
    if (user?.suspendedAt) throw new ForbiddenException('Ce compte est suspendu. Contactez le support.');
    if (!user) user = await this.usersService.createFromPhone(normalized);

    const tokens = await this.openSession(user, randomUUID(), meta);
    return {
      ...tokens,
      user: { id: user.id, phoneNumber: user.phoneNumber, displayName: user.displayName, accountType: user.accountType },
    };
  }

  private async openSession(user: User, familyId: string, meta: { userAgent?: string; ip?: string }): Promise<SessionTokens> {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, phoneNumber: user.phoneNumber },
      { expiresIn: ACCESS_TOKEN_TTL as any },
    );
    const raw = randomBytes(48).toString('base64url');
    await this.refreshRepo.save(
      this.refreshRepo.create({
        userId: user.id,
        tokenHash: hashToken(raw),
        familyId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        userAgent: meta.userAgent?.slice(0, 200),
        ip: meta.ip?.slice(0, 60),
      }),
    );
    return { accessToken, refreshToken: raw, expiresIn: ACCESS_TOKEN_TTL };
  }

  /**
   * Rotation : le refresh token présenté est consommé (replacedById) et un
   * nouveau couple est émis. Un jeton déjà consommé ou révoqué signale un vol
   * → toute la famille est révoquée et l'appel est refusé.
   */
  async refresh(rawToken: string, meta: { userAgent?: string; ip?: string } = {}): Promise<SessionTokens> {
    if (!rawToken || rawToken.length < 32) throw new UnauthorizedException('Jeton invalide.');
    const stored = await this.refreshRepo.findOne({ where: { tokenHash: hashToken(rawToken) } });
    if (!stored) throw new UnauthorizedException('Session expirée, reconnectez-vous.');

    if (stored.revokedAt || stored.replacedById) {
      await this.refreshRepo.update({ familyId: stored.familyId }, { revokedAt: new Date() });
      this.logger.warn(`Réutilisation d'un refresh token (famille ${stored.familyId}) : session révoquée pour l'utilisateur ${stored.userId}`);
      throw new UnauthorizedException('Session invalidée par mesure de sécurité, reconnectez-vous.');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expirée, reconnectez-vous.');
    }
    const user = await this.usersService.findById(stored.userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Session invalide.');
    if (user.suspendedAt) throw new ForbiddenException('Ce compte est suspendu.');

    const tokens = await this.openSession(user, stored.familyId, meta);
    const replacement = await this.refreshRepo.findOne({ where: { tokenHash: hashToken(tokens.refreshToken) } });
    await this.refreshRepo.update(stored.id, { replacedById: replacement?.id, revokedAt: new Date() });
    return tokens;
  }

  /** Déconnexion : révoque le refresh token présenté (et sa famille). L'access token expire seul en ≤ 15 min. */
  async logout(rawToken: string | undefined): Promise<{ loggedOut: true }> {
    if (rawToken) {
      const stored = await this.refreshRepo.findOne({ where: { tokenHash: hashToken(rawToken) } });
      if (stored) await this.refreshRepo.update({ familyId: stored.familyId }, { revokedAt: new Date() });
    }
    return { loggedOut: true };
  }

  /** Déconnexion de tous les appareils (paramètres, changement de rôle, suspension). */
  async revokeAllSessions(userId: string): Promise<{ revoked: number }> {
    const r = await this.refreshRepo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('"userId" = :userId AND "revokedAt" IS NULL', { userId })
      .execute();
    return { revoked: r.affected || 0 };
  }

  /** Sessions actives (appareils) de l'utilisateur. */
  async listSessions(userId: string) {
    const rows = await this.refreshRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 });
    const now = Date.now();
    return rows
      .filter((r) => !r.revokedAt && !r.replacedById && r.expiresAt.getTime() > now)
      .map((r) => ({ familyId: r.familyId, createdAt: r.createdAt, expiresAt: r.expiresAt, userAgent: r.userAgent, ip: r.ip }));
  }

  /** Nettoyage : jetons expirés depuis plus de 7 jours. */
  async purgeExpired(): Promise<number> {
    const r = await this.refreshRepo
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('"expiresAt" < :d', { d: new Date(Date.now() - 7 * 86_400_000) })
      .execute();
    return r.affected || 0;
  }
}

// DATE_TYPE importé pour garder la cohérence des types de colonnes (voir entity)
void DATE_TYPE;
