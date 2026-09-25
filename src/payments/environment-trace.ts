/**
 * Empreinte de l'environnement du prestataire de paiement (AUDIT §73) : après un changement de clés (autre bac à sable,
 * passage en mode réel), tout identifiant enregistré avant (paiement, virement, compte de versement) devient inconnu du
 * prestataire et échoue plus tard, en silence. L'empreinte (compte plateforme + mode) est comparée au démarrage à celle
 * mémorisée en base ; si elle a changé, les ventes ouvertes sont vérifiées tout de suite et l'administration prévenue.
 * Exposée par `/health` sans identifiant complet (4 derniers caractères).
 */
export interface PaymentEnvironmentTrace {
  checkedAt: string | null;
  accountLast4: string | null;
  livemode: boolean | null;
  /** Date à laquelle un changement d'environnement a été constaté (null : jamais, ou même environnement qu'avant). */
  changedAt: string | null;
  previousLast4: string | null;
  sweep: { checked: number; flagged: number; at: string } | null;
  error: string | null;
}

export const paymentEnvironmentTrace: PaymentEnvironmentTrace = { checkedAt: null, accountLast4: null, livemode: null, changedAt: null, previousLast4: null, sweep: null, error: null };

export const PAYMENT_ENVIRONMENT_KEY = 'payments.provider_environment';
