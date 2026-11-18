import { Injectable } from '@nestjs/common';
import type { DepartmentDto, DepartmentTreeNode, TeamDetailDto, TeamDto } from '@omnitrack/contracts';
import { depthOf, subtree, subtreeHeight, wouldCreateCycle } from '@omnitrack/permissions';
import { isUniqueViolation, type Prisma, type Tx } from '@omnitrack/db';
import type { TenantRequestContext } from '../common/context';
import { fullName } from '../common/codes';
import { AppError, Errors } from '../common/errors';
import { AccessService } from '../access/access.service';
import { AuditService, diff } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';

const MAX_DEPTH = 6;
const ACTIVE_EMPLOYEE = { status: { in: ['active', 'notice_period', 'pre_joining'] as ('active' | 'notice_period' | 'pre_joining')[] } };

const departmentInclude = {
  head: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { employees: { where: ACTIVE_EMPLOYEE }, teams: { where: { status: 'active' as const } } } },
} satisfies Prisma.DepartmentInclude;

const teamInclude = {
  department: { select: { id: true, name: true } },
  leader: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { members: true } },
} satisfies Prisma.TeamInclude;

function toDepartmentDto(d: Prisma.DepartmentGetPayload<{ include: typeof departmentInclude }>): DepartmentDto {
  return {
    id: d.id,
    name: d.name,
    code: d.code,
    description: d.description,
    parentId: d.parentId,
    head: d.head ? { id: d.head.id, fullName: fullName(d.head) } : null,
    status: d.status,
    employeeCount: d._count.employees,
    teamCount: d._count.teams,
    version: d.version,
  };
}

function toTeamDto(t: Prisma.TeamGetPayload<{ include: typeof teamInclude }>): TeamDto {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    department: t.department,
    leader: { id: t.leader.id, fullName: fullName(t.leader) },
    status: t.status,
    memberCount: t._count.members,
    version: t.version,
  };
}

