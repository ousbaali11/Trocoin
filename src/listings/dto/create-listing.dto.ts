import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CONDITIONS, ListingCondition, PRICE_TYPES, PriceType } from '../listing.entity';

export const MAX_PRICE = 10_000_000;

export class CreateListingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

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

  /** true = enregistrer comme brouillon (non publié, modifiable) */
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  /** Publier au nom d'une boutique dont on est membre (multi-utilisateurs). */
  @IsOptional()
  @IsUUID()
  onBehalfOf?: string;
}
