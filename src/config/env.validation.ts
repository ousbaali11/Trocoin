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
    if ((env.PAYMENT_PROVIDER || 'mock') === 'mock') errors.push('PAYMENT_PROVIDER=mock est interdit en production (utilisez "disabled" tant que Stripe/PayPal ne sont pas configurés).');
    if ((env.NOTIFICATION_PROVIDER || 'mock') === 'mock') errors.push('NOTIFICATION_PROVIDER=mock est interdit en production (utilisez "none" : notifications in-app uniquement).');
    if (env.DB_TYPE !== 'postgres') errors.push('DB_TYPE doit valoir "postgres" en production.');
    if (env.THROTTLE_DISABLED === 'true') errors.push('THROTTLE_DISABLED=true est interdit en production.');
    if (env.EMAIL_PROVIDER === 'mock') errors.push('EMAIL_PROVIDER=mock est interdit en production (utilisez "none" tant qu\'aucun fournisseur n\'est configuré : la réinitialisation par e-mail répondra 503 et l\'admin pourra réinitialiser).');
  }

  // Fournisseur SMS réel : les identifiants doivent être présents dès le démarrage,
  // sinon chaque inscription échouerait en 503. Noms exacts attendus :
  const smsRequired: Record<string, string[]> = {
    vonage: ['VONAGE_API_KEY', 'VONAGE_API_SECRET', 'SMS_SENDER'],
    twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
  };
  const smsProvider = (env.SMS_PROVIDER as string | undefined) || 'mock';
  if (smsProvider !== 'mock') {
    const required = smsRequired[smsProvider];
    if (!required) errors.push(`SMS_PROVIDER="${smsProvider}" inconnu (valeurs : mock, vonage, twilio).`);
    else {
      const missing = required.filter((k) => !env[k]);
      if (missing.length) errors.push(`SMS_PROVIDER=${smsProvider} : variables manquantes ${missing.join(', ')}.`);
    }
  }

  // Fournisseur e-mail réel : clés vérifiées au démarrage. Noms exacts attendus :
  const emailRequired: Record<string, string[]> = {
    resend: ['RESEND_API_KEY', 'EMAIL_FROM'],
    brevo: ['BREVO_API_KEY', 'EMAIL_FROM'],
  };
  const emailProvider = (env.EMAIL_PROVIDER as string | undefined) || (prod ? 'none' : 'mock');
  if (!['mock', 'none'].includes(emailProvider)) {
    const required = emailRequired[emailProvider];
    if (!required) errors.push(`EMAIL_PROVIDER="${emailProvider}" inconnu (valeurs : mock, none, resend, brevo).`);
    else {
      const missing = required.filter((k) => !env[k]);
      if (missing.length) errors.push(`EMAIL_PROVIDER=${emailProvider} : variables manquantes ${missing.join(', ')}.`);
    }
  }

  // Stockage objet : clés vérifiées au démarrage. Noms exacts attendus :
  if (env.STORAGE_PROVIDER === 's3') {
    const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'].filter((k) => !env[k]);
    if (missing.length) errors.push(`STORAGE_PROVIDER=s3 : variables manquantes ${missing.join(', ')}.`);
  } else if (env.STORAGE_PROVIDER && env.STORAGE_PROVIDER !== 'local') {
    errors.push(`STORAGE_PROVIDER="${env.STORAGE_PROVIDER}" inconnu (valeurs : local, s3).`);
  }
  if (env.REDIS_URL && !/^rediss?:\/\//.test(String(env.REDIS_URL))) errors.push('REDIS_URL doit commencer par redis:// ou rediss://.');
  if (env.SIRENE_PROVIDER && !['api', 'mock', 'none'].includes(String(env.SIRENE_PROVIDER))) errors.push('SIRENE_PROVIDER : valeurs api, mock ou none.');
  if (prod && env.SIRENE_PROVIDER === 'mock') errors.push('SIRENE_PROVIDER=mock est interdit en production.');

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
