/**
 * Numéro de téléphone français pour une étiquette (AUDIT §55) : les transporteurs l'exigent pour l'expéditeur et
 * pour le destinataire. Accepte les écritures courantes (« 06 12 34 56 78 », « 06.12.34.56.78 », « +33 6 12 34 56 78 »,
 * « 0033612345678 ») et rend la forme internationale attendue par les prestataires, ou null si ce n'en est pas un.
 */
export function normalizeFrenchPhone(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('0033')) digits = `+33${digits.slice(4)}`;
  if (digits.startsWith('+33')) digits = `0${digits.slice(3)}`;
  return /^0[1-9]\d{8}$/.test(digits) ? `+33${digits.slice(1)}` : null;
}
