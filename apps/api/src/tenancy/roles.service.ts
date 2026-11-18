import { Injectable } from '@nestjs/common';
import type { PermissionDto, RoleDto } from '@omnitrack/contracts';
import {
  BUILT_IN_ROLES,
  PERMISSIONS,
  PERMISSION_CODES,
  canGrant,
  isBuiltInRoleKey,
  validateGrants,
  type Grants,
} from '@omnitrack/permissions';
import { isUniqueViolation, type Tx } from '@omnitrack/db';
import type { TenantRequestContext } from '../common/context';
import { AppError, Errors } from '../common/errors';
import { AuditService } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { grantsForRoles } from '../auth/principal.service';

type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  version: number;
  permissions: { permission: string; scope: string }[];
  _count?: { members: number };
};

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  catalog(): PermissionDto[] {
    return PERMISSION_CODES.map((code) => {
      const d = PERMISSIONS[code];
      return { code, module: d.module, description: d.description, scopes: [...d.scopes], sensitive: 'sensitive' in d && d.sensitive === true };
    });
  }

  async list(ctx: TenantRequestContext): Promise<RoleDto[]> {
    return this.prisma.tenant(ctx, async (tx) => {
      const rows = await tx.role.findMany({
        include: { permissions: true, _count: { select: { members: true } } },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      });
      return rows.map(toDto);
    });
  }

  async get(ctx: TenantRequestContext, id: string): Promise<RoleDto> {
    return this.prisma.tenant(ctx, async (tx) => toDto(await this.find(tx, id)));
  }

  async create(ctx: TenantRequestContext, input: { name: string; description: string; grants: Record<string, string> }): Promise<RoleDto> {
    const grants = this.validate(ctx, input.grants);
    const key = `custom-${slugify(input.name)}`;
    return this.prisma.tenant(ctx, async (tx) => {
      try {
        const role = await tx.role.create({
          data: {
            organizationId: ctx.principal.organizationId,
            key,
            name: input.name,
            description: input.description,
            permissions: {
              create: Object.entries(grants).map(([permission, scope]) => ({
                organizationId: ctx.principal.organizationId,
                permission,
                scope: scope!,
              })),
            },
          },
          include: { permissions: true, _count: { select: { members: true } } },
        });
        await this.audit.record(tx, ctx, {
          organizationId: ctx.principal.organizationId,
          category: 'security',
          action: 'role.created',
          entityType: 'role',
          entityId: role.id,
          metadata: { name: input.name, grants },
        });
        return toDto(role);
      } catch (err) {
        if (isUniqueViolation(err)) throw Errors.duplicate('name', 'A role with this name already exists.');
        throw err;
      }
    });
  }

  async update(
    ctx: TenantRequestContext,
    id: string,
    input: { name?: string; description?: string; grants?: Record<string, string>; version: number },
  ): Promise<RoleDto> {
    const newGrants = input.grants ? this.validate(ctx, input.grants) : undefined;
    return this.prisma.tenant(ctx, async (tx) => {
      const role = await this.find(tx, id);
      if (role.isSystem) throw Errors.rule('BUILT_IN_ROLE_IMMUTABLE', 'Built-in roles cannot be changed. Copy it into a custom role instead.');
      // Changing a role requires holding what it currently grants, too.
      this.assertCanGrant(ctx, grantsForRoles([role]));
      const updated = await tx.role.updateMany({
        where: { id, version: input.version },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw Errors.versionConflict();
      if (newGrants) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: Object.entries(newGrants).map(([permission, scope]) => ({
            organizationId: ctx.principal.organizationId,
            roleId: id,
            permission,
            scope: scope!,
          })),
        });
        await tx.membership.updateMany({ where: { roles: { some: { roleId: id } } }, data: { permissionsVersion: { increment: 1 } } });
      }
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'security',
        action: 'role.updated',
        entityType: 'role',
        entityId: id,
        metadata: { before: { name: role.name, grants: grantsForRoles([role]) }, after: { name: input.name, grants: newGrants } },
      });
      return toDto(await this.find(tx, id));
    }).catch((err: unknown) => {
      if (isUniqueViolation(err)) throw Errors.duplicate('name', 'A role with this name already exists.');
      throw err;
    });
  }

  async remove(ctx: TenantRequestContext, id: string): Promise<void> {
    await this.prisma.tenant(ctx, async (tx) => {
      const role = await this.find(tx, id);
      if (role.isSystem) throw Errors.rule('BUILT_IN_ROLE_IMMUTABLE', 'Built-in roles cannot be deleted.');
      if ((role._count?.members ?? 0) > 0) throw Errors.conflict('ROLE_IN_USE', 'Remove this role from all members before deleting it.');
      this.assertCanGrant(ctx, grantsForRoles([role]));
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'security',
        action: 'role.deleted',
        entityType: 'role',
        entityId: id,
        metadata: { name: role.name },
      });
    });
  }

  private validate(ctx: TenantRequestContext, input: Record<string, string>): Grants {
    const { grants, errors } = validateGrants(input);
    if (errors.length) {
      throw new AppError(422, 'VALIDATION_FAILED', 'Some permissions are invalid.', {
        errors: errors.map((e) => ({ path: `grants.${e.permission}`, message: e.message })),
      });
    }
    if (Object.keys(grants).length === 0) throw Errors.rule('VALIDATION_FAILED', 'A role needs at least one permission.');
    this.assertCanGrant(ctx, grants);
    return grants;
  }

  private assertCanGrant(ctx: TenantRequestContext, grants: Grants): void {
    const check = canGrant(ctx.principal.grants, grants);
    if (!check.ok) {
      throw new AppError(403, 'ESCALATION_DENIED', 'You cannot grant permissions you do not hold yourself.', {
        missing: check.missing.map((m) => `${m.permission}@${m.required}`),
      });
    }
  }

  private async find(tx: Tx, id: string) {
    const role = await tx.role.findUnique({ where: { id }, include: { permissions: true, _count: { select: { members: true } } } });
    if (!role) throw Errors.notFound('Role');
    return role;
  }
}

function toDto(r: RoleRow): RoleDto {
  const builtIn = r.isSystem && isBuiltInRoleKey(r.key) ? BUILT_IN_ROLES[r.key] : null;
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    requiresMfa: builtIn?.requiresMfa ?? false,
    grants: (builtIn ? builtIn.grants : grantsForRoles([r])) as RoleDto['grants'],
    memberCount: r._count?.members ?? 0,
    version: r.version,
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'role';
}
