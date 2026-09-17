import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LISTING_STATUSES, ListingStatus } from '../../listings/listing.entity';

const toNumber = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export class AdminPaginationDto {
  @IsOptional() @Transform(toNumber) @IsInt() @Min(1) @Max(10_000)
  page?: number;

  @IsOptional() @Transform(toNumber) @IsInt() @Min(1) @Max(100)
  page_size?: number;
}

export class AdminUsersQueryDto extends AdminPaginationDto {
  @IsOptional() @IsString() @MaxLength(50)
  q?: string; // téléphone, pseudo, e-mail, SIRET, shopName

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsIn(['particulier', 'professionnel', 'admin'])
  account_type?: string;

  @IsOptional() @IsIn(['actif', 'suspendu', 'supprime'])
  status?: string;
}

export class AdminUpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(50)
  displayName?: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @Matches(/^\d{5}$/)
  postalCode?: string;

  @IsOptional() @IsIn(['particulier', 'professionnel', 'admin'])
  accountType?: 'particulier' | 'professionnel' | 'admin';

  @IsOptional() @IsBoolean()
  identityVerified?: boolean;

  /** Compte de démonstration (indicateur interne, AUDIT §46). */
  @IsOptional() @IsBoolean()
  isDemoAccount?: boolean;

  @IsOptional() @IsBoolean()
  suspended?: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  suspensionReason?: string;

  @IsOptional() @IsString() @MaxLength(80)
  shopName?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  shopDescription?: string;

  @IsOptional() @IsString() @Matches(/^\d{14}$/)
  siret?: string;
}

export class AdminListingsQueryDto extends AdminPaginationDto {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsIn(LISTING_STATUSES)
  status?: ListingStatus;

  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{2,60}$/)
  category?: string;

  @IsOptional() @IsString() @MaxLength(36)
  user_id?: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsIn(['true'])
  flagged?: string; // en_attente uniquement
}

export class AdminUpdateListingDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(150)
  title?: string;

  @IsOptional() @IsString() @MinLength(10) @MaxLength(5000)
  description?: string;

  @IsOptional() @IsIn(LISTING_STATUSES)
  status?: ListingStatus;

  @IsOptional() @IsString() @MaxLength(500)
  moderationReason?: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;
}

export class AdminReportsQueryDto extends AdminPaginationDto {
  @IsOptional() @IsIn(['ouvert', 'traite', 'rejete'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(40)
  reason?: string;
}

export class AdminResolveReportDto {
  @IsIn(['traite', 'rejete'])
  status: 'traite' | 'rejete';

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  /** Action associée, optionnelle. */
  @IsOptional() @IsIn(['aucune', 'retirer_annonce', 'suspendre_utilisateur', 'retirer_et_suspendre'])
  action?: 'aucune' | 'retirer_annonce' | 'suspendre_utilisateur' | 'retirer_et_suspendre';
}

export class AdminTransactionsQueryDto extends AdminPaginationDto {
  @IsOptional() @IsIn(['en_attente', 'sequestre', 'livree', 'confirme', 'litige', 'rembourse', 'annulee'])
  status?: string;

  /** « 1 » : séquestres non résolus dont la date limite de capture approche (filet de sécurité, AUDIT §37). */
  @IsOptional() @IsIn(['1'])
  due?: string;
}

export class AdminResolveTransactionDto {
  /** rembourser (annulation de l'autorisation ou remboursement), liberer (capture, vendeur payé), annuler (vente annulée avant envoi, acheteur remboursé) */
  @IsIn(['rembourser', 'liberer', 'annuler'])
  decision: 'rembourser' | 'liberer' | 'annuler';

  @IsString() @MinLength(5) @MaxLength(1000)
  note: string;
}

/** Suppressions définitives : motif obligatoire et confirmation explicite (le mot SUPPRIMER saisi dans l'interface). */
export class AdminHardDeleteDto {
  @IsString() @MinLength(5) @MaxLength(500)
  reason: string;

  @IsIn(['SUPPRIMER'])
  confirm: 'SUPPRIMER';
}

export class AdminAuditQueryDto extends AdminPaginationDto {
  @IsOptional() @IsString() @MaxLength(36)
  admin_id?: string;

  @IsOptional() @IsString() @MaxLength(36)
  target_id?: string;

  @IsOptional() @IsString() @MaxLength(60)
  action?: string;
}

export class AdminSettingsDto {
  @IsOptional() @IsBoolean()
  monetization_enabled?: boolean;

  @IsOptional() @Transform(toNumber) @IsInt() @Min(1) @Max(1000)
  free_listings_per_30_days?: number;

  @IsOptional() @Transform(toNumber) @Min(0) @Max(1000)
  boost_price_eur?: number;

  @IsOptional() @Transform(toNumber) @Min(0) @Max(1000)
  urgent_price_eur?: number;

  // Barème du paiement sécurisé (AUDIT §51) : bornes larges mais finies, deux décimales au plus
  @IsOptional() @Transform(toNumber) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(30)
  commission_percent?: number;

  @IsOptional() @Transform(toNumber) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(30)
  buyer_fee_percent?: number;

  @IsOptional() @Transform(toNumber) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(20)
  buyer_fee_fixed_eur?: number;

  @IsOptional() @Transform(toNumber) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(500)
  buyer_fee_cap_eur?: number;
}

export class AdminPlanDto {
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{2,40}$/)
  slug?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(60)
  name?: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @Transform(toNumber) @Min(0) @Max(10000)
  priceMonthly?: number;

  /** null = illimité */
  @IsOptional() @Transform(({ value }) => (value === null || value === '' ? null : Number(value)))
  listingsIncluded?: number | null;

  @IsOptional() @Transform(({ value }) => (value === null || value === '' ? null : Number(value)))
  boostsIncluded?: number | null;

  @IsOptional() @IsBoolean()
  advancedStats?: boolean;

  @IsOptional() @IsBoolean()
  verifiedBadge?: boolean;

  @IsOptional() @IsBoolean()
  customShop?: boolean;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @Transform(toNumber) @IsInt() @Min(0) @Max(100)
  sortOrder?: number;
}

export class AdminPageDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  title?: string;

  @IsOptional() @IsString() @MaxLength(50000)
  content?: string;

  @IsOptional() @IsBoolean()
  published?: boolean;
}
