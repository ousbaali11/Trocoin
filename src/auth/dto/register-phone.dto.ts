import { IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterPhoneDto {
  // Accepte 06.., 0033.., +336.. — normalisé côté service ; tout indicatif
  // non français est rejeté par normalizeFrenchMobile().
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  phoneNumber: string;
}
