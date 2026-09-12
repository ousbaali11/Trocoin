import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  phoneNumber: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Le code doit contenir 6 chiffres.' })
  code: string;
}
