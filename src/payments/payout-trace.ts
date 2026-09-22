/**
 * Trace en mémoire des virements aux vendeurs (AUDIT §70) : tentatives, virements créés, virements déjà présents chez le
 * prestataire et réutilisés, conflits de clé d'idempotence, dernière erreur — exposée par `/health` (sans montant ni
 * identifiant de membre) pour suivre un virement bloqué sans accès aux journaux de l'hébergeur.
 */
export interface PayoutTrace {
  attempts: number;
  created: number;
  reused: number;
  keyConflicts: number;
  failed: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastTransferAt: string | null;
}

export const payoutTrace: PayoutTrace = { attempts: 0, created: 0, reused: 0, keyConflicts: 0, failed: 0, lastError: null, lastErrorAt: null, lastTransferAt: null };

export function tracePayoutError(message: string): void {
  payoutTrace.failed += 1;
  payoutTrace.lastError = message.slice(0, 200);
  payoutTrace.lastErrorAt = new Date().toISOString();
}
