import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyEmailDto } from './dto/register.dto';
import { RegisterPhoneDto } from './dto/register-phone.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

class RefreshDto {
  @IsString() @MinLength(32) @MaxLength(200)
  refreshToken: string;
}
class LogoutDto {
  @IsOptional() @IsString() @MaxLength(200)
  refreshToken?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private meta(req: any) {
    return { userAgent: req.headers?.['user-agent'] as string | undefined, ip: req.ip as string | undefined };
  }

  /** Demande de code SMS : 5 demandes / 10 min / IP, + cooldown et plafond par numéro (OtpService). */
  @Post('register/phone')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  registerPhone(@Body() dto: RegisterPhoneDto) {
    return this.authService.requestPhoneOtp(dto.phoneNumber);
  }

  /** Vérification du code → session (access 15 min + refresh 30 jours). */
  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  verifyOtp(@Req() req: any, @Body() dto: VerifyOtpDto) {
    return this.authService.verifyPhoneOtp(dto.phoneNumber, dto.code, this.meta(req));
  }

  /** Inscription par formulaire (particulier / professionnel) : compte créé sans SMS (phase 5), session ouverte. */
  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  register(@Req() req: any, @Body() dto: RegisterDto) {
    return this.authService.register(dto, this.meta(req));
  }

  /** Connexion e-mail ou username + mot de passe : 10 essais / 10 min / IP. */
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  login(@Req() req: any, @Body() dto: LoginDto) {
    return this.authService.loginWithPassword(dto.identifier, dto.password, this.meta(req));
  }

  /** Mot de passe oublié : toujours 200 (pas d'énumération), 5 demandes / 15 min / IP. */
  @Post('password/forgot')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.identifier);
  }

  /** Nouveau mot de passe avec le jeton reçu par e-mail. */
  @Post('password/reset')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password, dto.passwordConfirmation);
  }

  /** Confirmation de l'adresse e-mail avec le jeton reçu (lien de l'e-mail). Pas de session requise. */
  @Post('email/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  /** Renvoi de l'e-mail de confirmation (connecté) : 3 envois / heure / IP, et 60 s minimum entre deux envois par compte. */
  @UseGuards(JwtAuthGuard)
  @Post('email/resend')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  resendVerification(@Req() req: any) {
    return this.authService.resendEmailVerification(req.user.userId);
  }

  /** Rotation du refresh token. */
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 600_000 } })
  refresh(@Req() req: any, @Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken, this.meta(req));
  }

  /** Déconnexion : révoque la session côté serveur. */
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }

  /** Changement de mot de passe (connecté) : 10 essais / 15 min / IP. */
  @UseGuards(JwtAuthGuard)
  @Post('password/change')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.userId, dto.currentPassword, dto.newPassword, dto.newPasswordConfirmation);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(@Req() req: any) {
    return this.authService.listSessions(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions')
  revokeAll(@Req() req: any) {
    return this.authService.revokeAllSessions(req.user.userId);
  }
}
