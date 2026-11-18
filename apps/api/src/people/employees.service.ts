import { Injectable } from '@nestjs/common';
import {
  EMPLOYEE_TRANSITIONS,
  type CreateEmployeeRequest,
  type EmployeeDto,
  type EmployeeStatus,
  type EmploymentEventDto,
  type Page,
} from '@omnitrack/contracts';
import { hasPermission } from '@omnitrack/permissions';
import { isUniqueViolation, type Prisma, type Tx } from '@omnitrack/db';
import type { TenantRequestContext } from '../common/context';
import { fullName, nextEmployeeCode } from '../common/codes';
import { AppError, Errors } from '../common/errors';
import { isoDateOnly, nextOffsetCursor, offsetFrom, toDate } from '../common/pagination';
import { AccessService } from '../access/access.service';
import { AuditService, diff } from '../infra/audit.service';
import { PrismaService } from '../infra/prisma.service';
import { SessionService } from '../auth/session.service';

export const employeeInclude = {
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  teamMemberships: { include: { team: { select: { id: true, name: true, status: true } } } },
  membership: { select: { id: true } },
} satisfies Prisma.EmployeeInclude;

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

export function toEmployeeDto(e: EmployeeRow): EmployeeDto {
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    fullName: fullName(e),
    workEmail: e.workEmail,
    phone: e.phone,
    jobTitle: e.jobTitle,
    department: e.department,
    manager: e.manager ? { id: e.manager.id, fullName: fullName(e.manager) } : null,
    teams: e.teamMemberships.filter((t) => t.team.status === 'active').map((t) => ({ id: t.team.id, name: t.team.name })),
    employmentType: e.employmentType,
    status: e.status,
    joinDate: isoDateOnly(e.joinDate),
    exitDate: isoDateOnly(e.exitDate),
    location: e.location,
    hasLogin: e.membership !== null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    version: e.version,
  };
}

const today = () => new Date(new Date().toISOString().slice(0, 10));

