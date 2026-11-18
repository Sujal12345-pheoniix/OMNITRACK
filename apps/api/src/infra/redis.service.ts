import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { Errors } from '../common/errors';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly logger = new Logger('Redis');

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  /**
   * Fixed-window rate limit. Throws RATE_LIMITED when `limit` is exceeded within `windowSeconds`.
   *
   * Fails open if Redis is unavailable: availability of sign-in is preferred, and account
   * lockout (DOMAINS.md A-R3) is enforced independently from the database.
   */
  async limit(bucket: string, id: string, limit: number, windowSeconds: number): Promise<void> {
    const key = `rl:${bucket}:${id}`;
    let count: number;
    let ttl: number;
    try {
      const res = await this.client.multi().incr(key).expire(key, windowSeconds, 'NX').ttl(key).exec();
      count = Number(res?.[0]?.[1] ?? 0);
      ttl = Number(res?.[2]?.[1] ?? windowSeconds);
    } catch (err) {
      this.logger.warn(`Rate limiter unavailable, failing open: ${(err as Error).message}`);
      return;
    }
    if (count > limit) throw Errors.rateLimited(Math.max(ttl, 1));
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
