import { Prisma, PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface TenantContext {
  organizationId: string;
  userId: string | null;
}

export function createPrismaClient(url: string, options: { log?: Prisma.LogLevel[] } = {}) {
  return new PrismaClient({ datasourceUrl: url, log: options.log ?? ['warn', 'error'] });
}

/**
 * Runs `fn` in a transaction with the tenant context set for row-level security.
 *
 * `set_config(..., true)` is transaction-local (equivalent to SET LOCAL), so the setting
 * can never leak to another request that later reuses the pooled connection (risk R-07).
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number } = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.organizationId}, true), set_config('app.current_user_id', ${ctx.userId ?? ''}, true)`;
      return fn(tx);
    },
    { isolationLevel: options.isolationLevel, timeout: options.timeout ?? 15_000, maxWait: 5_000 },
  );
}

/**
 * Runs `fn` in a transaction with only the user context set (no organization). Used for
 * listing a user's own memberships across organizations (memberships RLS policy allows
 * rows where user_id matches).
 */
export async function withUser<T>(
  prisma: PrismaClient,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** True when the error is a unique-constraint violation, optionally on a given field. */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!field) return true;
  // Prisma reports either column names, Prisma field names or the constraint name.
  const norm = (s: string) => s.replace(/_/g, '').toLowerCase();
  const target = (err.meta?.target ?? []) as string[] | string;
  const wanted = norm(field);
  return (Array.isArray(target) ? target : [String(target)]).some((t) => norm(t).includes(wanted));
}
