import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DeliveryMethod } from '../transaction.entity';

export const DELIVERY_METHODS: DeliveryMethod[] = ['main_propre', 'colissimo', 'mondial_relay'];

export class CreateTransactionDto {
  @IsUUID()
  listingId: string;

  // Le montant n'est jamais fourni par le client : il est repris du prix
  // de l'annonce côté serveur pour éviter toute manipulation du prix payé.

  @IsOptional()
  @IsIn(DELIVERY_METHODS)
  deliveryMethod?: DeliveryMethod;
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
