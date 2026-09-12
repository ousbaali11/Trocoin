/**
 * Sentry : activé uniquement si SENTRY_DSN est défini (sinon aucune
 * dépendance réseau). Doit être importé AVANT NestFactory (voir main.ts).
 * Capture : exceptions non gérées, erreurs 5xx remontées par le filtre
 * global, avec l'environnement et la version.
 */
import * as Sentry from '@sentry/nestjs';

export const SENTRY_ENABLED = !!process.env.SENTRY_DSN;

if (SENTRY_ENABLED) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.APP_VERSION || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05),
    sendDefaultPii: false, // jamais de numéro de téléphone ni d'IP par défaut
    beforeSend(event) {
      // Filtre défensif : pas de corps de requête (peut contenir un code OTP)
      if (event.request) delete event.request.data;
      return event;
    },
  });
}

export { Sentry };
