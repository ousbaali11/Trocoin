import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeFrenchMobile } from '../common/validators/french-phone';
import { isProduction } from '../config/env.validation';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';

/**
 * Endpoints strictement réservés au développement local.
 *
 * Double protection :
 *  1. NODE_ENV=production -> 404 inconditionnel, quelle que soit la config SMS ;
 *  2. sinon, uniquement si SMS_PROVIDER=mock (avec un vrai fournisseur, le
 *     code n'est de toute façon pas conservé : voir SmsService).
 * En production, validateEnv() interdit en plus SMS_PROVIDER=mock, donc
 * cet endpoint ne peut pas être activé par erreur.
 */
@Controller('dev')
export class DevController {
  constructor(
    private config: ConfigService,
    private smsService: SmsService,
    private emailService: EmailService,
  ) {}

  @Get('last-reset-link/:email')
  getLastResetLink(@Param('email') email: string) {
    if (isProduction()) throw new NotFoundException();
    if ((this.config.get<string>('EMAIL_PROVIDER') || 'mock') !== 'mock') throw new NotFoundException();
    const link = this.emailService.getLastResetLinkForDev(email);
    if (!link) throw new NotFoundException('Aucun lien récent pour cette adresse.');
    return { email: email.toLowerCase(), link };
  }

  @Get('last-otp/:phone')
  getLastOtp(@Param('phone') phone: string) {
    if (isProduction()) throw new NotFoundException();
    if ((this.config.get<string>('SMS_PROVIDER') || 'mock') !== 'mock') {
      throw new NotFoundException();
    }
    const normalized = normalizeFrenchMobile(phone);
    if (!normalized) throw new NotFoundException();

    const code = this.smsService.getLastCodeForDev(normalized);
    if (!code) throw new NotFoundException('Aucun code récent pour ce numéro.');
    return { phoneNumber: normalized, code };
  }
}
