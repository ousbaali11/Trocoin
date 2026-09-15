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
    if (env.SHIPPING_PROVIDER === 'mock') errors.push("SHIPPING_PROVIDER=mock est interdit en production (utilisez \"none\" tant qu'aucun compte prestataire n'est ouvert : le vendeur saisit son numéro de suivi).");
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

  // Stockage objet : clés vérifiées au démarrage (S3_PUBLIC_URL facultative : sans elle, l'API relaie les fichiers). Noms exacts attendus :
  if (env.STORAGE_PROVIDER === 's3') {
    const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
    if (missing.length) errors.push(`STORAGE_PROVIDER=s3 : variables manquantes ${missing.join(', ')}.`);
  } else if (env.STORAGE_PROVIDER && env.STORAGE_PROVIDER !== 'local') {
    errors.push(`STORAGE_PROVIDER="${env.STORAGE_PROVIDER}" inconnu (valeurs : local, s3).`);
  }
  if (env.SHIPPING_PROVIDER && !['mock', 'none'].includes(String(env.SHIPPING_PROVIDER))) errors.push('SHIPPING_PROVIDER : valeurs mock ou none (boxtal : phase 2, après les clés de test).');
  if (env.REDIS_URL && !/^rediss?:\/\//.test(String(env.REDIS_URL))) errors.push('REDIS_URL doit commencer par redis:// ou rediss://.');
  if (env.SIRENE_PROVIDER && !['api', 'mock', 'none'].includes(String(env.SIRENE_PROVIDER))) errors.push('SIRENE_PROVIDER : valeurs api, mock ou none.');
  if (prod && env.SIRENE_PROVIDER === 'mock') errors.push('SIRENE_PROVIDER=mock est interdit en production.');

  if (env.PAYMENT_PROVIDER === 'stripe' && !env.STRIPE_SECRET_KEY) {
    errors.push('STRIPE_SECRET_KEY est requis quand PAYMENT_PROVIDER=stripe.');
  }
  if (env.PAYMENT_PROVIDER === 'stripe' && !env.STRIPE_WEBHOOK_SECRET) {
    errors.push('STRIPE_WEBHOOK_SECRET est requis quand PAYMENT_PROVIDER=stripe (signature des webhooks, Stripe → Developers → Webhooks).');
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

/** Domaine public du site depuis le 15 septembre 2026 (www est la version canonique, trocoin.fr y redirige). */
export const CANONICAL_SITE_URL = 'https://www.trocoin.fr';
/** Origines toujours autorisées en production, en plus de CORS_ORIGINS (qui peut garder l'ancienne adresse Vercel en secours). */
export const PRODUCTION_ORIGINS = ['https://www.trocoin.fr', 'https://trocoin.fr'];
/** Anciens hébergeurs : jamais l'adresse publique du site (liens des e-mails et canoniques doivent pointer vers trocoin.fr). */
const LEGACY_HOSTS = /\.(vercel\.app|onrender\.com)$/i;

/** Liste blanche CORS. En production : trocoin.fr et www.trocoin.fr toujours inclus, plus CORS_ORIGINS. En dev, par défaut : le front Next.js local et la page de test. */
export function resolveCorsOrigins(env: Record<string, unknown> = process.env): string[] {
  const raw = (env.CORS_ORIGINS as string | undefined) || '';
  const list = raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (isProduction(env)) return [...new Set([...PRODUCTION_ORIGINS, ...list])];
  if (list.length > 0) return list;
  const port = env.PORT || 3000;
  return [`http://localhost:${port}`, 'http://localhost:3001', 'http://127.0.0.1:3001'];
}

/** URL publique du site (liens des e-mails, retours de paiement) : SITE_URL, sinon la première origine CORS qui n'est pas l'API elle-même, sinon le front local. */
export function resolveSiteUrl(env: Record<string, unknown> = process.env): string {
  const explicit = (env.SITE_URL as string | undefined)?.trim().replace(/\/$/, '');
  if (isProduction(env)) {
    // Une SITE_URL absente ou encore sur un ancien hébergeur (vercel.app, onrender.com) → domaine canonique
    if (!explicit) return CANONICAL_SITE_URL;
    let host = '';
    try {
      host = new URL(explicit).hostname;
    } catch {
      return CANONICAL_SITE_URL;
    }
    return LEGACY_HOSTS.test(host) ? CANONICAL_SITE_URL : explicit;
  }
  if (explicit) return explicit;
  const cors = resolveCorsOrigins(env).filter((o) => !/localhost:3000$/.test(o));
  return (cors[0] || 'http://localhost:3001').replace(/\/$/, '');
}
