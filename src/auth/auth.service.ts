import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { normalizeFrenchMobile } from '../common/validators/french-phone';
import { DATE_TYPE } from '../config/db';
import { OtpService } from '../otp/otp.service';
import { RegisterDto } from './dto/register.dto';
import { hashPassword, verifyPassword } from './password';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { PasswordResetToken } from './password-reset-token.entity';
import { RefreshToken } from './refresh-token.entity';

/** Hash factice : égalise le temps de réponse quand l'identifiant n'existe pas. */
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Mot de passe temporaire lisible (sans caractères ambigus), 12 caractères, entropie ≈ 62 bits. */
function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

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
    @InjectRepository(PasswordResetToken) private resetRepo: Repository<PasswordResetToken>,
    private emailService: EmailService,
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

  /**
   * Inscription par formulaire (phase 5). AUCUN SMS : le compte est créé
   * immédiatement avec phoneVerified=false. Pour réactiver la vérification,
   * appeler `this.otpService.requestOtp(normalized)` ici et n'ouvrir la session
   * qu'après `verifyPhoneOtp` (voir AUDIT.md §11).
   */
  async register(dto: RegisterDto, meta: { userAgent?: string; ip?: string } = {}) {
    const normalized = normalizeFrenchMobile(dto.phoneNumber);
    if (!normalized) {
      throw new BadRequestException('Seuls les numéros de mobile français (+33 6 ou 7) sont acceptés sur cette plateforme.');
    }
    if (dto.password !== dto.passwordConfirmation) throw new BadRequestException('Les deux mots de passe ne correspondent pas.');
    if (dto.accountType === 'professionnel' && (!dto.companyName || !dto.siret)) {
      throw new BadRequestException('Raison sociale et SIRET sont obligatoires pour un compte professionnel.');
    }
    const passwordHash = await hashPassword(dto.password);
    const user = await this.usersService.createWithCredentials({
      accountType: dto.accountType,
      firstName: dto.firstName,
      lastName: dto.lastName,
      username: dto.username,
      email: dto.email,
      phoneNumber: normalized,
      passwordHash,
      companyName: dto.companyName,
      siret: dto.siret,
    });
    this.logger.log(`Inscription ${dto.accountType} ${user.id} (téléphone non vérifié : SMS désactivé, phase 5)`);
    const tokens = await this.openSession(user, randomUUID(), meta);
    return { ...tokens, user: this.sessionUser(user) };
  }

  /** Connexion e-mail ou nom d'utilisateur + mot de passe. Même message quel que soit le champ erroné. */
  async loginWithPassword(identifier: string, password: string, meta: { userAgent?: string; ip?: string } = {}) {
    const user = await this.usersService.findForLogin(identifier);
    const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, DUMMY_HASH); // temps constant
    if (!user || !ok) {
      if (user && !user.passwordHash) {
        throw new UnauthorizedException("Ce compte a été créé par code SMS et n'a pas de mot de passe : utilisez la connexion par SMS.");
      }
      throw new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    }
    if (user.deletedAt) throw new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    if (user.suspendedAt) throw new ForbiddenException('Ce compte est suspendu. Contactez le support.');
    const tokens = await this.openSession(user, randomUUID(), meta);
    return { ...tokens, user: this.sessionUser(user) };
  }

  /**
   * « Mot de passe oublié » : répond toujours OK (pas d'énumération des comptes).
   * Un jeton à usage unique (1 h) est envoyé par e-mail via EmailService.
   * Si aucun fournisseur d'e-mail n'est disponible (EMAIL_PROVIDER=none), 503 explicite.
   */
  async forgotPassword(identifier: string): Promise<{ ok: true }> {
    if (!this.emailService.available) {
      throw new ServiceUnavailableException(
        "La réinitialisation par e-mail n'est pas encore disponible. Contactez le support pour recevoir un mot de passe temporaire.",
      );
    }
    const user = await this.usersService.findForLogin(identifier);
    if (!user || user.deletedAt || !user.email) return { ok: true };
    const raw = randomBytes(32).toString('base64url');
    await this.resetRepo.save(
      this.resetRepo.create({ userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) }),
    );
    const link = `${this.emailService.siteUrl()}/reinitialiser?token=${raw}`;
    await this.emailService.sendPasswordReset(user.email, link, user.firstName || user.displayName);
    this.logger.log(`Lien de réinitialisation émis pour ${user.id}`);
    return { ok: true };
  }

  /** Nouveau mot de passe via le jeton reçu : jeton consommé, toutes les sessions révoquées. */
  async resetPassword(rawToken: string, password: string, confirmation: string): Promise<{ ok: true }> {
    if (password !== confirmation) throw new BadRequestException('Les deux mots de passe ne correspondent pas.');
    const stored = await this.resetRepo.findOne({ where: { tokenHash: hashToken(rawToken) } });
    if (!stored || stored.usedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Ce lien de réinitialisation est invalide ou expiré. Refaites une demande.');
    }
    const user = await this.usersService.findById(stored.userId);
    if (!user || user.deletedAt) throw new BadRequestException('Ce lien de réinitialisation est invalide ou expiré. Refaites une demande.');
    await this.usersService.setPasswordHash(user.id, await hashPassword(password));
    await this.resetRepo.update(stored.id, { usedAt: new Date() });
    await this.revokeAllSessions(user.id);
    this.logger.log(`Mot de passe réinitialisé pour ${user.id} (sessions révoquées)`);
    return { ok: true };
  }

  /**
   * Réinitialisation par un administrateur (utilisateur bloqué sans e-mail
   * fonctionnel) : mot de passe temporaire affiché une seule fois à l'admin,
   * à transmettre par un canal sûr ; toutes les sessions sont révoquées.
   */
  async adminResetPassword(userId: string): Promise<{ temporaryPassword: string }> {
    const user = await this.usersService.findById(userId);
    if (!user || user.deletedAt) throw new BadRequestException('Utilisateur introuvable ou supprimé.');
    const temporaryPassword = generateTemporaryPassword();
    await this.usersService.setPasswordHash(user.id, await hashPassword(temporaryPassword));
    await this.revokeAllSessions(user.id);
    return { temporaryPassword };
  }

  private sessionUser(user: User) {
    return { id: user.id, phoneNumber: user.phoneNumber, phoneVerified: user.phoneVerified, displayName: user.displayName, username: user.username, accountType: user.accountType };
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
