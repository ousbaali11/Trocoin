import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveSiteUrl } from '../config/env.validation';
import { describeSecret, webhookTrace } from '../payments/webhook-trace';
import { payoutSweep } from '../users/payout-sweep';
import { payoutTrace } from '../payments/payout-trace';

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

  /** Comptage mis en cache 60 s : la sonde est appelée toutes les 30 s par plusieurs superviseurs (AUDIT §69). */
  private issuesCache: { at: number; n: number } | null = null;
  /** Virements aux vendeurs en attente (vente confirmée, fonds encaissés, aucune référence de virement) — cache 60 s (AUDIT §70). */
  private pendingCache: { at: number; n: number } | null = null;
  private async pendingPayoutsCount(): Promise<number> {
    if (this.pendingCache && Date.now() - this.pendingCache.at < 60_000) return this.pendingCache.n;
    const n = Number((await this.dataSource.query(`SELECT COUNT(*) AS n FROM transactions WHERE status = 'confirme' AND "escrowModel" = 'platform' AND "capturedAt" IS NOT NULL AND "paymentIssue" IS NULL AND ("transferId" IS NULL OR "transferId" LIKE 'en-cours:%')`))[0]?.n ?? 0);
    this.pendingCache = { at: Date.now(), n };
    return n;
  }
  private async paymentIssuesCount(): Promise<number> {
    if (this.issuesCache && Date.now() - this.issuesCache.at < 60_000) return this.issuesCache.n;
    const n = Number((await this.dataSource.query('SELECT COUNT(*) AS n FROM transactions WHERE "paymentIssue" IS NOT NULL'))[0]?.n ?? 0);
    this.issuesCache = { at: Date.now(), n };
    return n;
  }

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
      // Base des liens envoyés par e-mail (confirmation, mot de passe, changement d'adresse) : vérifiable depuis l'extérieur
      siteUrl: resolveSiteUrl(),
      // Webhooks du prestataire de paiement (AUDIT §65) : présence des secrets, jamais leur valeur
      // Ventes signalées « paiement inconnu du prestataire » en attente d'une décision de l'administration (AUDIT §65)
      paymentIssues: await this.paymentIssuesCount(),
      // AUDIT §69 : l'identifiant du compte de versement d'un membre n'est plus exposé en clair (4 derniers caractères)
      ...(process.env.PAYMENT_PROVIDER === 'stripe' ? { stripeWebhooks: { platform: !!process.env.STRIPE_WEBHOOK_SECRET, connectedAccounts: !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET, platformSecretFormat: describeSecret(process.env.STRIPE_WEBHOOK_SECRET), connectedAccountsSecretFormat: describeSecret(process.env.STRIPE_CONNECT_WEBHOOK_SECRET), ...webhookTrace, lastAccountId: webhookTrace.lastAccountId ? `…${webhookTrace.lastAccountId.slice(-4)}` : null }, payoutAccounts: payoutSweep, payouts: { pending: await this.pendingPayoutsCount(), ...payoutTrace } } : {}),
    };
  }
}
