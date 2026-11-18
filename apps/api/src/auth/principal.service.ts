import { Injectable } from '@nestjs/common';
import { BUILT_IN_ROLES, isBuiltInRoleKey, mergeGrants, type Grants, type PermissionCode, type Scope } from '@omnitrack/permissions';
import type { Tx } from '@omnitrack/db';
import type { Principal } from '../common/context';
import { PrismaService } from '../infra/prisma.service';
import { SessionService } from './session.service';

interface RoleWithPermissions {
  key: string;
  isSystem: boolean;
  permissions: { permission: string; scope: string }[];
}

/** Effective grants of a set of roles: built-in from code, custom from the database. */
export function grantsForRoles(roles: RoleWithPermissions[]): Grants {
  return mergeGrants(
    ...roles.map((r) =>
      r.isSystem && isBuiltInRoleKey(r.key)
        ? BUILT_IN_ROLES[r.key].grants
        : (Object.fromEntries(r.permissions.map((p) => [p.permission as PermissionCode, p.scope as Scope])) as Grants),
    ),
  );
}

export function rolesRequireMfa(roles: { key: string; isSystem: boolean }[]): boolean {
  return roles.some((r) => r.isSystem && isBuiltInRoleKey(r.key) && BUILT_IN_ROLES[r.key].requiresMfa);
}

export type ResolveFailure = 'missing' | 'expired' | 'revoked' | 'user_inactive' | 'org_inactive' | 'membership_inactive';

/** Resolves a session cookie into a Principal, validating every link in the chain. */
@Injectable()
export class PrincipalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async resolve(token: string | undefined): Promise<{ principal: Principal } | { failure: ResolveFailure }> {
    if (!token || token.length > 100) return { failure: 'missing' };
    const session = await this.sessions.findByToken(token);
    if (!session) return { failure: 'missing' };
    if (session.revokedAt) return { failure: 'revoked' };
    const now = new Date();
    if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
      await this.sessions.revoke(session.id, 'expired');
      return { failure: 'expired' };
    }
    const user = session.user;
    if (user.status !== 'active') {
      await this.sessions.revoke(session.id, 'user_inactive');
      return { failure: 'user_inactive' };
    }

    let organizationId: string | null = null;
    let membershipId: string | null = null;
    let employeeId: string | null = null;
    let roles: (RoleWithPermissions & { id: string })[] = [];

    if (session.organizationId && session.membershipId) {
      if (!session.organization || session.organization.status !== 'active') {
        await this.sessions.revoke(session.id, 'organization_inactive');
        return { failure: 'org_inactive' };
      }
      const membership = await this.prisma.forOrganization(session.organizationId, user.id, (tx) =>
        this.loadMembership(tx, session.membershipId!),
      );
      if (!membership || membership.status !== 'active' || membership.userId !== user.id) {
        await this.sessions.revoke(session.id, 'membership_inactive');
        return { failure: 'membership_inactive' };
      }
      organizationId = session.organizationId;
      membershipId = membership.id;
      employeeId = membership.employeeId;
      roles = membership.roles.map((mr) => mr.role);
    }

    await this.sessions.touch(session.id, session.lastSeenAt, session.absoluteExpiresAt);

    return {
      principal: {
        sessionId: session.id,
        sessionStatus: session.status,
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        platformRole: user.platformRole,
        mfaEnabled: user.mfaEnabledAt !== null,
        organizationId,
        membershipId,
        employeeId,
        roleKeys: roles.map((r) => r.key),
        grants: grantsForRoles(roles),
        requiresMfa: user.platformRole === 'super_admin' || rolesRequireMfa(roles),
      },
    };
  }

  loadMembership(tx: Tx, membershipId: string) {
    return tx.membership.findUnique({
      where: { id: membershipId },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    });
  }
}
