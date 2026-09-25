/**
 * Trace en mémoire des derniers webhooks du prestataire de paiement (AUDIT §66) : ce que l'API a reçu, accepté ou
 * refusé, et pourquoi — exposée par `/health` (jamais de secret ni de contenu d'évènement) pour diagnostiquer une
 * livraison de webhook sans accès aux journaux de l'hébergeur. Perdue au redémarrage, ce qui suffit au diagnostic.
 */
export interface WebhookTrace {
  received: number;
  accepted: number;
  rejected: number;
  lastReceivedAt: string | null;
  lastType: string | null;
  /** Évènement d'un compte connecté : identifiant du compte concerné (acct_…), jamais son contenu. */
  lastAccountId: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** AUDIT §74 : livraisons répétées d'un évènement déjà traité (ignorées, réponse 200). */
  duplicates: number;
}

export const webhookTrace: WebhookTrace = { received: 0, accepted: 0, rejected: 0, lastReceivedAt: null, lastType: null, lastAccountId: null, lastError: null, lastErrorAt: null, duplicates: 0 };

export function traceWebhookDuplicate(): void {
  webhookTrace.duplicates += 1;
}

export function traceWebhookAccepted(type: string, accountId?: string): void {
  webhookTrace.received += 1;
  webhookTrace.accepted += 1;
  webhookTrace.lastReceivedAt = new Date().toISOString();
  webhookTrace.lastType = type;
  webhookTrace.lastAccountId = accountId ?? null;
}

/** Forme d'un secret de signature, sans en révéler la valeur : « ok », « espaces » (à nettoyer) ou « inattendu » (pas un whsec_). */
export function describeSecret(value: string | undefined): 'absent' | 'ok' | 'espaces' | 'inattendu' {
  if (!value) return 'absent';
  if (/\s/.test(value)) return 'espaces';
  return /^whsec_[A-Za-z0-9]{16,}$/.test(value) ? 'ok' : 'inattendu';
}

/** Nombre de signatures v1 présentes dans l'en-tête reçu (0 = en-tête absent ou d'une autre forme). */
export function countSignatures(header: string | undefined): number {
  return (header || '').split(',').filter((p) => p.trim().startsWith('v1=')).length;
}

export function traceWebhookRejected(reason: string): void {
  webhookTrace.received += 1;
  webhookTrace.rejected += 1;
  webhookTrace.lastReceivedAt = new Date().toISOString();
  webhookTrace.lastError = reason.slice(0, 200);
  webhookTrace.lastErrorAt = webhookTrace.lastReceivedAt;
}
