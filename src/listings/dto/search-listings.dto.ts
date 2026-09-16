import { Transform } from 'class-transformer';
import {
  IsBooleanString,
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
} from 'class-validator';
import { CONDITIONS } from '../listing.entity';

const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

export const SORTS = ['recent', 'oldest', 'price_asc', 'price_desc', 'distance', 'relevance'] as const;
export type SortKey = (typeof SORTS)[number];

/**
 * Paramètres de recherche (query string). Tout est optionnel et validé :
 * un paramètre mal formé renvoie 400 plutôt qu'un NaN en SQL.
 */
export class SearchListingsDto {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{2,60}$/)
  category?: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @Matches(/^\d{2,5}$/)
  postal_code?: string; // préfixe accepté : "69" = tout le Rhône

  @IsOptional() @IsString() @Matches(/^[a-z-]{2,40}$/)
  region?: string; // identifiant de région (france-admin.ts), ex. "auvergne-rhone-alpes"

  @IsOptional() @Transform(toNumber) @IsNumber() @Min(0)
  price_min?: number;

  @IsOptional() @Transform(toNumber) @IsNumber() @Min(0)
  price_max?: number;

  @IsOptional() @IsUUID()
  seller?: string;

  @IsOptional() @IsIn(['particulier', 'professionnel'])
  seller_type?: 'particulier' | 'professionnel';

  @IsOptional() @IsIn(CONDITIONS, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  condition?: string[];

  @IsOptional() @IsBooleanString()
  delivery?: string; // "true"

  /** « Étendre à la livraison » : en plus des annonces autour du lieu choisi, celles livrables partout en France. */
  @IsOptional() @IsBooleanString()
  delivery_anywhere?: string; // "true"

  @IsOptional() @IsBooleanString()
  with_photo?: string; // "true"

  @IsOptional() @IsBooleanString()
  urgent?: string; // "true" : annonces marquées urgentes uniquement

  @IsOptional() @IsIn(['fixe', 'negociable', 'gratuit', 'echange', 'sur_demande'])
  price_type?: string; // filtre rapide « Dons » (gratuit) / « Échanges » (echange)

  @IsOptional() @Transform(toNumber) @IsInt() @Min(1) @Max(365)
  since_days?: number;

  @IsOptional() @Transform(toNumber) @IsLatitude()
  lat?: number;

  @IsOptional() @Transform(toNumber) @IsLongitude()
  lng?: number;

  @IsOptional() @Transform(toNumber) @IsInt() @Min(1) @Max(500)
  radius?: number; // km

  @IsOptional() @IsIn(SORTS)
  sort?: SortKey;

  @IsOptional() @Transform(toNumber) @IsInt() @Min(1) @Max(1000)
  page?: number;

  @IsOptional() @Transform(toNumber) @IsInt() @Min(1) @Max(50)
  page_size?: number;

  /** Filtres spécifiques à la catégorie : attr.marque=Peugeot&attr.annee_min=2015 */
  [key: `attr.${string}`]: string | undefined;
}
