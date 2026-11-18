import { Controller, Get, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: the process is up. */
  @Get()
  @Public()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Returns 503 when not ready. */
  @Get('ready')
  @Public()
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      this.prisma.client.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping(),
    ]);
    const ok = database && redis;
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ready' : 'not_ready', checks: { database, redis } };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