@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Departments ─────────────

  async listDepartments(ctx: TenantRequestContext, includeArchived: boolean): Promise<DepartmentDto[]> {
    return this.prisma.tenant(ctx, async (tx) => {
      const rows = await tx.department.findMany({
        where: includeArchived ? {} : { status: 'active' },
        include: departmentInclude,
        orderBy: { name: 'asc' },
      });
      return rows.map(toDepartmentDto);
    });
  }

  async departmentTree(ctx: TenantRequestContext): Promise<DepartmentTreeNode[]> {
    const flat = await this.listDepartments(ctx, false);
    const nodes = new Map<string, DepartmentTreeNode>(flat.map((d) => [d.id, { ...d, children: [] }]));
    const roots: DepartmentTreeNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async getDepartment(ctx: TenantRequestContext, id: string): Promise<DepartmentDto> {
    return this.prisma.tenant(ctx, async (tx) => {
      const d = await tx.department.findUnique({ where: { id }, include: departmentInclude });
      if (!d) throw Errors.notFound('Department');
      return toDepartmentDto(d);
    });
  }

  async createDepartment(
    ctx: TenantRequestContext,
    input: { name: string; code: string; description: string; parentId: string | null; headEmployeeId: string | null },
  ): Promise<DepartmentDto> {
    return this.prisma.tenant(ctx, async (tx) => {
      const all = await tx.department.findMany({ select: { id: true, parentId: true, status: true } });
      await this.assertCanManageDepartment(tx, ctx, input.parentId, all, true);
      if (input.parentId) {
        const parent = all.find((d) => d.id === input.parentId);
        if (!parent || parent.status !== 'active') throw Errors.rule('PARENT_NOT_FOUND', 'Choose an active parent department.', { errors: [{ path: 'parentId', message: 'Unknown or archived' }] });
        if (depthOf(all, input.parentId) + 1 > MAX_DEPTH) throw Errors.rule('DEPTH_EXCEEDED', `Departments can be nested at most ${MAX_DEPTH} levels deep.`);
      }
      if (input.headEmployeeId) await this.assertActiveEmployee(tx, input.headEmployeeId, 'headEmployeeId');
      try {
        const d = await tx.department.create({
          data: { organizationId: ctx.principal.organizationId, ...input },
          include: departmentInclude,
        });
        await this.audit.record(tx, ctx, {
          organizationId: ctx.principal.organizationId,
          category: 'business',
          action: 'department.created',
          entityType: 'department',
          entityId: d.id,
          metadata: { name: d.name, code: d.code, parentId: d.parentId },
        });
        return toDepartmentDto(d);
      } catch (err) {
        if (isUniqueViolation(err)) throw Errors.duplicate('code', 'Another department already uses this code.');
        throw err;
      }
    });
  }

  async updateDepartment(
    ctx: TenantRequestContext,
    id: string,
    input: { name?: string; code?: string; description?: string; parentId?: string | null; headEmployeeId?: string | null; version: number },
  ): Promise<DepartmentDto> {
    return this.prisma.tenant(ctx, async (tx) => {
      const before = await tx.department.findUnique({ where: { id } });
      if (!before) throw Errors.notFound('Department');
      const all = await tx.department.findMany({ select: { id: true, parentId: true, status: true } });
      await this.assertCanManageDepartment(tx, ctx, id, all, false);
      if (input.parentId !== undefined && input.parentId !== before.parentId) {
        await this.assertCanManageDepartment(tx, ctx, input.parentId, all, true);
        if (input.parentId) {
          const parent = all.find((d) => d.id === input.parentId);
          if (!parent || parent.status !== 'active') throw Errors.rule('PARENT_NOT_FOUND', 'Choose an active parent department.');
          if (wouldCreateCycle(all, id, input.parentId)) {
            throw Errors.rule('DEPARTMENT_CYCLE', 'A department cannot be moved under itself or one of its sub-departments.', { errors: [{ path: 'parentId', message: 'Circular hierarchy' }] });
          }
          if (depthOf(all, input.parentId) + subtreeHeight(all, id) > MAX_DEPTH) {
            throw Errors.rule('DEPTH_EXCEEDED', `Departments can be nested at most ${MAX_DEPTH} levels deep.`);
          }
        }
      }
      if (input.headEmployeeId) await this.assertActiveEmployee(tx, input.headEmployeeId, 'headEmployeeId');
      const { version, ...changes } = input;
      try {
        const r = await tx.department.updateMany({ where: { id, version }, data: { ...changes, version: { increment: 1 } } });
        if (r.count !== 1) throw Errors.versionConflict();
      } catch (err) {
        if (isUniqueViolation(err)) throw Errors.duplicate('code', 'Another department already uses this code.');
        throw err;
      }
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'business',
        action: 'department.updated',
        entityType: 'department',
        entityId: id,
        metadata: { changes: diff(before as unknown as Record<string, unknown>, changes) },
      });
      return toDepartmentDto(await tx.department.findUniqueOrThrow({ where: { id }, include: departmentInclude }));
    });
  }

  async setDepartmentStatus(ctx: TenantRequestContext, id: string, status: 'active' | 'archived'): Promise<DepartmentDto> {
    return this.prisma.tenant(ctx, async (tx) => {
      const d = await tx.department.findUnique({ where: { id } });
      if (!d) throw Errors.notFound('Department');
      const all = await tx.department.findMany({ select: { id: true, parentId: true, status: true } });
      await this.assertCanManageDepartment(tx, ctx, id, all, false);
      if (status === 'archived') {
        const [employees, children, teams] = await Promise.all([
          tx.employee.count({ where: { departmentId: id, ...ACTIVE_EMPLOYEE } }),
          tx.department.count({ where: { parentId: id, status: 'active' } }),
          tx.team.count({ where: { departmentId: id, status: 'active' } }),
        ]);
        if (employees || children || teams) {
          throw new AppError(422, 'DEPARTMENT_NOT_EMPTY', 'Move its employees, sub-departments and teams elsewhere first.', { employees, children, teams });
        }
      } else if (d.parentId) {
        const parent = all.find((x) => x.id === d.parentId);
        if (parent?.status !== 'active') throw Errors.rule('PARENT_ARCHIVED', 'Restore the parent department first.');
      }
      await tx.department.update({ where: { id }, data: { status, version: { increment: 1 } }, select: { id: true } });
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'business',
        action: status === 'archived' ? 'department.archived' : 'department.restored',
        entityType: 'department',
        entityId: id,
      });
      return toDepartmentDto(await tx.department.findUniqueOrThrow({ where: { id }, include: departmentInclude }));
    });
  }

  /**
   * department.manage at organization scope: anything. At department scope: only within the
   * departments the actor heads (creating a root department needs organization scope).
   */
  private async assertCanManageDepartment(
    tx: Tx,
    ctx: TenantRequestContext,
    departmentId: string | null,
    all: { id: string; parentId: string | null }[],
    asParent: boolean,
  ): Promise<void> {
    const scope = this.access.require(ctx.principal, 'department.manage');
    if (scope === 'organization') return;
    const structure = await this.access.structure(tx, ctx.principal);
    const allowed = new Set(subtree(all, structure.headedDepartmentIds));
    if (!departmentId || !allowed.has(departmentId)) {
      throw Errors.forbidden(asParent ? 'You can only add departments inside the ones you head.' : 'You can only change departments you head.');
    }
  }

  // ───────────── Teams ─────────────

  async listTeams(ctx: TenantRequestContext, q: { departmentId?: string; includeArchived?: boolean }): Promise<TeamDto[]> {
    return this.prisma.tenant(ctx, async (tx) => {
      const rows = await tx.team.findMany({
        where: { ...(q.includeArchived ? {} : { status: 'active' }), ...(q.departmentId ? { departmentId: q.departmentId } : {}) },
        include: teamInclude,
        orderBy: { name: 'asc' },
      });
      return rows.map(toTeamDto);
    });
  }

  async getTeam(ctx: TenantRequestContext, id: string): Promise<TeamDetailDto> {
    return this.prisma.tenant(ctx, async (tx) => {
      const t = await tx.team.findUnique({ where: { id }, include: teamInclude });
      if (!t) throw Errors.notFound('Team');
      const members = await tx.teamMember.findMany({
        where: { teamId: id },
        include: { employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return {
        ...toTeamDto(t),
        members: members.map((m) => ({
          employeeId: m.employee.id,
          fullName: fullName(m.employee),
          jobTitle: m.employee.jobTitle,
          addedAt: m.createdAt.toISOString(),
        })),
      };
    });
  }

  async createTeam(
    ctx: TenantRequestContext,
    input: { name: string; description: string; departmentId: string; leaderEmployeeId: string },
  ): Promise<TeamDetailDto> {
    const id = await this.prisma.tenant(ctx, async (tx) => {
      await this.assertCanManageTeamIn(tx, ctx, input.departmentId, null);
      const dept = await tx.department.findUnique({ where: { id: input.departmentId }, select: { status: true } });
      if (!dept || dept.status !== 'active') throw Errors.rule('DEPARTMENT_NOT_FOUND', 'Choose an active department.', { errors: [{ path: 'departmentId', message: 'Unknown or archived' }] });
      await this.assertActiveEmployee(tx, input.leaderEmployeeId, 'leaderEmployeeId');
      try {
        const t = await tx.team.create({ data: { organizationId: ctx.principal.organizationId, ...input }, select: { id: true } });
        await tx.teamMember.create({
          data: { organizationId: ctx.principal.organizationId, teamId: t.id, employeeId: input.leaderEmployeeId },
          select: { id: true },
        });
        await this.audit.record(tx, ctx, {
          organizationId: ctx.principal.organizationId,
          category: 'business',
          action: 'team.created',
          entityType: 'team',
          entityId: t.id,
          metadata: { name: input.name, departmentId: input.departmentId, leaderEmployeeId: input.leaderEmployeeId },
        });
        return t.id;
      } catch (err) {
        if (isUniqueViolation(err)) throw Errors.duplicate('name', 'This department already has a team with that name.');
        throw err;
      }
    });
    return this.getTeam(ctx, id);
  }

  async updateTeam(
    ctx: TenantRequestContext,
    id: string,
    input: { name?: string; description?: string; departmentId?: string; leaderEmployeeId?: string; version: number },
  ): Promise<TeamDetailDto> {
    await this.prisma.tenant(ctx, async (tx) => {
      const before = await tx.team.findUnique({ where: { id } });
      if (!before) throw Errors.notFound('Team');
      const scope = await this.assertCanManageTeamIn(tx, ctx, before.departmentId, before.leaderEmployeeId);
      if (scope === 'team' && (input.departmentId !== undefined || input.leaderEmployeeId !== undefined)) {
        throw Errors.forbidden('Team leaders can change their team’s name, description and members only.');
      }
      if (input.departmentId && input.departmentId !== before.departmentId) {
        await this.assertCanManageTeamIn(tx, ctx, input.departmentId, null);
        const dept = await tx.department.findUnique({ where: { id: input.departmentId }, select: { status: true } });
        if (!dept || dept.status !== 'active') throw Errors.rule('DEPARTMENT_NOT_FOUND', 'Choose an active department.');
      }
      if (input.leaderEmployeeId && input.leaderEmployeeId !== before.leaderEmployeeId) {
        await this.assertActiveEmployee(tx, input.leaderEmployeeId, 'leaderEmployeeId');
        await tx.teamMember.upsert({
          where: { teamId_employeeId: { teamId: id, employeeId: input.leaderEmployeeId } },
          create: { organizationId: ctx.principal.organizationId, teamId: id, employeeId: input.leaderEmployeeId },
          update: {},
          select: { id: true },
        });
      }
      const { version, ...changes } = input;
      try {
        const r = await tx.team.updateMany({ where: { id, version }, data: { ...changes, version: { increment: 1 } } });
        if (r.count !== 1) throw Errors.versionConflict();
      } catch (err) {
        if (isUniqueViolation(err)) throw Errors.duplicate('name', 'This department already has a team with that name.');
        throw err;
      }
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'business',
        action: 'team.updated',
        entityType: 'team',
        entityId: id,
        metadata: { changes: diff(before as unknown as Record<string, unknown>, changes) },
      });
    });
    return this.getTeam(ctx, id);
  }

  async setTeamStatus(ctx: TenantRequestContext, id: string, status: 'active' | 'archived'): Promise<TeamDetailDto> {
    await this.prisma.tenant(ctx, async (tx) => {
      const t = await tx.team.findUnique({ where: { id } });
      if (!t) throw Errors.notFound('Team');
      const scope = await this.assertCanManageTeamIn(tx, ctx, t.departmentId, t.leaderEmployeeId);
      if (scope === 'team') throw Errors.forbidden('Only department heads and administrators can archive teams.');
      await tx.team.update({ where: { id }, data: { status, version: { increment: 1 } }, select: { id: true } });
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'business',
        action: status === 'archived' ? 'team.archived' : 'team.restored',
        entityType: 'team',
        entityId: id,
      });
    });
    return this.getTeam(ctx, id);
  }

  async addMember(ctx: TenantRequestContext, teamId: string, employeeId: string): Promise<TeamDetailDto> {
    await this.prisma.tenant(ctx, async (tx) => {
      const t = await tx.team.findUnique({ where: { id: teamId } });
      if (!t) throw Errors.notFound('Team');
      if (t.status !== 'active') throw Errors.rule('TEAM_ARCHIVED', 'Restore the team before changing its members.');
      await this.assertCanManageTeamIn(tx, ctx, t.departmentId, t.leaderEmployeeId);
      await this.assertActiveEmployee(tx, employeeId, 'employeeId');
      try {
        await tx.teamMember.create({ data: { organizationId: ctx.principal.organizationId, teamId, employeeId }, select: { id: true } });
      } catch (err) {
        if (isUniqueViolation(err)) throw Errors.conflict('ALREADY_IN_TEAM', 'This employee is already in the team.');
        throw err;
      }
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'business',
        action: 'team.member_added',
        entityType: 'team',
        entityId: teamId,
        metadata: { employeeId },
      });
    });
    return this.getTeam(ctx, teamId);
  }

  async removeMember(ctx: TenantRequestContext, teamId: string, employeeId: string): Promise<TeamDetailDto> {
    await this.prisma.tenant(ctx, async (tx) => {
      const t = await tx.team.findUnique({ where: { id: teamId } });
      if (!t) throw Errors.notFound('Team');
      await this.assertCanManageTeamIn(tx, ctx, t.departmentId, t.leaderEmployeeId);
      if (t.leaderEmployeeId === employeeId) throw Errors.rule('LEADER_REMOVAL', 'Choose a new leader before removing the current one.');
      const r = await tx.teamMember.deleteMany({ where: { teamId, employeeId } });
      if (r.count === 0) throw Errors.notFound('Team member');
      await this.audit.record(tx, ctx, {
        organizationId: ctx.principal.organizationId,
        category: 'business',
        action: 'team.member_removed',
        entityType: 'team',
        entityId: teamId,
        metadata: { employeeId },
      });
    });
    return this.getTeam(ctx, teamId);
  }

  /**
   * team.manage scopes (DOMAINS.md D): organization → any team; department → teams in
   * departments the actor heads; team → teams the actor leads (members, name, description).
   */
  private async assertCanManageTeamIn(
    tx: Tx,
    ctx: TenantRequestContext,
    departmentId: string,
    leaderEmployeeId: string | null,
  ): Promise<'team' | 'department' | 'organization'> {
    const scope = this.access.require(ctx.principal, 'team.manage');
    if (scope === 'organization') return scope;
    if (scope === 'department' || scope === 'team') {
      const structure = await this.access.structure(tx, ctx.principal);
      if (scope === 'department' && structure.headedDepartmentIds.includes(departmentId)) return 'department';
      if (leaderEmployeeId && leaderEmployeeId === ctx.principal.employeeId) return 'team';
    }
    throw Errors.forbidden('You cannot manage this team.');
  }

  private async assertActiveEmployee(tx: Tx, id: string, path: string): Promise<void> {
    const e = await tx.employee.findUnique({ where: { id }, select: { status: true } });
    if (!e || (e.status !== 'active' && e.status !== 'notice_period')) {
      throw Errors.rule('EMPLOYEE_INACTIVE', 'Choose an active employee.', { errors: [{ path, message: 'Unknown or inactive employee' }] });
    }
  }
}
