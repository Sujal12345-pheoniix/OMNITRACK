import { Controller, Get, Module, Query } from '@nestjs/common';
import { auditListQuery, type AuditEventDto, type Page } from '@omnitrack/contracts';
import type { Prisma } from '@omnitrack/db';
import { z } from 'zod';
import type { TenantRequestContext } from '../common/context';
import { RequirePermission, TenantCtx } from '../common/decorators';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/prisma.service';

/** Read-only access to the append-only audit trail (DOMAINS.md Q). */
@Controller('audit-events')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit.read')
  async list(
    @TenantCtx() ctx: TenantRequestContext,
    @Query(new ZodPipe(auditListQuery)) q: z.infer<typeof auditListQuery>,
  ): Promise<Page<AuditEventDto>> {
    const cursor = decodeCursor<{ t: string; i: string }>(q.cursor);
    const where: Prisma.AuditEventWhereInput = {
      ...(q.category ? { category: q.category } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(cursor
        ? { OR: [{ createdAt: { lt: new Date(cursor.t) } }, { createdAt: new Date(cursor.t), id: { lt: cursor.i } }] }
        : {}),
    };
    return this.prisma.tenant(ctx, async (tx) => {
      const rows = await tx.auditEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit });
      const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
      const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } });
      const names = new Map(actors.map((a) => [a.id, a.displayName]));
      const last = rows.at(-1);
      return {
        items: rows.map((r) => ({
          id: r.id,
          category: r.category,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          outcome: r.outcome,
          actor: { userId: r.actorUserId, type: r.actorType, displayName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null },
          correlationId: r.correlationId,
          ip: r.ip,
          metadata: r.metadata,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: rows.length === q.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id }) : null,
      };
    });
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
