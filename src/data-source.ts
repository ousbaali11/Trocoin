import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

loadEnv();

/**
 * Source de données partagée entre l'application (app.module.ts) et la CLI
 * TypeORM (npm run migration:generate / migration:run).
 *
 * - En développement : SQLite + synchronize (pratique, jamais en prod).
 * - En production : synchronize est désactivé et les migrations de
 *   src/migrations sont exécutées au démarrage (migrationsRun).
 *
 * IMPORTANT : les migrations doivent être générées contre la base cible
 * (DB_TYPE=postgres) avant le premier déploiement — un fichier généré
 * contre SQLite n'est pas valable pour PostgreSQL.
 */
export function buildDataSourceOptions(env: Record<string, unknown> = process.env): DataSourceOptions {
  const isProd = env.NODE_ENV === 'production';
  const common = {
    entities: [__dirname + '/**/*.entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    synchronize: !isProd && env.DB_SYNCHRONIZE !== 'false',
    migrationsRun: isProd || env.DB_MIGRATIONS_RUN === 'true',
    logging: env.DB_LOGGING === 'true',
    // Taille du pool (offres gratuites : peu de connexions ; PGlite en test : 1)
    extra: env.DB_POOL_MAX ? { max: Number(env.DB_POOL_MAX) } : undefined,
  };

  if (env.DB_TYPE === 'postgres') {
    // DATABASE_URL (Render, Railway, Neon, Supabase…) a priorité sur les variables séparées.
    const url = env.DATABASE_URL as string | undefined;
    return {
      type: 'postgres',
      ...(url
        ? { url }
        : {
            host: (env.DB_HOST as string) || 'localhost',
            port: env.DB_PORT ? Number(env.DB_PORT) : 5432,
            username: env.DB_USERNAME as string,
            password: env.DB_PASSWORD as string,
            database: env.DB_NAME as string,
          }),
      ssl: env.DB_SSL === 'true' || (url && /sslmode=require/.test(url)) ? { rejectUnauthorized: false } : undefined,
      // gen_random_uuid() (pgcrypto / natif ≥ PG13) plutôt que uuid-ossp
      uuidExtension: 'pgcrypto',
      ...common,
    };
  }

  return {
    type: 'sqlite',
    database: (env.DB_PATH as string) || './data/dev.sqlite',
    ...common,
  };
}

export default new DataSource(buildDataSourceOptions());
