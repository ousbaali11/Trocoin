import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * Inscription avec identité + mot de passe (sans SMS pendant la phase de test,
 * voir AUDIT.md §11). Deux parcours : particulier et professionnel (raison
 * sociale + SIRET, clé de contrôle vérifiée par isValidSiret côté service).
 */
export class RegisterDto {
  @IsIn(['particulier', 'professionnel'], { message: 'Type de compte invalide (particulier ou professionnel).' })
  accountType: 'particulier' | 'professionnel';

  @IsString() @MinLength(1, { message: 'Le prénom est obligatoire.' }) @MaxLength(60)
  firstName: string;

  @IsString() @MinLength(1, { message: 'Le nom est obligatoire.' }) @MaxLength(60)
  lastName: string;

  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/i, {
    message: "Nom d'utilisateur : 3 à 30 caractères, lettres, chiffres, point, tiret ou underscore, sans espace.",
  })
  username: string;

  @IsEmail({}, { message: 'Adresse e-mail invalide.' }) @MaxLength(120)
  email: string;

  // 06.., 0033.., +336.. — normalisé côté service ; tout indicatif non français est rejeté.
  @IsString() @MinLength(10) @MaxLength(20)
  phoneNumber: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit faire au moins 8 caractères.' })
  @MaxLength(128)
  password: string;

  @IsString() @MaxLength(128)
  passwordConfirmation: string;

  // ----- Professionnel uniquement -----
  @ValidateIf((o) => o.accountType === 'professionnel')
  @IsString() @MinLength(2, { message: 'La raison sociale est obligatoire pour un compte professionnel.' }) @MaxLength(120)
  companyName?: string;

  @ValidateIf((o) => o.accountType === 'professionnel')
  @IsString()
  @Matches(/^\d{14}$/, { message: 'Le SIRET doit comporter 14 chiffres.' })
  siret?: string;
}

export class VerifyEmailDto {
  /** Jeton reçu par e-mail (lien de confirmation). */
  @IsString() @MinLength(20) @MaxLength(200)
  token: string;
}

export class ChangeEmailDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide.' }) @MaxLength(120)
  newEmail: string;

  @IsString() @MinLength(1) @MaxLength(128)
  password: string;
}

export class TwoFactorCodeDto {
  /** Code à 6 chiffres de l'application, ou code de récupération (xxxxx-xxxxx). */
  @IsString() @MinLength(6) @MaxLength(20)
  code: string;
}

export class TwoFactorLoginDto {
  @IsString() @MinLength(20) @MaxLength(2000)
  challengeToken: string;

  @IsString() @MinLength(6) @MaxLength(20)
  code: string;
}

export class DisableTwoFactorDto {
  @IsString() @MinLength(1) @MaxLength(128)
  password: string;

  @IsString() @MinLength(6) @MaxLength(20)
  code: string;
}

export class LoginDto {
  /** E-mail ou nom d'utilisateur. */
  @IsString() @MinLength(3) @MaxLength(120)
  identifier: string;

  @IsString() @MinLength(1) @MaxLength(128)
  password: string;
}

export class ForgotPasswordDto {
  /** E-mail ou nom d'utilisateur. */
  @IsString() @MinLength(3) @MaxLength(120)
  identifier: string;
}

export class ResetPasswordDto {
  @IsString() @MinLength(32) @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit faire au moins 8 caractères.' })
  @MaxLength(128)
  password: string;

  @IsString() @MaxLength(128)
  passwordConfirmation: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit faire au moins 8 caractères.' })
  @MaxLength(128)
  newPassword: string;

  @IsString() @MaxLength(128)
  newPasswordConfirmation: string;
}
