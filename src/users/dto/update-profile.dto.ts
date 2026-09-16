import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Seuls ces champs sont modifiables par l'utilisateur lui-même.
 * phoneVerified, accountType, identityVerified, ratings, suspendedAt, stripe* sont réservés au
 * système / à l'admin. phoneNumber n'est acceptable que pour un compte qui n'en a pas encore
 * (dépôt d'annonce) : un numéro déjà enregistré ne se modifie pas ici.
 */
export class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(10) @MaxLength(20)
  phoneNumber?: string;

  @IsOptional() @IsBoolean()
  phonePublic?: boolean;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(50)
  @Matches(/^[^<>{}\[\]\\\/]+$/, { message: 'Le pseudo contient des caractères interdits.' })
  displayName?: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @Matches(/^\d{5}$/, { message: 'Code postal invalide (5 chiffres).' })
  postalCode?: string;

  @IsOptional() @IsString() @MaxLength(80)
  shopName?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  shopDescription?: string;

  @IsOptional() @IsString() @MaxLength(200)
  shopAddress?: string;

  @IsOptional() @IsString() @MaxLength(200)
  shopHours?: string;

  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(200)
  shopWebsite?: string;

  @IsOptional() @IsBoolean()
  notifyPush?: boolean;

  @IsOptional() @IsBoolean()
  notifySms?: boolean;

  /** Préférences granulaires { message: { push, sms, email }, … } — validées dans UsersService. */
  @IsOptional() @IsObject()
  notificationPrefs?: Record<string, Record<string, boolean>>;

  /** Dernières localisations (5 au plus) : { city, postalCode?, latitude?, longitude? } — validées dans UsersService. */
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  recentLocations?: Array<Record<string, unknown>>;
}

export class BecomeProDto {
  // SIRET : 14 chiffres (validation de format ; la vérification auprès de
  // l'INSEE/KYC est une brique de production, voir AUDIT.md)
  @IsString() @Matches(/^\d{14}$/, { message: 'Le SIRET doit contenir 14 chiffres.' })
  siret: string;

  @IsString() @MinLength(2) @MaxLength(80)
  shopName: string;
}
