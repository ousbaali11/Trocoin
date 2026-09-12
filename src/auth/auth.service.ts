import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { normalizeFrenchMobile } from '../common/validators/french-phone';
import { OtpService } from '../otp/otp.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private otpService: OtpService,
    private usersService: UsersService,
    private jwtService: JwtService,
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
   * Étape 2 : vérification du code -> crée le compte si besoin -> renvoie un JWT.
   * Un compte suspendu ou supprimé ne peut pas se reconnecter.
   */
  async verifyPhoneOtp(rawPhoneNumber: string, code: string) {
    const normalized = normalizeFrenchMobile(rawPhoneNumber);
    if (!normalized) {
      throw new BadRequestException('Numéro de téléphone invalide.');
    }

    await this.otpService.verifyOtp(normalized, code);

    let user = await this.usersService.findByPhone(normalized);
    if (user?.deletedAt) {
      throw new ForbiddenException('Ce compte a été supprimé.');
    }
    if (user?.suspendedAt) {
      throw new ForbiddenException('Ce compte est suspendu. Contactez le support.');
    }
    if (!user) {
      user = await this.usersService.createFromPhone(normalized);
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      phoneNumber: user.phoneNumber,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        displayName: user.displayName,
        accountType: user.accountType,
      },
    };
  }
}
