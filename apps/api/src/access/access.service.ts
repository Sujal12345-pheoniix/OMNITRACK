import { Injectable } from '@nestjs/common';
import {
  hasPermission,
  subtree,
  visibilityFor,
  type ActorStructure,
  type PermissionCode,
  type Scope,
  type Visibility,
} from '@omnitrack/permissions';
import type { Prisma, Tx } from '@omnitrack/db';
import type { Principal } from '../common/context';
import { Errors } from '../common/errors';

const structureCache = new WeakMap<Principal, Promise<ActorStructure>>();

/**
 * Turns a principal's scoped grants into concrete record filters (DOMAINS.md §0.3).
 * All queries run inside the caller's tenant transaction, so RLS still applies underneath.
 */
@Injectable()
export class AccessService {
  scopeOf(p: Principal, permission: PermissionCode): Scope | null {
    return p.grants[permission] ?? null;
  }

  require(p: Principal, permission: PermissionCode, atLeast: Scope = 'own'): Scope {
    if (!hasPermission(p.grants, permission, atLeast)) throw Errors.forbidden();
    return p.grants[permission]!;
  }

  /** The actor's position in the org: led-team members, reports, headed department subtree. */
  structure(tx: Tx, p: Principal): Promise<ActorStructure> {
    let cached = structureCache.get(p);
    if (!cached) {
      cached = this.loadStructure(tx, p);
      structureCache.set(p, cached);
    }
    return cached;
  }

  private async loadStructure(tx: Tx, p: Principal): Promise<ActorStructure> {
    const me = p.employeeId!;
    const [teamMembers, reports, departments] = await Promise.all([
      tx.teamMember.findMany({
        where: { team: { leaderEmployeeId: me, status: 'active' } },
        select: { employeeId: true },
      }),
      tx.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE r AS (
          SELECT id, 1 AS depth FROM employees WHERE manager_id = ${me}::uuid
          UNION ALL
          SELECT e.id, r.depth + 1 FROM employees e JOIN r ON e.manager_id = r.id WHERE r.depth < 20
        ) SELECT DISTINCT id FROM r`,
      tx.department.findMany({ select: { id: true, parentId: true, headEmployeeId: true, status: true } }),
    ]);
    const headed = departments.filter((d) => d.headEmployeeId === me && d.status === 'active').map((d) => d.id);
    return {
      employeeId: me,
      ledTeamMemberIds: [...new Set(teamMembers.map((t) => t.employeeId).filter((id) => id !== me))],
      reportIds: reports.map((r) => r.id),
      headedDepartmentIds: headed.length ? subtree(departments, headed) : [],
    };
  }

  async visibility(tx: Tx, p: Principal, permission: PermissionCode): Promise<Visibility> {
    const scope = this.require(p, permission);
    if (scope === 'organization') return { all: true };
    return visibilityFor(scope, await this.structure(tx, p));
  }

  /** Prisma filter selecting employees visible under `permission`. */
  async employeeWhere(tx: Tx, p: Principal, permission: PermissionCode): Promise<Prisma.EmployeeWhereInput> {
    const v = await this.visibility(tx, p, permission);
    if (v.all) return {};
    return { OR: [{ id: { in: v.employeeIds } }, ...(v.departmentIds.length ? [{ departmentId: { in: v.departmentIds } }] : [])] };
  }

  /**
   * Filter for records owned by an employee (e.g. tasks, leads). `ownerField` is the
   * relation holding the owning employee.
   */
  async ownedWhere(
    tx: Tx,
    p: Principal,
    permission: PermissionCode,
    ownerIdField: string,
    ownerRelation: string,
  ): Promise<Record<string, unknown>> {
    const v = await this.visibility(tx, p, permission);
    if (v.all) return {};
    const or: Record<string, unknown>[] = [{ [ownerIdField]: { in: v.employeeIds } }];
    if (v.departmentIds.length) or.push({ [ownerRelation]: { departmentId: { in: v.departmentIds } } });
    return { OR: or };
  }

  /** Whether the employee is within the principal's scope for `permission`. */
  async canReachEmployee(tx: Tx, p: Principal, permission: PermissionCode, employeeId: string): Promise<boolean> {
    if (!hasPermission(p.grants, permission)) return false;
    const where = await this.employeeWhere(tx, p, permission);
    return (await tx.employee.count({ where: { AND: [{ id: employeeId }, where] } })) === 1;
  }
}
