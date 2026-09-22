/**
 * Résultat du dernier balayage des comptes de versement (AUDIT §67) : comptes vérifiés chez le prestataire, comptes
 * orphelins remis à zéro (identifiant d'un autre environnement, compte effacé). Exposé par `/health`, sans identifiant.
 */
export interface PayoutSweep {
  lastRunAt: string | null;
  checked: number;
  reset: number;
  unreachable: number;
}

export const payoutSweep: PayoutSweep = { lastRunAt: null, checked: 0, reset: 0, unreachable: 0 };
