import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolveJwtSecret } from '../config/env.validation';
import { OtpModule } from '../otp/otp.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { EmailModule } from '../email/email.module';
import { EmailVerificationToken } from './email-verification-token.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RefreshToken } from './refresh-token.entity';

/**
 * Module global : une seule configuration JWT pour toute l'application
 * (HTTP et WebSocket). Access token court (JWT_EXPIRES_IN, défaut 15 min) ;
 * la persistance de session repose sur les refresh tokens en base.
 */
@Global()
@Module({
  imports: [
    OtpModule,
    UsersModule,
    EmailModule,
    TypeOrmModule.forFeature([RefreshToken, PasswordResetToken, EmailVerificationToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN as any) || '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, OptionalJwtAuthGuard, AdminGuard],
  exports: [AuthService, JwtModule, PassportModule, JwtAuthGuard, OptionalJwtAuthGuard, AdminGuard],
})
export class AuthModule {}
