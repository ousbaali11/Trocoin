/**
 * Un seul et unique format accepté sur toute la plateforme :
 * mobile français, au format international +33 6/7 XX XX XX XX
 * Toute autre origine (indicatif étranger) est rejetée.
 */
export const FRENCH_MOBILE_REGEX = /^\+33[67]\d{8}$/;

export function isFrenchMobileNumber(value: string): boolean {
  return typeof value === 'string' && FRENCH_MOBILE_REGEX.test(value);
}

/**
 * Normalise les saisies courantes (06 12 34 56 78, 0612345678,
 * 33612345678...) vers le format canonique +33612345678.
 * Retourne null si la saisie ne correspond à aucun format mobile FR connu.
 */
export function normalizeFrenchMobile(raw: string): string | null {
  const cleaned = raw.replace(/[\s.\-()]/g, '');

  if (FRENCH_MOBILE_REGEX.test(cleaned)) return cleaned;

  if (/^0[67]\d{8}$/.test(cleaned)) {
    return '+33' + cleaned.slice(1);
  }

  if (/^33[67]\d{8}$/.test(cleaned)) {
    return '+' + cleaned;
  }

  if (/^0033[67]\d{8}$/.test(cleaned)) {
    return '+' + cleaned.slice(2);
  }

  return null;
}
