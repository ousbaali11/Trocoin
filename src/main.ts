import 'reflect-metadata';
import { SENTRY_ENABLED } from './monitoring/sentry';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { isProduction, resolveCorsOrigins } from './config/env.validation';
import { databaseRegion } from './health/health.controller';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const corsOrigins = resolveCorsOrigins();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Corps brut conservé (req.rawBody) : indispensable pour vérifier la signature des webhooks Stripe
    rawBody: true,
    cors: {
      origin: (origin, cb) => {
        // Requêtes sans en-tête Origin (curl, apps natives, même origine) : autorisées.
        // Navigateurs : uniquement la liste blanche CORS_ORIGINS.
        if (!origin || corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origine non autorisée par CORS : ${origin}`), false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    },
  });

  app.use(
    helmet({
      // Les photos sont servies par cette API et affichées par le front (autre origine)
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: isProduction() ? undefined : false,
    }),
  );
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') {
    // Indispensable derrière un reverse proxy pour que le rate limiting voie la vraie IP
    app.set('trust proxy', 1);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Photos uploadées. En production : S3/OVH Object Storage + CDN plutôt que le disque local.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    setHeaders: (res) => {
      // Jamais d'interprétation par le navigateur : fichiers inertes uniquement
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
    },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`API Trocoin démarrée sur http://localhost:${port} (env=${process.env.NODE_ENV || 'development'})`);
  logger.log(`Base de données : ${process.env.DB_TYPE || 'sqlite'}${process.env.DB_TYPE === 'postgres' ? ` · région ${databaseRegion() ?? 'inconnue'}` : ''}`);
  logger.log(`Monitoring Sentry : ${SENTRY_ENABLED ? "actif" : "désactivé (SENTRY_DSN absent)"}`);
  logger.log(`CORS autorisé pour : ${corsOrigins.join(', ') || '(aucune origine navigateur)'}`);
}
bootstrap();