export interface EmployeeListQuery {
  limit: number;
  cursor?: string;
  q?: string;
  status?: EmployeeStatus;
  departmentId?: string;
  teamId?: string;
  managerId?: string;
  sort: 'name' | 'code' | 'joinDate' | 'createdAt';
  order: 'asc' | 'desc';
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** Builds the visible-employee filter plus list filters. Reused by search and export. */
  async listWhere(tx: Tx, ctx: TenantRequestContext, q: Partial<EmployeeListQuery>, permission: 'employee.read' | 'employee.export' = 'employee.read') {
    const scope = await this.access.employeeWhere(tx, ctx.principal, permission);
    const and: Prisma.EmployeeWhereInput[] = [scope];
    if (q.status) and.push({ status: q.status });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.managerId) and.push({ managerId: q.managerId });
    if (q.teamId) and.push({ teamMemberships: { some: { teamId: q.teamId } } });
    if (q.q) {
      const terms = q.q.split(/\s+/).filter(Boolean).slice(0, 5);
      for (const term of terms) {
        and.push({
          OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { employeeCode: { contains: term, mode: 'insensitive' } },
            { workEmail: { contains: term, mode: 'insensitive' } },
            { jobTitle: { contains: term, mode: 'insensitive' } },
          ],
        });
      }
    }
    return { AND: and } satisfies Prisma.EmployeeWhereInput;
  }

  orderBy(q: Pick<EmployeeListQuery, 'sort' | 'order'>): Prisma.EmployeeOrderByWithRelationInput[] {
    const o = q.order;
    switch (q.sort) {
      case 'code':
        return [{ employeeCode: o }];
      case 'joinDate':
        return [{ joinDate: { sort: o, nulls: 'last' } }, { id: 'asc' }];
      case 'createdAt':
        return [{ createdAt: o }, { id: 'asc' }];
      default:
        return [{ firstName: o }, { lastName: o }, { id: 'asc' }];
    }
  }

  async list(ctx: TenantRequestContext, q: EmployeeListQuery): Promise<Page<EmployeeDto>> {
    const offset = offsetFrom(q.cursor);
    return this.prisma.tenant(ctx, async (tx) => {
      const where = await this.listWhere(tx, ctx, q);
      const [rows, total] = await Promise.all([
        tx.employee.findMany({ where, include: employeeInclude, orderBy: this.orderBy(q), skip: offset, take: q.limit }),
        tx.employee.count({ where }),
      ]);
      return { items: rows.map(toEmployeeDto), nextCursor: nextOffsetCursor(offset, q.limit, rows.length, total), total };
    });
  }

  async get(ctx: TenantRequestContext, id: string): Promise<EmployeeDto> {
    return this.prisma.tenant(ctx, async (tx) => toEmployeeDto(await this.findVisible(tx, ctx, id, 'employee.read')));
  }

  async create(ctx: TenantRequestContext, input: CreateEmployeeRequest): Promise<EmployeeDto> {
    const p = ctx.principal;
    return this.prisma.tenant(ctx, async (tx) => {
      await this.assertDepartment(tx, input.departmentId ?? null);
      if (input.managerId) await this.assertManager(tx, input.managerId);
      const teamIds = [...new Set(input.teamIds)];
      if (teamIds.length) {
        const teams = await tx.team.count({ where: { id: { in: teamIds }, status: 'active' } });
        if (teams !== teamIds.length) throw Errors.rule('TEAM_NOT_FOUND', 'One or more teams do not exist.', { errors: [{ path: 'teamIds', message: 'Unknown team' }] });
      }
      const employeeCode = input.employeeCode?.toUpperCase() ?? (await nextEmployeeCode(tx, p.organizationId));
      await this.assertUnique(tx, { employeeCode, workEmail: input.workEmail ?? null });
      let created;
      try {
        created = await tx.employee.create({
          data: {
            organizationId: p.organizationId,
            employeeCode,
            firstName: input.firstName,
            lastName: input.lastName,
            workEmail: input.workEmail ?? null,
            phone: input.phone ?? null,
            jobTitle: input.jobTitle,
            departmentId: input.departmentId ?? null,
            managerId: input.managerId ?? null,
            employmentType: input.employmentType,
            status: input.status,
            joinDate: toDate(input.joinDate) ?? null,
            location: input.location,
            createdBy: p.userId,
            updatedBy: p.userId,
          },
          select: { id: true },
        });
      } catch (err) {
        // Concurrent insert lost the race after the pre-check. Postgres omits key details for
        // RLS-protected tables, so the field cannot be identified here.
        if (isUniqueViolation(err)) throw Errors.duplicate('employeeCode or workEmail', 'Another employee already uses this code or work email.');
        throw err;
      }
      if (teamIds.length) {
        await tx.teamMember.createMany({ data: teamIds.map((teamId) => ({ organizationId: p.organizationId, teamId, employeeId: created.id })) });
      }
      await tx.employmentEvent.create({
        data: {
          organizationId: p.organizationId,
          employeeId: created.id,
          type: 'created',
          toValue: { status: input.status, departmentId: input.departmentId ?? null, managerId: input.managerId ?? null, jobTitle: input.jobTitle },
          effectiveDate: toDate(input.joinDate) ?? today(),
          actorUserId: p.userId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, ctx, {
        organizationId: p.organizationId,
        category: 'business',
        action: 'employee.created',
        entityType: 'employee',
        entityId: created.id,
        metadata: { employeeCode, name: `${input.firstName} ${input.lastName}`.trim(), teamIds },
      });
      return toEmployeeDto(await tx.employee.findUniqueOrThrow({ where: { id: created.id }, include: employeeInclude }));
    });
  }

  async update(
    ctx: TenantRequestContext,
    id: string,
    input: {
      firstName?: string;
      lastName?: string;
      workEmail?: string | null;
      phone?: string | null;
      jobTitle?: string;
      departmentId?: string | null;
      managerId?: string | null;
      employmentType?: 'full_time' | 'part_time' | 'contract' | 'intern';
      joinDate?: string | null;
      location?: string;
      effectiveDate?: string;
      version: number;
    },
  ): Promise<EmployeeDto> {
    const p = ctx.principal;
    return this.prisma.tenant(ctx, async (tx) => {
      const before = await this.findVisible(tx, ctx, id, 'employee.read');
      if (!(await this.access.canReachEmployee(tx, p, 'employee.update', id))) throw Errors.forbidden('You cannot edit this employee.');
      if (before.status === 'exited' || before.status === 'cancelled') throw Errors.rule('EMPLOYEE_CLOSED', 'Exited or cancelled employee records are read-only.');

      const { version, effectiveDate, joinDate, ...rest } = input;
      const data: Prisma.EmployeeUncheckedUpdateManyInput = { ...rest, ...(joinDate !== undefined ? { joinDate: toDate(joinDate) } : {}) };
      if (input.workEmail && input.workEmail !== before.workEmail) await this.assertUnique(tx, { workEmail: input.workEmail, excludeId: id });
      if (input.departmentId !== undefined && input.departmentId !== before.departmentId) await this.assertDepartment(tx, input.departmentId);
      if (input.managerId !== undefined && input.managerId !== before.managerId && input.managerId) {
        await this.assertManager(tx, input.managerId);
        await this.assertNoCycle(tx, id, input.managerId);
      }

      let count: number;
      try {
        ({ count } = await tx.employee.updateMany({
          where: { id, version },
          data: { ...data, updatedBy: p.userId, version: { increment: 1 } },
        }));
      } catch (err) {
        if (isUniqueViolation(err)) throw Errors.duplicate('workEmail', 'Another employee already uses this work email.');
        throw err;
      }
      if (count !== 1) throw Errors.versionConflict();

      const changes = diff(before as unknown as Record<string, unknown>, data as Record<string, unknown>);
      const eff = toDate(effectiveDate) ?? today();
      const tracked: Record<string, string> = {
        departmentId: 'department_changed',
        managerId: 'manager_changed',
        jobTitle: 'title_changed',
        employmentType: 'employment_type_changed',
      };
      for (const [field, type] of Object.entries(tracked)) {
        const change = changes[field];
        if (!change) continue;
        await tx.employmentEvent.create({
          data: {
            organizationId: p.organizationId,
            employeeId: id,
            type,
            fromValue: (change[0] ?? null) as Prisma.InputJsonValue,
            toValue: (change[1] ?? null) as Prisma.InputJsonValue,
            effectiveDate: eff,
            actorUserId: p.userId,
          },
          select: { id: true },
        });
      }
      if (Object.keys(changes).length) {
        await this.audit.record(tx, ctx, {
          organizationId: p.organizationId,
          category: 'business',
          action: 'employee.updated',
          entityType: 'employee',
          entityId: id,
          metadata: { changes },
        });
      }
      return toEmployeeDto(await tx.employee.findUniqueOrThrow({ where: { id }, include: employeeInclude }));
    });
  }

  async changeStatus(
    ctx: TenantRequestContext,
    id: string,
    input: { status: EmployeeStatus; effectiveDate: string; note?: string; version: number },
  ): Promise<EmployeeDto> {
    const p = ctx.principal;
    return this.prisma.tenant(ctx, async (tx) => {
      const before = await this.findVisible(tx, ctx, id, 'employee.read');
      const allowed = EMPLOYEE_TRANSITIONS[before.status];
      if (!allowed.includes(input.status)) throw Errors.invalidTransition(before.status, input.status, allowed);
      const eff = toDate(input.effectiveDate)!;

      if (input.status === 'exited') {
        const reports = await tx.employee.findMany({
          where: { managerId: id, status: { in: ['active', 'notice_period', 'pre_joining'] } },
          select: { id: true, firstName: true, lastName: true },
        });
        if (reports.length) {
          throw new AppError(422, 'HAS_ACTIVE_REPORTS', 'Assign a new manager to this person’s direct reports first.', {
            reports: reports.map((r) => ({ id: r.id, fullName: fullName(r) })),
          });
        }
        const leads = await tx.team.count({ where: { leaderEmployeeId: id, status: 'active' } });
        const heads = await tx.department.count({ where: { headEmployeeId: id, status: 'active' } });
        if (leads || heads) throw Errors.rule('HOLDS_STRUCTURE_ROLE', 'Replace this person as team leader or department head first.', { teams: leads, departments: heads });
        if (before.joinDate && eff < before.joinDate) throw Errors.rule('EXIT_BEFORE_JOIN', 'The exit date cannot be before the join date.');
      }

      const data: Prisma.EmployeeUncheckedUpdateManyInput = { status: input.status, updatedBy: p.userId, version: { increment: 1 } };
      if (input.status === 'exited') data.exitDate = eff;
      if (input.status === 'active' && before.status === 'pre_joining' && !before.joinDate) data.joinDate = eff;
      if (input.status === 'active' && before.status === 'notice_period') data.exitDate = null;

      const { count } = await tx.employee.updateMany({ where: { id, version: input.version }, data });
      if (count !== 1) throw Errors.versionConflict();

      if (input.status === 'exited' || input.status === 'cancelled') {
        const membership = await tx.membership.findUnique({ where: { employeeId: id } });
        if (membership && membership.status === 'active') {
          await tx.membership.update({ where: { id: membership.id }, data: { status: 'deactivated', deactivatedAt: new Date() }, select: { id: true } });
          await this.sessions.revokeForMembership(membership.id, 'employee_exited', tx);
        }
        await tx.teamMember.deleteMany({ where: { employeeId: id } });
      }

      await tx.employmentEvent.create({
        data: {
          organizationId: p.organizationId,
          employeeId: id,
          type: 'status_changed',
          fromValue: before.status,
          toValue: { status: input.status, ...(input.note ? { note: input.note } : {}) },
          effectiveDate: eff,
          actorUserId: p.userId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, ctx, {
        organizationId: p.organizationId,
        category: 'business',
        action: 'employee.status_changed',
        entityType: 'employee',
        entityId: id,
        metadata: { from: before.status, to: input.status, effectiveDate: input.effectiveDate },
      });
      return toEmployeeDto(await tx.employee.findUniqueOrThrow({ where: { id }, include: employeeInclude }));
    });
  }

  async history(ctx: TenantRequestContext, id: string): Promise<EmploymentEventDto[]> {
    return this.prisma.tenant(ctx, async (tx) => {
      await this.findVisible(tx, ctx, id, 'employee.read');
      const events = await tx.employmentEvent.findMany({ where: { employeeId: id }, orderBy: [{ createdAt: 'desc' }], take: 200 });
      const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => !!x))];
      const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } });
      const names = new Map(actors.map((a) => [a.id, a.displayName]));
      return events.map((e) => ({
        id: e.id,
        type: e.type,
        from: e.fromValue,
        to: e.toValue,
        effectiveDate: isoDateOnly(e.effectiveDate)!,
        actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
        createdAt: e.createdAt.toISOString(),
      }));
    });
  }

  async directReports(ctx: TenantRequestContext, id: string): Promise<EmployeeDto[]> {
    return this.prisma.tenant(ctx, async (tx) => {
      await this.findVisible(tx, ctx, id, 'employee.read');
      const scope = await this.access.employeeWhere(tx, ctx.principal, 'employee.read');
      const rows = await tx.employee.findMany({
        where: { AND: [{ managerId: id }, scope] },
        include: employeeInclude,
        orderBy: [{ firstName: 'asc' }],
        take: 500,
      });
      return rows.map(toEmployeeDto);
    });
  }

  /** Employee visible to the caller under `permission`; otherwise 404 (never reveal existence). */
  async findVisible(tx: Tx, ctx: TenantRequestContext, id: string, permission: 'employee.read' | 'employee.update') {
    if (!hasPermission(ctx.principal.grants, permission)) throw Errors.forbidden();
    const scope = await this.access.employeeWhere(tx, ctx.principal, permission);
    const row = await tx.employee.findFirst({ where: { AND: [{ id }, scope] }, include: employeeInclude });
    if (!row) throw Errors.notFound('Employee');
    return row;
  }

  /** Per-organization uniqueness (RLS scopes these queries to the caller's organization). */
  private async assertUnique(tx: Tx, f: { employeeCode?: string; workEmail?: string | null; excludeId?: string }): Promise<void> {
    const not = f.excludeId ? { id: { not: f.excludeId } } : {};
    if (f.employeeCode && (await tx.employee.findFirst({ where: { employeeCode: f.employeeCode, ...not }, select: { id: true } }))) {
      throw Errors.duplicate('employeeCode', 'This employee code is already in use.');
    }
    if (f.workEmail && (await tx.employee.findFirst({ where: { workEmail: f.workEmail, ...not }, select: { id: true } }))) {
      throw Errors.duplicate('workEmail', 'Another employee already uses this work email.');
    }
  }

  private async assertDepartment(tx: Tx, departmentId: string | null): Promise<void> {
    if (!departmentId) return;
    const d = await tx.department.findUnique({ where: { id: departmentId }, select: { status: true } });
    if (!d || d.status !== 'active') {
      throw Errors.rule('DEPARTMENT_NOT_FOUND', 'Choose an active department.', { errors: [{ path: 'departmentId', message: 'Unknown or archived department' }] });
    }
  }

  private async assertManager(tx: Tx, managerId: string): Promise<void> {
    const m = await tx.employee.findUnique({ where: { id: managerId }, select: { status: true } });
    if (!m) throw Errors.rule('MANAGER_NOT_FOUND', 'Choose a valid manager.', { errors: [{ path: 'managerId', message: 'Unknown employee' }] });
    if (m.status !== 'active' && m.status !== 'notice_period') {
      throw Errors.rule('MANAGER_INACTIVE', 'The manager must be an active employee.', { errors: [{ path: 'managerId', message: 'Not active' }] });
    }
  }

  /** DOMAINS.md C-R3: the new manager must not be the employee or anyone below them. */
  private async assertNoCycle(tx: Tx, employeeId: string, managerId: string): Promise<void> {
    if (employeeId === managerId) throw Errors.rule('MANAGER_CYCLE', 'An employee cannot manage themselves.');
    const rows = await tx.$queryRaw<{ hit: number }[]>`
      WITH RECURSIVE chain AS (
        SELECT id, manager_id, 1 AS depth FROM employees WHERE id = ${managerId}::uuid
        UNION ALL
        SELECT e.id, e.manager_id, c.depth + 1 FROM employees e JOIN chain c ON e.id = c.manager_id WHERE c.depth < 50
      ) SELECT 1 AS hit FROM chain WHERE id = ${employeeId}::uuid LIMIT 1`;
    if (rows.length) {
      throw Errors.rule('MANAGER_CYCLE', 'This would create a circular reporting line.', { errors: [{ path: 'managerId', message: 'Circular reporting line' }] });
    }
  }
}
