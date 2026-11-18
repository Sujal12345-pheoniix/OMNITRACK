import { Injectable } from '@nestjs/common';
import { BUILT_IN_ROLES, BUILT_IN_ROLE_KEYS, type BuiltInRoleKey } from '@omnitrack/permissions';
import { isUniqueViolation, type Tx } from '@omnitrack/db';
import type { RequestContext } from '../common/context';
import { nextEmployeeCode, splitName } from '../common/codes';
import { uuidv7 } from '../common/crypto';
import { Errors } from '../common/errors';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

export interface ProvisionInput {
  name: string;
  slug: string;
  createdByUserId: string | null;
  /** When present, this user becomes the first owner (membership + employee record). */
  owner?: { userId: string; displayName: string; email: string };
}

export interface ProvisionResult {
  organizationId: string;
  roleIds: Record<BuiltInRoleKey, string>;
  owner?: { membershipId: string; employeeId: string };
}

/**
 * Creates a tenant: organization row, built-in roles, and optionally its first owner.
 * Must run inside the caller's transaction so a failure leaves nothing behind (AC-B2).
 */
@Injectable()
export class ProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createOrganization(tx: Tx, ctx: RequestContext, input: ProvisionInput): Promise<ProvisionResult> {
    const organizationId = uuidv7();
    try {
      await tx.organization.create({
        data: { id: organizationId, name: input.name, slug: input.slug, createdByUserId: input.createdByUserId },
        select: { id: true },
      });
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) throw Errors.conflict('SLUG_TAKEN', 'This organization address is already taken.');
      throw err;
    }

    await this.prisma.setTenant(tx, organizationId, input.owner?.userId ?? input.createdByUserId);

    await tx.role.createMany({
      data: BUILT_IN_ROLE_KEYS.map((key) => ({
        organizationId,
        key,
        name: BUILT_IN_ROLES[key].name,
        description: BUILT_IN_ROLES[key].description,
        isSystem: true,
      })),
    });
    const roles = await tx.role.findMany({ where: { organizationId, isSystem: true }, select: { id: true, key: true } });
    const roleIds = Object.fromEntries(roles.map((r) => [r.key, r.id])) as Record<BuiltInRoleKey, string>;

    let owner: ProvisionResult['owner'];
    if (input.owner) {
      const { firstName, lastName } = splitName(input.owner.displayName);
      const employee = await tx.employee.create({
        data: {
          organizationId,
          employeeCode: await nextEmployeeCode(tx, organizationId),
          firstName,
          lastName,
          workEmail: input.owner.email,
          jobTitle: 'Owner',
          status: 'active',
          createdBy: input.owner.userId,
        },
        select: { id: true },
      });
      const membership = await tx.membership.create({
        data: { organizationId, userId: input.owner.userId, employeeId: employee.id },
        select: { id: true },
      });
      await tx.membershipRole.create({
        data: { organizationId, membershipId: membership.id, roleId: roleIds.org_owner, createdBy: input.owner.userId },
        select: { id: true },
      });
      await tx.employmentEvent.create({
        data: {
          organizationId,
          employeeId: employee.id,
          type: 'created',
          toValue: { status: 'active' },
          effectiveDate: new Date(new Date().toISOString().slice(0, 10)),
          actorUserId: input.owner.userId,
        },
        select: { id: true },
      });
      owner = { membershipId: membership.id, employeeId: employee.id };
    }

    await this.audit.record(tx, ctx, {
      organizationId,
      category: 'admin',
      action: 'organization.created',
      entityType: 'organization',
      entityId: organizationId,
      actorUserId: input.createdByUserId,
      metadata: { name: input.name, slug: input.slug, ownerUserId: input.owner?.userId ?? null },
    });

    return { organizationId, roleIds, owner };
  }
}
