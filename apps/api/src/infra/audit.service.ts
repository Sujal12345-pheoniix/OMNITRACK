import { Injectable } from '@nestjs/common';
import type { Prisma, Tx } from '@omnitrack/db';
import type { RequestContext } from '../common/context';

export type AuditCategory = 'security' | 'business' | 'admin';

export interface AuditEntry {
  organizationId: string;
  category: AuditCategory;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome?: 'success' | 'failure';
  metadata?: Record<string, unknown>;
  /** Overrides the actor taken from the context (e.g. the user being created). */
  actorUserId?: string | null;
  actorType?: 'user' | 'system' | 'platform_admin';
}

const SENSITIVE = /pass(word)?|secret|token|hash|mfa|otp|code_?hash|recovery/i;

/** Replace sensitive values anywhere in a metadata object (DOMAINS.md Q-R3). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1),
    ]),
  );
}

/** Field-level diff of the keys that changed: { field: [before, after] }. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    const a = norm(after[key]);
    const b = norm(before[key]);
    if (a !== undefined && JSON.stringify(a) !== JSON.stringify(b)) out[key] = [b, a];
  }
  return out;
}

function norm(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

/**
 * Writes audit events inside the caller's transaction (ADR-007): the business change and
 * its audit record commit or roll back together. The table is append-only for the app role.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    await tx.auditEvent.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId !== undefined ? entry.actorUserId : (ctx.principal?.userId ?? null),
        actorType: entry.actorType ?? (ctx.principal?.platformRole === 'super_admin' && entry.category === 'admin' ? 'platform_admin' : ctx.principal ? 'user' : 'system'),
        category: entry.category,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        outcome: entry.outcome ?? 'success',
        correlationId: ctx.requestId || null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: redact(entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  }
}
