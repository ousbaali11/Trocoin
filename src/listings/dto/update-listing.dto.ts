import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { CONDITIONS, ListingCondition, PRICE_TYPES, PriceType } from '../listing.entity';
import { trimString } from './create-listing.dto';
import { MAX_PRICE } from './create-listing.dto';

/** Statuts que le propriétaire peut choisir lui-même. */
export const OWNER_STATUSES = ['en_ligne', 'vendue', 'desactivee'] as const;

const toIntOrKeep = ({ value }: { value: unknown }) => (value === "" || value === null || value === undefined ? undefined : Number.isFinite(Number(value)) ? Math.round(Number(value)) : value);

export class UpdateListingDto {
  @Transform(trimString) @IsOptional() @IsString() @MinLength(3) @MaxLength(150)
  title?: string;

  @Transform(trimString) @IsOptional() @IsString() @MinLength(10) @MaxLength(5000)
  description?: string;

  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{2,60}$/)
  categorySlug?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MAX_PRICE)
  price?: number;

  @IsOptional() @IsIn(PRICE_TYPES)
  priceType?: PriceType;

  @IsOptional() @IsIn(CONDITIONS)
  condition?: ListingCondition;

  @IsOptional() @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @Matches(/^\d{5}$/)
  postalCode?: string;

  @IsOptional() @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined) @IsLatitude()
  latitude?: number;

  @IsOptional() @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined) @IsLongitude()
  longitude?: number;

  @IsOptional() @IsBoolean()
  deliveryAvailable?: boolean;

  /** Colis pour l'envoi (facultatif) : grammes et centimètres. */
  @IsOptional() @Transform(toIntOrKeep) @IsInt() @Min(10) @Max(30000)
  weightGrams?: number;

  @IsOptional() @Transform(toIntOrKeep) @IsInt() @Min(1) @Max(200)
  lengthCm?: number;

  @IsOptional() @Transform(toIntOrKeep) @IsInt() @Min(1) @Max(200)
  widthCm?: number;

  @IsOptional() @Transform(toIntOrKeep) @IsInt() @Min(1) @Max(200)
  heightCm?: number;

  @IsOptional() @IsIn(OWNER_STATUSES)
  status?: (typeof OWNER_STATUSES)[number];
}

export class ReorderPhotosDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) // AUDIT §69 : plus de plafond à 20 photos par annonce
  photoIds: string[];
}
