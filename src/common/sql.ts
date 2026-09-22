/** Échappe les jokers d'un motif LIKE (AUDIT §69 : la recherche de la console ne les échappait pas — « _ » renvoyait tout). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
