import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { DeliveryMethod } from '../transaction.entity';

export const DELIVERY_METHODS: DeliveryMethod[] = ['main_propre', 'colissimo', 'mondial_relay'];

/** Adresse de livraison de l'acheteur (envoi par transporteur) : vue du vendeur seul, transmise au prestataire d'étiquettes. */
export class DeliveryAddressDto {
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
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class CreateTransactionDto {
  @IsUUID()
  listingId: string;

  // Le montant n'est jamais fourni par le client : il est repris du prix
  // de l'annonce côté serveur pour éviter toute manipulation du prix payé.

  @IsOptional()
  @IsIn(DELIVERY_METHODS)
  deliveryMethod?: DeliveryMethod;

  /** Requise par le site pour un envoi ; facultative pour l'API (ventes créées avant la phase 2, anciens clients). */
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  shippingAddress?: DeliveryAddressDto;

  /**
   * Total affiché à l'acheteur au moment où il clique sur « Payer » (AUDIT §51). Ce n'est PAS le montant débité
   * (toujours recalculé côté serveur) : c'est un garde-fou. Si l'admin a changé le barème entre l'affichage et le
   * clic, le serveur refuse (409) et renvoie le nouveau devis au lieu de débiter un total que l'acheteur n'a pas vu.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedTotal?: number;
}

export class ShipTransactionDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(40)
  trackingNumber?: string;
}

export class DisputeTransactionDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason: string;
}

export class HandoverDto {
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;
}
