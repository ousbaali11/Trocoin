import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterPhoneDto } from './dto/register-phone.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Demande de code SMS. Limite dédiée et stricte par IP (anti-spam SMS,
   * chaque SMS réel coûte de l'argent) : 5 demandes / 10 min.
   * S'ajoute au cooldown de 60 s par numéro géré dans OtpService.
   */
  @Post('register/phone')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  registerPhone(@Body() dto: RegisterPhoneDto) {
    return this.authService.requestPhoneOtp(dto.phoneNumber);
  }

  /**
   * Vérification du code (crée le compte au premier succès).
   * 10 essais / 10 min par IP, en plus des 5 essais max par code.
   */
  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyPhoneOtp(dto.phoneNumber, dto.code);
  }
}
