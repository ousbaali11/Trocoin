import { FieldSchema } from '../categories/category-schemas';

/**
 * « Fiche complète » : badge attribué automatiquement quand une annonce donne
 * toutes les informations qu'un acheteur attend, sans intervention humaine.
 *
 * Valeur : sur une voiture ou un logement, l'acheteur ne devrait pas avoir à
 * demander l'année, le kilométrage ou la surface par message. Le badge
 * récompense les vendeurs qui remplissent tout, et le score guide le dépôt.
 *
 * Règles (identiques côté formulaire de dépôt, voir frontend ListingForm) :
 *  - au moins 3 photos ;
 *  - description d'au moins 120 caractères ;
 *  - prix renseigné quand le type de prix l'exige ;
 *  - tous les champs de la catégorie renseignés (obligatoires ET facultatifs),
 *    avec des valeurs cohérentes (bornes du schéma, année ≤ année courante).
 */
export interface Completeness {
  complete: boolean;
  /** 0–100 */
  score: number;
  /** Ce qu'il reste à faire, en français, prêt à afficher. */
  missing: string[];
}

export const MIN_PHOTOS = 3;
export const MIN_DESCRIPTION = 120;

interface ListingLike {
  description?: string | null;
  price?: number | null;
  priceType?: string | null;
  attributes?: Record<string, unknown> | null;
}

export function computeCompleteness(listing: ListingLike, photosCount: number, schema: FieldSchema[]): Completeness {
  const missing: string[] = [];
  let score = 0;

  // Photos : 30 points (10 par photo jusqu'à 3)
  score += Math.min(photosCount, MIN_PHOTOS) * 10;
  if (photosCount < MIN_PHOTOS) missing.push(photosCount === 0 ? `Ajouter ${MIN_PHOTOS} photos` : `Ajouter ${MIN_PHOTOS - photosCount} photo${MIN_PHOTOS - photosCount > 1 ? 's' : ''} (${MIN_PHOTOS} minimum)`);

  // Description : 20 points
  const descLen = (listing.description || '').trim().length;
  if (descLen >= MIN_DESCRIPTION) score += 20;
  else {
    score += Math.round((descLen / MIN_DESCRIPTION) * 20);
    missing.push(`Description d'au moins ${MIN_DESCRIPTION} caractères (${descLen} actuellement)`);
  }

  // Prix : 10 points (acquis d'office si le type de prix n'exige pas de montant)
  const needsPrice = ['fixe', 'negociable'].includes(listing.priceType || 'fixe');
  if (!needsPrice || (listing.price !== null && listing.price !== undefined && listing.price >= 0)) score += 10;
  else missing.push('Indiquer un prix');

  // Champs de la catégorie : 40 points répartis
  const currentYear = new Date().getFullYear();
  if (schema.length === 0) score += 40;
  else {
    const attrs = listing.attributes || {};
    // Les cases à cocher (booléens) ne comptent pas : non cochée = « non », pas « inconnu ».
    const counted = schema.filter((f) => f.type !== 'boolean');
    const per = counted.length ? 40 / counted.length : 0;
    if (!counted.length) score += 40;
    const empty: string[] = [];
    const incoherent: string[] = [];
    for (const f of counted) {
      const v = attrs[f.key];
      const filled = v !== undefined && v !== null && String(v).trim() !== '';
      if (!filled) { empty.push(f.label); continue; }
      let ok = true;
      if (f.type === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) ok = false;
        if (f.min !== undefined && n < f.min) ok = false;
        if (f.max !== undefined && n > f.max) ok = false;
        if (/^annee/.test(f.key) && n > currentYear) ok = false;
      }
      if (f.type === 'select' && f.options && !f.options.includes(String(v))) ok = false;
      if (ok) score += per;
      else incoherent.push(f.label);
    }
    if (empty.length) missing.push(`Renseigner : ${empty.join(', ')}`);
    if (incoherent.length) missing.push(`Vérifier la valeur de : ${incoherent.join(', ')}`);
  }

  const rounded = Math.min(100, Math.round(score));
  return { complete: missing.length === 0, score: missing.length === 0 ? 100 : Math.min(rounded, 99), missing };
}
