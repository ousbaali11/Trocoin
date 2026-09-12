/**
 * Validation des variables d'environnement au démarrage.
 * Objectif : impossible de démarrer en production avec une configuration
 * dangereuse (secret JWT par défaut, CORS ouvert, endpoints de dev actifs).
 */
export const DEFAULT_DEV_JWT_SECRET = 'dev-only-secret-ne-pas-utiliser-en-production';
const WEAK_SECRETS = new Set([
  'change-moi-en-production',
  'changeme',
  'secret',
  DEFAULT_DEV_JWT_SECRET,
]);

export function isProduction(env: Record<string, unknown> = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const prod = isProduction(env);

  const secret = (env.JWT_SECRET as string | undefined)?.trim();
  if (prod) {
    if (!secret) errors.push('JWT_SECRET est obligatoire en production.');
    else if (secret.length < 32) errors.push('JWT_SECRET doit faire au moins 32 caractères en production.');
    else if (WEAK_SECRETS.has(secret)) errors.push('JWT_SECRET utilise une valeur par défaut connue.');

    if (!env.CORS_ORIGINS) errors.push("CORS_ORIGINS est obligatoire en production (liste d'origines séparées par des virgules).");
    if ((env.SMS_PROVIDER || 'mock') === 'mock') errors.push('SMS_PROVIDER=mock est interdit en production (les codes OTP seraient exposés dans les logs).');
    if ((env.PAYMENT_PROVIDER || 'mock') === 'mock') errors.push('PAYMENT_PROVIDER=mock est interdit en production.');
    if ((env.NOTIFICATION_PROVIDER || 'mock') === 'mock') errors.push('NOTIFICATION_PROVIDER=mock est interdit en production.');
    if (env.DB_TYPE !== 'postgres') errors.push('DB_TYPE doit valoir "postgres" en production.');
    if (env.THROTTLE_DISABLED === 'true') errors.push('THROTTLE_DISABLED=true est interdit en production.');
  }

  if (env.PAYMENT_PROVIDER === 'stripe' && !env.STRIPE_SECRET_KEY) {
    errors.push('STRIPE_SECRET_KEY est requis quand PAYMENT_PROVIDER=stripe.');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration invalide :\n - ${errors.join('\n - ')}`);
  }

  return env;
}

/** Secret JWT effectif : jamais de valeur par défaut en production (bloqué par validateEnv). */
export function resolveJwtSecret(env: Record<string, unknown> = process.env): string {
  const secret = (env.JWT_SECRET as string | undefined)?.trim();
  if (secret && !WEAK_SECRETS.has(secret)) return secret;
  if (isProduction(env)) throw new Error('JWT_SECRET invalide en production.');
  return DEFAULT_DEV_JWT_SECRET;
}

/** Liste blanche CORS. En dev, par défaut : le front Next.js local et la page de test. */
export function resolveCorsOrigins(env: Record<string, unknown> = process.env): string[] {
  const raw = (env.CORS_ORIGINS as string | undefined) || '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length > 0) return list;
  if (isProduction(env)) return [];
  const port = env.PORT || 3000;
  return [`http://localhost:${port}`, 'http://localhost:3001', 'http://127.0.0.1:3001'];
}
