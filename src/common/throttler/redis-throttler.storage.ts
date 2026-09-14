import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { Redis } from 'ioredis';

/**
 * Stockage Redis pour @nestjs/throttler : les compteurs de rate limiting sont
 * partagés entre toutes les instances de l'API (sans lui, chaque instance
 * compte séparément et un attaquant obtient N × la limite).
 *
 *   REDIS_URL=rediss://default:<password>@<host>:<port>   (Upstash, Render Key Value…)
 *
 * Sans REDIS_URL, le stockage en mémoire de @nestjs/throttler est conservé
 * (correct tant qu'il n'y a qu'une instance). Un script Lua atomique fait
 * INCR + PEXPIRE et gère le blocage temporaire, exactement comme l'implémentation
 * mémoire de la bibliothèque. Testé en e2e avec ioredis-mock (test/phase9).
 */
const LUA = `
local hits = redis.call('INCR', KEYS[1])
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ttl) end
local timeToExpire = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then return {hits, timeToExpire, 1, blockTtl} end
if hits > limit then
  redis.call('SET', KEYS[2], '1', 'PX', block)
  return {hits, timeToExpire, 1, block}
end
return {hits, timeToExpire, 0, 0}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('Throttler(redis)');
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:block`;
    try {
      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = (await this.redis.eval(LUA, 2, hitKey, blockKey, String(ttl), String(limit), String(blockDuration || ttl))) as number[];
      return { totalHits: Number(totalHits), timeToExpire: Math.max(0, Math.ceil(Number(timeToExpire) / 1000)), isBlocked: Number(isBlocked) === 1, timeToBlockExpire: Math.max(0, Math.ceil(Number(timeToBlockExpire) / 1000)) };
    } catch (e) {
      // Redis injoignable : on laisse passer plutôt que de couper tout le site (journalisé, à surveiller)
      this.logger.error(`Redis indisponible pour le rate limiting : ${(e as Error).message}`);
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}

/** Construit le client ioredis depuis REDIS_URL ; null si absent. */
export function createRedisFromEnv(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IORedis = require('ioredis') as typeof import('ioredis');
  const client = new IORedis.default(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000, lazyConnect: false, enableOfflineQueue: false });
  client.on('error', (e: Error) => new Logger('Redis').error(e.message));
  return client;
}
