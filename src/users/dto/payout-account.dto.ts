import { Type } from 'class-transformer';
import { Equals, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class PayoutDobDto {
  @IsInt() @Min(1) @Max(31)
  day: number;

  @IsInt() @Min(1) @Max(12)
  month: number;

  @IsInt() @Min(1900) @Max(2100)
  year: number;
}

class PayoutAddressDto {
  @IsString() @Length(3, 120)
  line1: string;

  @Matches(/^\d{5}$/, { message: 'Code postal à 5 chiffres requis.' })
  postalCode: string;

  @IsString() @Length(1, 80)
  city: string;
}

/**
 * Compte de versement en un formulaire (AUDIT §63) : ce que le prestataire exige pour verser un particulier en France —
 * identité, date de naissance, adresse, IBAN — et l'acceptation de ses conditions. Rien de plus : pas de parcours externe.
 * L'IBAN n'est jamais conservé par Trocoin (transmis une fois au prestataire, seuls ses 4 derniers caractères sont gardés).
 */
export class PayoutAccountDto {
  @IsString() @Length(1, 60)
  firstName: string;

  @IsString() @Length(1, 60)
  lastName: string;

  @ValidateNested() @Type(() => PayoutDobDto)
  dob: PayoutDobDto;

  @ValidateNested() @Type(() => PayoutAddressDto)
  address: PayoutAddressDto;

  /** IBAN avec ou sans espaces ; validé (format + clé) avant tout appel au prestataire. */
  @IsString() @MaxLength(60)
  iban: string;

  /** Téléphone joignable pour le prestataire ; par défaut celui du compte. */
  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @Equals(true, { message: "L'acceptation des conditions du service de versement est requise." })
  acceptTerms: boolean;
}

/** Validation IBAN (ISO 13616) : pays, longueur, clé mod 97. Renvoie l'IBAN normalisé ou null. */
export function normalizeIban(raw: string): string | null {
  const iban = (raw || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  const lengths: Record<string, number> = { FR: 27, MC: 27, DE: 22, BE: 16, ES: 24, IT: 27, NL: 18, LU: 20, PT: 25, CH: 21, GB: 22, IE: 22, AT: 20 };
  const expected = lengths[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return null;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1 ? iban : null;
}
