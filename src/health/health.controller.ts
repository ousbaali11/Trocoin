import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

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
    return { status: 'ok', database: this.dataSource.options.type, uptimeSeconds: Math.round(process.uptime()), version: process.env.APP_VERSION || 'dev' };
  }
}
