import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Garde de rate limiting globale (HTTP uniquement : les handlers WebSocket
 * n'ont pas de réponse HTTP où poser les en-têtes X-RateLimit-*).
 * THROTTLE_DISABLED=true la désactive pour les tests automatisés ;
 * validateEnv refuse cette valeur en production.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return process.env.THROTTLE_DISABLED === 'true' && process.env.NODE_ENV !== 'production';
  }
}
