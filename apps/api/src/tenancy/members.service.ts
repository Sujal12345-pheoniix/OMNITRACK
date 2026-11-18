import { Injectable } from '@nestjs/common';
import type { MemberDto } from '@omnitrack/contracts';
import type { Tx } from '@omnitrack/db';
import type { TenantRequestContext } from '../common/context';
import { fullName } from '../common/codes';
import { AppError, Errors } from '../common/errors';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { SessionService } from '../auth/session.service';
import { InvitationsService } from './invitations.service';

const memberInclude = {
  user: { select: { email: true, displayName: true, mfaEnabledAt: true } },
  employee: { select: { firstName: true, lastName: true } },
  roles: { include: { role: { select: { id: true, key: true, name: true } } } },
} as const;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly invitations: InvitationsService,
  ) {}

  async list(ctx: TenantRequestContext): Promise<MemberDto[]> {
    return this.prisma.tenant(ctx, async (tx) => {
      const rows = await tx.membership.findMany({
        where: { organizationId: ctx.principal.organizationId },
        include: memberInclude,
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toDto);
    });
  }

  async get(ctx: TenantRequestContext, id: string): Promise<MemberDto> {
    return this.prisma.tenant(ctx, async (tx) => toDto(await this.find(tx, ctx, id)));
  }

  async setStatus(ctx: TenantRequestContext, id: string, status: 'active' | 'deactivated'): Promise<MemberDto> {
    return this.prisma.tenant(ctx, async (tx) => {
      const m = await this.find(tx, ctx, id);
      if (m.status === status) return toDto(m);
      if (status === 'deactivated') {
        if (m.userId === ctx.principal.userId) throw Errors.rule('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own membership.');
        if (m.roles.some((r) => r.role.key === 'org_owner')) await this.assertNotLastOwner(tx, ctx.principal.organizationId, m.id);
      } else {
        const emp = await tx.employee.findUniqueOrThrow({ where: { id: m.employeeId }, select: { status: true } });
        if (emp.status === 'exited' || emp.status === 'cancelled') {
          throw Errors.rule('EMPLOYEE_INACTIVE', 'Reactivate the employee record before restoring access.');
        }
      }
      const updated = await tx.membership.update({
        where: { id },
        data: { status, deactivatedAt: status === 'deactivated' ? new Date() : null, permissionsVersion: { increment: 1 } },
        include: memberInclude,
      });
      if (status === 'deactivated') await this.sessions.revokeForMembership(id, 'membership_deactivated', tx);
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'security',
        action: status === 'deactivated' ? 'membership.deactivated' : 'membership.reactivated',
        entityType: 'membership',
        entityId: id,
        metadata: { userId: m.userId },
      });
      return toDto(updated);
    });
  }

  async assignRoles(ctx: TenantRequestContext, id: string, roleIds: string[]): Promise<MemberDto> {
    const p = ctx.principal;
    return this.prisma.tenant(ctx, async (tx) => {
      const m = await this.find(tx, ctx, id);
      const wanted = [...new Set(roleIds)];
      const roles = await tx.role.findMany({ where: { id: { in: wanted } }, include: { permissions: true } });
      if (roles.length !== wanted.length) throw Errors.rule('ROLE_NOT_FOUND', 'One or more roles do not exist.');

      const current = new Set(m.roles.map((r) => r.roleId));
      const added = roles.filter((r) => !current.has(r.id));
      const removedIds = [...current].filter((rid) => !wanted.includes(rid));
      const removed = await tx.role.findMany({ where: { id: { in: removedIds } }, include: { permissions: true } });

      // An actor may only add or remove roles they could grant themselves.
      for (const role of [...added, ...removed]) this.invitations.assertCanAssign(p.grants, p.roleKeys, role);

      if (removed.some((r) => r.key === 'org_owner')) await this.assertNotLastOwner(tx, ctx.principal.organizationId, m.id);

      await tx.membershipRole.deleteMany({ where: { membershipId: id, roleId: { in: removedIds } } });
      if (added.length) {
        await tx.membershipRole.createMany({
          data: added.map((r) => ({ organizationId: p.organizationId, membershipId: id, roleId: r.id, createdBy: p.userId })),
        });
      }
      const updated = await tx.membership.update({ where: { id }, data: { permissionsVersion: { increment: 1 } }, include: memberInclude });
      await this.audit.record(tx, ctx, {
        organizationId: p.organizationId,
        category: 'security',
        action: 'membership.roles_changed',
        entityType: 'membership',
        entityId: id,
        metadata: {
          userId: m.userId,
          added: added.map((r) => r.key),
          removed: removed.map((r) => r.key),
        },
      });
      return toDto(updated);
    });
  }

  private async find(tx: Tx, ctx: TenantRequestContext, id: string) {
    const m = await tx.membership.findFirst({ where: { id, organizationId: ctx.principal.organizationId }, include: memberInclude });
    if (!m) throw Errors.notFound('Member');
    return m;
  }

  /** DOMAINS.md B-R2: an organization always keeps at least one active owner. */
  private async assertNotLastOwner(tx: Tx, organizationId: string, excludingMembershipId: string): Promise<void> {
    const others = await tx.membership.count({
      where: { organizationId, id: { not: excludingMembershipId }, status: 'active', roles: { some: { role: { key: 'org_owner' } } } },
    });
    if (others === 0) throw new AppError(422, 'LAST_OWNER', 'The organization must keep at least one active owner.');
  }
}

function toDto(m: {
  id: string;
  userId: string;
  employeeId: string;
  status: 'active' | 'deactivated';
  createdAt: Date;
  user: { email: string; displayName: string; mfaEnabledAt: Date | null };
  employee: { firstName: string; lastName: string };
  roles: { role: { id: string; key: string; name: string } }[];
}): MemberDto {
  return {
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    displayName: m.user.displayName,
    employeeId: m.employeeId,
    employeeName: fullName(m.employee),
    status: m.status,
    mfaEnabled: m.user.mfaEnabledAt !== null,
    roles: m.roles.map((r) => r.role),
    createdAt: m.createdAt.toISOString(),
  };
}
