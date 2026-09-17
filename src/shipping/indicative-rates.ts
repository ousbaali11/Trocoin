import { ShippingCarrier, ShippingMode } from './shipping-provider.interface';

/**
 * Grille indicative des transporteurs proposés par Trocoin (ordre de grandeur des grilles publiques 2026 pour un
 * particulier, par tranche de poids, en centimes). Sert au fournisseur simulé et à l'estimation affichée sur une
 * fiche dont le vendeur a déclaré le poids du colis (AUDIT §52) : jamais un prix ferme, toujours une fourchette.
 */
export const INDICATIVE_GRID: Record<`${ShippingCarrier}:${ShippingMode}`, Array<[maxGrams: number, cents: number]>> = {
  'colissimo:domicile': [[250, 495], [500, 645], [750, 725], [1000, 795], [2000, 895], [5000, 1385], [10000, 2035], [30000, 2965]],
  'colissimo:point_relais': [[250, 445], [500, 595], [750, 665], [1000, 735], [2000, 825], [5000, 1285], [10000, 1890], [30000, 2750]],
  'mondial_relay:point_relais': [[500, 449], [1000, 549], [2000, 699], [3000, 799], [5000, 999], [10000, 1299], [30000, 1999]],
  'mondial_relay:domicile': [],
};

/** Délai de transport annoncé par transporteur, en jours (Colissimo J+2, Mondial Relay 3 à 5 jours : 4 retenu). */
export const TRANSIT_DAYS: Record<ShippingCarrier, number> = { colissimo: 2, mondial_relay: 4 };

export const MAX_PARCEL_GRAMS = 30000;

export interface ShippingEstimate {
  /** Offre la moins chère et la plus chère de la grille pour ce poids, en centimes. */
  minCents: number;
  maxCents: number;
  weightGrams: number;
}

/** Fourchette de prix d'envoi pour un poids déclaré ; null si le poids est absent, nul ou hors grille (> 30 kg). */
export function estimateShipping(weightGrams?: number | null): ShippingEstimate | null {
  if (!weightGrams || weightGrams <= 0 || weightGrams > MAX_PARCEL_GRAMS) return null;
  const prices = Object.values(INDICATIVE_GRID)
    .map((rows) => rows.find(([max]) => weightGrams <= max)?.[1])
    .filter((c): c is number => typeof c === 'number');
  if (prices.length === 0) return null;
  return { minCents: Math.min(...prices), maxCents: Math.max(...prices), weightGrams };
}
