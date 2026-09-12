import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { SmsService } from '../sms/sms.service';
import { PhoneVerification } from './otp.entity';

class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute entre deux envois
const MAX_SENDS_PER_HOUR = 5; // par numéro, quelle que soit l'IP

function hashCode(code: string, phoneNumber: string): string {
  return createHash('sha256').update(`${phoneNumber}:${code}`).digest('hex');
}

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(PhoneVerification)
    private otpRepo: Repository<PhoneVerification>,
    private smsService: SmsService,
  ) {}

  async requestOtp(phoneNumber: string): Promise<void> {
    const recent = await this.otpRepo.findOne({
      where: { phoneNumber },
      order: { createdAt: 'DESC' },
    });

    if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new TooManyRequestsException('Veuillez patienter avant de redemander un code.');
    }

    // Plafond horaire par numéro : empêche de bombarder un numéro de SMS
    // depuis plusieurs IP (le throttler par IP ne suffit pas seul).
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sentLastHour = await this.otpRepo
      .createQueryBuilder('v')
      .where('v.phoneNumber = :phoneNumber', { phoneNumber })
      .andWhere('v.createdAt > :since', { since: oneHourAgo })
      .getCount();
    if (sentLastHour >= MAX_SENDS_PER_HOUR) {
      throw new TooManyRequestsException(
        'Trop de codes demandés pour ce numéro. Réessayez dans une heure.',
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    const entry = this.otpRepo.create({
      phoneNumber,
      codeHash: hashCode(code, phoneNumber),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 0,
    });
    await this.otpRepo.save(entry);

    try {
      await this.smsService.sendOtp(phoneNumber, code);
    } catch (err) {
      // Le SMS n'est pas parti : on retire la demande pour que l'utilisateur
      // puisse réessayer immédiatement (pas de cooldown ni de code fantôme).
      await this.otpRepo.delete({ id: entry.id });
      throw err;
    }
  }

  /** Retourne true si le code est valide et vient d'être consommé. */
  async verifyOtp(phoneNumber: string, code: string): Promise<boolean> {
    const entry = await this.otpRepo.findOne({
      where: { phoneNumber },
      order: { createdAt: 'DESC' },
    });

    if (!entry) {
      throw new BadRequestException('Aucun code en attente pour ce numéro.');
    }
    if (entry.verifiedAt) {
      throw new BadRequestException('Ce code a déjà été utilisé.');
    }
    if (entry.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Ce code a expiré, redemandez-en un.');
    }
    if (entry.attempts >= MAX_ATTEMPTS) {
      throw new TooManyRequestsException('Trop de tentatives, redemandez un nouveau code.');
    }

    entry.attempts += 1;

    // Comparaison en temps constant (pas de fuite par mesure de temps)
    const expected = Buffer.from(entry.codeHash, 'hex');
    const actual = Buffer.from(hashCode(code, phoneNumber), 'hex');
    const isValid = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!isValid) {
      await this.otpRepo.save(entry);
      throw new BadRequestException('Code incorrect.');
    }

    entry.verifiedAt = new Date();
    await this.otpRepo.save(entry);
    return true;
  }
}
