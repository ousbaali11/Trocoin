import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Version lue dans package.json à l'exécution (pas d'import JSON : il déplacerait la sortie de tsc hors de dist/). */
const packageVersion: string = (() => {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')).version || 'dev';
  } catch {
    return 'dev';
  }
})();

/**
 * Région de la base PostgreSQL déduite de l'hôte (Neon : `…<region>.aws.neon.tech`), sans exposer
 * l'hôte ni les identifiants. Sert à vérifier une bascule de base depuis l'extérieur.
 */
export function databaseRegion(env: Record<string, unknown> = process.env): string | undefined {
  const url = env.DATABASE_URL as string | undefined;
  const host = url ? (() => { try { return new URL(url).hostname; } catch { return undefined; } })() : (env.DB_HOST as string | undefined);
  if (!host) return undefined;
  const neon = host.match(/\.([a-z]{2}-[a-z]+-\d)\.aws\.neon\.tech$/);
  if (neon) return neon[1];
  if (/^(localhost|127\.0\.0\.1)$/.test(host)) return 'local';
  return 'autre';
}

/**
 * Sonde de santé pour l'hébergeur (Render / Railway / Kubernetes) et le
 * monitoring : vérifie que la base répond. Pas d'information sensible.
 */
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  @Get()
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    }
    return {
      status: 'ok',
      database: this.dataSource.options.type,
      databaseRegion: this.dataSource.options.type === 'postgres' ? databaseRegion() : undefined,
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.APP_VERSION || packageVersion,
    };
  }
}
