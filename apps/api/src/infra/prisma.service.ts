import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient, type Tx, withTenant, withUser } from '@omnitrack/db';
import { ENV, type Env } from '../config/env';
import type { TenantRequestContext } from '../common/context';

/**
 * Database access as the `omnitrack_app` role, which is subject to row-level security.
 * Tenant data must be accessed through `tenant(ctx, fn)`, which sets the RLS context.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(env.DATABASE_URL_APP);
  }

  /** Run `fn` inside a transaction scoped to the caller's organization. */
  tenant<T>(ctx: TenantRequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.client, { organizationId: ctx.principal.organizationId, userId: ctx.principal.userId }, fn);
  }

  /** Run `fn` scoped to an explicit organization (provisioning, invitations, platform actions). */
  forOrganization<T>(organizationId: string, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.client, { organizationId, userId }, fn);
  }

  /** Run `fn` with only the user context (lists the user's own memberships across organizations). */
  forUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withUser(this.client, userId, fn);
  }

  /** A plain transaction with no tenant context (global tables only, or set it with setTenant). */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.client.$transaction(fn, { timeout: 15_000, maxWait: 5_000 });
  }

  /** Sets the RLS context inside an already-open transaction (transaction-local). */
  async setTenant(tx: Tx, organizationId: string, userId: string | null): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true), set_config('app.current_user_id', ${userId ?? ''}, true)`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
