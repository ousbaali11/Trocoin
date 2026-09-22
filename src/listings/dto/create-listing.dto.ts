import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { CONDITIONS, ListingCondition, PRICE_TYPES, PriceType } from '../listing.entity';

export const MAX_PRICE = 10_000_000;

/** Chaînes venues d'un formulaire : espaces autour retirés avant les contrôles de longueur (AUDIT §69). */
export const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Entiers venus d'un formulaire (chaînes) : vide → absent, sinon nombre entier ou tel quel (rejeté par IsInt). */
const toInt = ({ value }: { value: unknown }) => (value === "" || value === null || value === undefined ? undefined : Number.isFinite(Number(value)) ? Math.round(Number(value)) : value);

export class CreateListingDto {
  @Transform(trimString) // AUDIT §69 : « 3 espaces » passait la longueur minimale
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @Transform(trimString)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @IsString()
  @Matches(/^[a-z0-9-]{2,60}$/)
  categorySlug: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE)
  price?: number;

  @IsOptional()
  @IsIn(PRICE_TYPES)
  priceType?: PriceType;

  @IsOptional()
  @IsIn(CONDITIONS)
  condition?: ListingCondition;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, { message: 'Code postal invalide (5 chiffres).' })
  postalCode?: string;

  @IsOptional()
  @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  deliveryAvailable?: boolean;

  /** Colis pour l'envoi (facultatif) : poids en grammes (10 g à 30 kg) et dimensions en cm (1 à 200). */
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(10)
  @Max(30000)
  weightGrams?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  lengthCm?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  widthCm?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  heightCm?: number;

  /** true = enregistrer comme brouillon (non publié, modifiable) */
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  /** Publier au nom d'une boutique dont on est membre (multi-utilisateurs). */
  @IsOptional()
  @IsUUID()
  onBehalfOf?: string;
}
