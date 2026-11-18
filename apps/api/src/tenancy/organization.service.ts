import { Injectable } from '@nestjs/common';
import type { OrganizationDto } from '@omnitrack/contracts';
import type { RequestContext, TenantRequestContext } from '../common/context';
import { AppError, Errors } from '../common/errors';
import { AuditService, diff } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { SessionService } from '../auth/session.service';
import { InvitationsService } from './invitations.service';
import { ProvisioningService } from './provisioning.service';

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  timezone: string;
  locale: string;
  currency: string;
  createdAt: Date;
  version: number;
};

export function toOrganizationDto(o: OrgRow): OrganizationDto {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    timezone: o.timezone,
    locale: o.locale,
    currency: o.currency,
    createdAt: o.createdAt.toISOString(),
    version: o.version,
  };
}

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(ctx: TenantRequestContext): Promise<OrganizationDto> {
    return toOrganizationDto(await this.prisma.client.organization.findUniqueOrThrow({ where: { id: ctx.principal.organizationId } }));
  }

  async update(
    ctx: TenantRequestContext,
    input: { name?: string; timezone?: string; locale?: string; currency?: string; version: number },
  ): Promise<OrganizationDto> {
    const { version, ...changes } = input;
    return this.prisma.tenant(ctx, async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: ctx.principal.organizationId } });
      const r = await tx.organization.updateMany({
        where: { id: before.id, version },
        data: { ...changes, version: { increment: 1 } },
      });
      if (r.count !== 1) throw Errors.versionConflict();
      await this.audit.record(tx, ctx, {
        organizationId: before.id,
        category: 'admin',
        action: 'organization.updated',
        entityType: 'organization',
        entityId: before.id,
        metadata: { changes: diff(before, changes) },
      });
      return toOrganizationDto(await tx.organization.findUniqueOrThrow({ where: { id: before.id } }));
    });
  }

  /** Public profile for the careers portal shell. Only active organizations are visible. */
  async publicProfile(slug: string): Promise<{ name: string; slug: string }> {
    const org = await this.prisma.client.organization.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!org || org.status !== 'active') throw Errors.notFound('Organization');
    return { name: org.name, slug: org.slug };
  }
}

/** Platform administration (DOMAINS.md B-R7): no access to tenant business records. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly provisioning: ProvisioningService,
    private readonly invitations: InvitationsService,
  ) {}

  async list(): Promise<OrganizationDto[]> {
    const rows = await this.prisma.client.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map(toOrganizationDto);
  }

  /** Creates an organization with no members and an owner invitation. */
  async create(ctx: RequestContext, input: { name: string; slug: string; ownerEmail: string }): Promise<OrganizationDto> {
    const p = ctx.principal!;
    const id = await this.prisma.transaction(async (tx) => {
      const result = await this.provisioning.createOrganization(tx, ctx, { name: input.name, slug: input.slug, createdByUserId: p.userId });
      await this.invitations.issue(tx, ctx, {
        organizationId: result.organizationId,
        organizationName: input.name,
        email: input.ownerEmail,
        roleId: result.roleIds.org_owner,
        roleName: 'Organization owner',
        invitedByUserId: p.userId,
        inviterName: 'OmniTrack',
      });
      return result.organizationId;
    });
    return toOrganizationDto(await this.prisma.client.organization.findUniqueOrThrow({ where: { id } }));
  }

  async setStatus(ctx: RequestContext, id: string, status: 'active' | 'suspended'): Promise<OrganizationDto> {
    const p = ctx.principal!;
    const org = await this.prisma.client.organization.findUnique({ where: { id } });
    if (!org) throw Errors.notFound('Organization');
    if (org.status === status) return toOrganizationDto(org);
    const updated = await this.prisma.transaction(async (tx) => {
      const u = await tx.organization.update({
        where: { id },
        data: { status, suspendedAt: status === 'suspended' ? new Date() : null, version: { increment: 1 } },
      });
      if (status === 'suspended') await this.sessions.revokeForOrganization(id, 'organization_suspended', tx);
      await this.prisma.setTenant(tx, id, p.userId);
      await this.audit.record(tx, ctx, {
        organizationId: id,
        category: 'admin',
        action: status === 'suspended' ? 'organization.suspended' : 'organization.reactivated',
        entityType: 'organization',
        entityId: id,
        actorType: 'platform_admin',
      });
      return u;
    });
    if (!updated) throw new AppError(500, 'INTERNAL', 'Update failed');
    return toOrganizationDto(updated);
  }
}
