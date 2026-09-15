import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { generateRecoveryCodes, generateTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from './totp';
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
import { EmailVerificationToken } from './email-verification-token.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RefreshToken } from './refresh-token.entity';

/** Hash factice : égalise le temps de réponse quand l'identifiant n'existe pas. */
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Lien de confirmation d'e-mail : 24 h. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Délai minimum entre deux renvois de l'e-mail de confirmation pour un même compte. */
export const EMAIL_VERIFICATION_RESEND_INTERVAL_MS = 60 * 1000;
const INVALID_VERIFICATION_LINK = 'Ce lien de confirmation est invalide ou expiré. Demandez un nouvel e-mail depuis vos paramètres.';

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

/** « jean.dupont@exemple.fr » → « je…@exemple.fr » (avertissements envoyés à l'ancienne adresse). */
function maskEmail(email: string): string {
  return email.replace(/^(.{2}).*(@.*)$/, '$1…$2');
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
    @InjectRepository(EmailVerificationToken) private verificationRepo: Repository<EmailVerificationToken>,
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
    if (user.twoFactorEnabled) return this.twoFactorChallenge(user);

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
    // Preuve de possession de l'adresse : lien à usage unique (24 h). Un échec d'envoi ne bloque
    // pas l'inscription (compte utilisable, bandeau de rappel + bouton « Renvoyer » dans les paramètres).
    const emailSent = await this.issueEmailVerification(user).then(
      () => true,
      (err) => {
        this.logger.warn(`E-mail de confirmation non envoyé à l'inscription de ${user.id} : ${(err as Error).message}`);
        return false;
      },
    );
    const tokens = await this.openSession(user, randomUUID(), meta);
    return { ...tokens, user: this.sessionUser(user), verificationEmailSent: emailSent };
  }

  /** Crée un jeton de confirmation (24 h) pour l'adresse actuelle de l'utilisateur et envoie l'e-mail. */
  private async issueEmailVerification(user: User): Promise<void> {
    if (!user.email) throw new BadRequestException("Aucune adresse e-mail n'est associée à ce compte.");
    const raw = randomBytes(32).toString('base64url');
    await this.verificationRepo.save(
      this.verificationRepo.create({
        userId: user.id,
        email: user.email.toLowerCase(),
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      }),
    );
    const link = `${this.emailService.siteUrl()}/confirmer-email?token=${raw}`;
    await this.emailService.sendEmailVerification(user.email, link, user.firstName || user.displayName);
    this.logger.log(`E-mail de confirmation envoyé pour ${user.id}`);
  }

  /**
   * Confirmation de l'adresse via le jeton reçu : usage unique, expiré après 24 h, et l'adresse
   * doit encore être celle du compte (un changement d'adresse invalide les anciens liens).
   */
  async verifyEmail(rawToken: string): Promise<{ ok: true; email: string; changed: boolean }> {
    const stored = await this.verificationRepo.findOne({ where: { tokenHash: hashToken(rawToken) } });
    if (!stored || stored.usedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(INVALID_VERIFICATION_LINK);
    }
    const user = await this.usersService.findById(stored.userId);
    if (!user || user.deletedAt) throw new BadRequestException(INVALID_VERIFICATION_LINK);
    const now = new Date();
    if (user.email && user.email.toLowerCase() === stored.email) {
      // Confirmation de l'adresse actuelle (inscription ou renvoi)
      await this.verificationRepo.update(stored.id, { usedAt: now });
      if (!user.emailVerified) await this.usersService.markEmailVerified(user.id);
      this.logger.log(`Adresse e-mail confirmée pour ${user.id}`);
      return { ok: true, email: user.email, changed: false };
    }
    // Changement d'adresse : la nouvelle doit être encore libre au moment du clic
    const other = await this.usersService.findByEmail(stored.email);
    if (other && other.id !== user.id) throw new BadRequestException(INVALID_VERIFICATION_LINK);
    const previous = user.email;
    await this.usersService.setEmail(user.id, stored.email);
    // Tous les autres liens en attente de ce compte (ancienne adresse comprise) cessent de valoir
    await this.verificationRepo.update({ userId: user.id }, { usedAt: now });
    if (previous) await this.emailService.sendEmailChangeNotice(previous, user.firstName || user.displayName, maskEmail(stored.email), 'effectue');
    this.logger.log(`Adresse e-mail remplacée pour ${user.id}`);
    return { ok: true, email: stored.email, changed: true };
  }

  /** Renvoi manuel (paramètres du compte) : refusé si déjà confirmé, 60 s minimum entre deux envois. */
  async resendEmailVerification(userId: string): Promise<{ ok: true; email: string }> {
    const user = await this.usersService.findById(userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Connexion requise.');
    if (!user.email) throw new BadRequestException("Aucune adresse e-mail n'est associée à ce compte.");
    if (user.emailVerified) throw new BadRequestException('Votre adresse e-mail est déjà confirmée.');
    const last = await this.verificationRepo.findOne({ where: { userId }, order: { createdAt: 'DESC' } });
    if (last && Date.now() - last.createdAt.getTime() < EMAIL_VERIFICATION_RESEND_INTERVAL_MS) {
      throw new BadRequestException('Un e-mail vient de vous être envoyé. Patientez une minute avant de redemander.');
    }
    await this.issueEmailVerification(user);
    return { ok: true, email: user.email };
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
    // Double authentification activée : pas de session avant le code de l'application
    if (user.twoFactorEnabled) return this.twoFactorChallenge(user);
    const tokens = await this.openSession(user, randomUUID(), meta);
    return { ...tokens, user: this.sessionUser(user) };
  }

  // ------------------------------------------------------------------
  // Double authentification (TOTP, application d'authentification)
  // ------------------------------------------------------------------

  /** Jeton intermédiaire (5 min) : prouve que le mot de passe est bon, n'ouvre aucune session. */
  private async twoFactorChallenge(user: User) {
    const challengeToken = await this.jwtService.signAsync({ sub: user.id, purpose: 'two-factor' }, { expiresIn: '5m' });
    return { twoFactorRequired: true as const, challengeToken, expiresIn: '5m' };
  }

  /** Seconde étape de la connexion : code de l'application (ou code de récupération) → session. */
  async completeTwoFactorLogin(challengeToken: string, code: string, meta: { userAgent?: string; ip?: string } = {}) {
    let payload: { sub?: string; purpose?: string };
    try {
      payload = await this.jwtService.verifyAsync(challengeToken);
    } catch {
      throw new UnauthorizedException('Délai dépassé : recommencez la connexion.');
    }
    if (payload.purpose !== 'two-factor' || !payload.sub) throw new UnauthorizedException('Délai dépassé : recommencez la connexion.');
    const user = await this.usersService.findWithSecrets(payload.sub);
    if (!user || user.deletedAt || !user.twoFactorEnabled || !user.totpSecret) throw new UnauthorizedException('Délai dépassé : recommencez la connexion.');
    if (user.suspendedAt) throw new ForbiddenException('Ce compte est suspendu. Contactez le support.');
    await this.checkSecondFactor(user, code);
    const tokens = await this.openSession(user, randomUUID(), meta);
    this.logger.log(`Connexion avec second facteur pour ${user.id}`);
    return { ...tokens, user: this.sessionUser(user) };
  }

  /**
   * Accepte un code TOTP (tolérance ± 30 s, jamais rejoué) ou un code de récupération (consommé).
   * `user` doit avoir été chargé avec ses secrets.
   */
  private async checkSecondFactor(user: User, rawCode: string): Promise<void> {
    const code = rawCode.trim();
    if (!user.totpSecret) throw new BadRequestException("La double authentification n'est pas activée.");
    const step = verifyTotp(user.totpSecret, code, { notBeforeStep: user.totpLastStep ?? null });
    if (step !== null) {
      await this.usersService.setTotpLastStep(user.id, step);
      return;
    }
    const normalized = normalizeRecoveryCode(code);
    if (normalized.length >= 8) {
      let hashes: string[] = [];
      try {
        hashes = user.totpRecoveryCodes ? (JSON.parse(user.totpRecoveryCodes) as string[]) : [];
      } catch {
        hashes = [];
      }
      const h = hashToken(normalized);
      if (hashes.includes(h)) {
        await this.usersService.setRecoveryCodeHashes(user.id, hashes.filter((x) => x !== h));
        this.logger.warn(`Code de récupération utilisé pour ${user.id} (${hashes.length - 1} restant(s))`);
        return;
      }
    }
    throw new UnauthorizedException("Code incorrect. Vérifiez l'heure de votre téléphone ou utilisez un code de récupération.");
  }

  /** Étape 1 de l'activation : secret + QR code à scanner. Rien n'est exigé tant que le code n'est pas confirmé. */
  async setupTwoFactor(userId: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.usersService.findById(userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Connexion requise.');
    if (user.twoFactorEnabled) throw new BadRequestException('La double authentification est déjà activée.');
    const secret = generateTotpSecret();
    await this.usersService.setPendingTotpSecret(user.id, secret);
    const url = otpauthUrl(secret, user.email || user.username || user.phoneNumber);
    const qrCodeDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    return { secret, otpauthUrl: url, qrCodeDataUrl };
  }

  /** Étape 2 : le code de l'application prouve que le secret a bien été enregistré → activation + codes de récupération (affichés une seule fois). */
  async enableTwoFactor(userId: string, code: string): Promise<{ ok: true; recoveryCodes: string[] }> {
    const user = await this.usersService.findWithSecrets(userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Connexion requise.');
    if (user.twoFactorEnabled) throw new BadRequestException('La double authentification est déjà activée.');
    if (!user.totpSecret) throw new BadRequestException("Commencez par afficher le QR code, puis saisissez le code de l'application.");
    const step = verifyTotp(user.totpSecret, code);
    if (step === null) throw new BadRequestException("Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.");
    const recoveryCodes = generateRecoveryCodes();
    await this.usersService.enableTwoFactor(user.id, recoveryCodes.map((c) => hashToken(normalizeRecoveryCode(c))), step);
    this.logger.log(`Double authentification activée pour ${user.id}`);
    return { ok: true, recoveryCodes };
  }

  /** Désactivation : mot de passe + code de l'application (ou code de récupération). */
  async disableTwoFactor(userId: string, password: string, code: string): Promise<{ ok: true }> {
    const user = await this.usersService.findWithSecrets(userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Connexion requise.');
    if (!user.twoFactorEnabled) throw new BadRequestException("La double authentification n'est pas activée.");
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) throw new BadRequestException('Mot de passe incorrect.');
    await this.checkSecondFactor(user, code);
    await this.usersService.disableTwoFactor(user.id);
    this.logger.log(`Double authentification désactivée pour ${user.id}`);
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Changement d'adresse e-mail (confirmé depuis la nouvelle adresse)
  // ------------------------------------------------------------------

  /**
   * Demande de changement : mot de passe exigé, nouvelle adresse libre, lien de confirmation envoyé
   * à la NOUVELLE adresse (même jeton que l'inscription), avertissement à l'adresse actuelle.
   * L'adresse du compte ne change qu'au clic sur le lien.
   */
  async requestEmailChange(userId: string, newEmail: string, password: string): Promise<{ ok: true; email: string }> {
    const user = await this.usersService.findWithPasswordHash(userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Connexion requise.');
    if (!user.passwordHash) {
      throw new BadRequestException("Ce compte n'a pas de mot de passe : définissez-en un via « Mot de passe oublié » avant de changer d'adresse.");
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw new BadRequestException('Mot de passe incorrect.');
    const email = newEmail.trim().toLowerCase();
    if (user.email && user.email.toLowerCase() === email) throw new BadRequestException('Cette adresse est déjà celle de votre compte.');
    const other = await this.usersService.findByEmail(email);
    if (other && other.id !== user.id) throw new ConflictException('Cette adresse e-mail est déjà utilisée par un autre compte.');
    const raw = randomBytes(32).toString('base64url');
    await this.verificationRepo.save(
      this.verificationRepo.create({ userId: user.id, email, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) }),
    );
    const link = `${this.emailService.siteUrl()}/confirmer-email?token=${raw}`;
    await this.emailService.sendEmailVerification(email, link, user.firstName || user.displayName, 'changement');
    if (user.email) await this.emailService.sendEmailChangeNotice(user.email, user.firstName || user.displayName, maskEmail(email), 'demande');
    this.logger.log(`Changement d'adresse demandé pour ${user.id}`);
    return { ok: true, email };
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

  /**
   * Changement de mot de passe par l'utilisateur connecté : ancien mot de passe
   * exigé, nouveau ≠ ancien, toutes les autres sessions révoquées (la session
   * courante est fermée aussi : le front reconnecte avec le nouveau mot de passe).
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string, confirmation: string): Promise<{ ok: true }> {
    if (newPassword !== confirmation) throw new BadRequestException('Les deux nouveaux mots de passe ne correspondent pas.');
    const user = await this.usersService.findWithPasswordHash(userId);
    if (!user) throw new UnauthorizedException('Connexion requise.');
    if (!user.passwordHash) {
      throw new BadRequestException("Ce compte a été créé par code SMS et n'a pas encore de mot de passe : utilisez « Mot de passe oublié » pour en définir un.");
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new BadRequestException('Mot de passe actuel incorrect.');
    if (currentPassword === newPassword) throw new BadRequestException("Le nouveau mot de passe doit être différent de l'actuel.");
    await this.usersService.setPasswordHash(userId, await hashPassword(newPassword));
    await this.revokeAllSessions(userId);
    this.logger.log(`Mot de passe changé par l'utilisateur ${userId} (sessions révoquées)`);
    return { ok: true };
  }

  private sessionUser(user: User) {
    return {
      id: user.id,
      phoneNumber: user.phoneNumber,
      phoneVerified: user.phoneVerified,
      email: user.email,
      emailVerified: !!user.emailVerified,
      twoFactorEnabled: !!user.twoFactorEnabled,
      displayName: user.displayName,
      username: user.username,
      accountType: user.accountType,
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
