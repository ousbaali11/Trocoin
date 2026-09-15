import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { MAX_PARCEL_WEIGHT_GRAMS } from '../shipping.constants';
import { ShippingMode } from '../shipping-provider.interface';

export class ShippingAddressDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  line1: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  line2?: string;

  @Matches(/^\d{5}$/, { message: 'Le code postal doit comporter 5 chiffres.' })
  postalCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;
}

export class ParcelDto {
  @IsInt()
  @Min(10)
  @Max(MAX_PARCEL_WEIGHT_GRAMS)
  weightGrams: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  lengthCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  widthCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  heightCm?: number;
}

export class QuoteShipmentDto {
  @ValidateNested()
  @Type(() => ParcelDto)
  parcel: ParcelDto;

  /** Code postal de départ ; par défaut celui du profil du vendeur. */
  @IsOptional()
  @Matches(/^\d{5}$/)
  fromPostalCode?: string;

  /** Code postal d'arrivée ; par défaut celui du profil de l'acheteur. */
  @IsOptional()
  @Matches(/^\d{5}$/)
  toPostalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fromCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  toCity?: string;
}

export class CreateShipmentDto {
  @IsIn(['domicile', 'point_relais'])
  mode: ShippingMode;

  @ValidateNested()
  @Type(() => ParcelDto)
  parcel: ParcelDto;

  @ValidateNested()
  @Type(() => ShippingAddressDto)
  sender: ShippingAddressDto;

  @ValidateNested()
  @Type(() => ShippingAddressDto)
  recipient: ShippingAddressDto;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  relayPointId?: string;
}
