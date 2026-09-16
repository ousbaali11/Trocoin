import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CONDITIONS } from '../../listings/listing.entity';

export class SavedSearchQueryDto {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{2,60}$/)
  category?: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @Matches(/^\d{2,5}$/)
  postal_code?: string;

  @IsOptional() @IsNumber() @Min(0)
  price_min?: number;

  @IsOptional() @IsNumber() @Min(0)
  price_max?: number;

  @IsOptional() @IsArray() @IsIn(CONDITIONS, { each: true })
  condition?: string[];

  @IsOptional() @IsBoolean()
  delivery?: boolean;

  @IsOptional() @IsIn(['particulier', 'professionnel'])
  seller_type?: 'particulier' | 'professionnel';

  @IsOptional() @IsUUID()
  seller?: string;

  @IsOptional() @IsLatitude()
  lat?: number;

  @IsOptional() @IsLongitude()
  lng?: number;

  @IsOptional() @IsInt() @Min(1) @Max(500)
  radius?: number;
}

export class CreateSavedSearchDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name: string;

  @ValidateNested() @Type(() => SavedSearchQueryDto)
  query: SavedSearchQueryDto;

  @IsOptional() @IsBoolean()
  notifyPush?: boolean;

  @IsOptional() @IsBoolean()
  notifySms?: boolean;
}

export class UpdateSavedSearchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  @IsOptional() @IsBoolean()
  notifyPush?: boolean;

  @IsOptional() @IsBoolean()
  notifySms?: boolean;
}
