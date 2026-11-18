import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_ROLES,
  PERMISSIONS,
  PERMISSION_CODES,
  canGrant,
  depthOf,
  hasPermission,
  isVisible,
  mergeGrants,
  subtree,
  subtreeHeight,
  validateGrants,
  visibilityFor,
  wouldCreateCycle,
  type PermissionCode,
  type Scope,
} from './index';

describe('catalog', () => {
  it('every built-in grant uses a known permission at an allowed scope', () => {
    for (const [key, role] of Object.entries(BUILT_IN_ROLES)) {
      for (const [code, scope] of Object.entries(role.grants)) {
        expect(PERMISSION_CODES, `${key}: ${code}`).toContain(code);
        expect(PERMISSIONS[code as PermissionCode].scopes, `${key}: ${code}@${scope}`).toContain(scope);
      }
    }
  });

  it('owner and admin require MFA; ordinary employees do not', () => {
    expect(BUILT_IN_ROLES.org_owner.requiresMfa).toBe(true);
    expect(BUILT_IN_ROLES.org_admin.requiresMfa).toBe(true);
    expect(BUILT_IN_ROLES.employee.requiresMfa).toBe(false);
  });

  it('the employee role cannot read audit logs or manage roles', () => {
    const g = BUILT_IN_ROLES.employee.grants;
    expect(hasPermission(g, 'audit.read')).toBe(false);
    expect(hasPermission(g, 'role.manage')).toBe(false);
    expect(hasPermission(g, 'employee.read', 'team')).toBe(false);
    expect(hasPermission(g, 'employee.read', 'own')).toBe(true);
  });
});

describe('mergeGrants / hasPermission', () => {
  it('takes the broadest scope across roles', () => {
    const merged = mergeGrants({ 'employee.read': 'own' }, { 'employee.read': 'department' }, {});
    expect(merged['employee.read']).toBe('department');
  });

  it('denies by default', () => {
    expect(hasPermission({}, 'employee.read')).toBe(false);
  });

  it('a broader scope satisfies a narrower requirement but not the reverse', () => {
    expect(hasPermission({ 'task.read': 'team' }, 'task.read', 'own')).toBe(true);
    expect(hasPermission({ 'task.read': 'team' }, 'task.read', 'organization')).toBe(false);
  });
});

describe('canGrant (anti-escalation)', () => {
  it('rejects granting a permission the actor lacks', () => {
    const r = canGrant({ 'role.manage': 'organization' }, { 'audit.read': 'organization' });
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toMatchObject({ permission: 'audit.read', held: null });
  });

  it('rejects granting a broader scope than held', () => {
    const r = canGrant({ 'employee.read': 'team' }, { 'employee.read': 'organization' });
    expect(r.ok).toBe(false);
  });

  it('allows equal or narrower scope', () => {
    expect(canGrant({ 'employee.read': 'department' }, { 'employee.read': 'team' }).ok).toBe(true);
    expect(canGrant(BUILT_IN_ROLES.org_admin.grants, BUILT_IN_ROLES.hr_manager.grants).ok).toBe(true);
  });
});

describe('validateGrants', () => {
  it('rejects unknown permissions and disallowed scopes', () => {
    const { grants, errors } = validateGrants({
      'nope.read': 'own',
      'role.manage': 'own',
      'employee.read': 'team',
    });
    expect(grants).toEqual({ 'employee.read': 'team' });
    expect(errors.map((e) => e.permission).sort()).toEqual(['nope.read', 'role.manage']);
  });
});

describe('visibility', () => {
  const actor = {
    employeeId: 'me',
    ledTeamMemberIds: ['t1', 't2'],
    reportIds: ['r1'],
    headedDepartmentIds: ['d1', 'd1a'],
  };
  const cases: [Scope, { employeeId: string | null; departmentId: string | null }, boolean][] = [
    ['own', { employeeId: 'me', departmentId: null }, true],
    ['own', { employeeId: 't1', departmentId: null }, false],
    ['team', { employeeId: 't1', departmentId: null }, true],
    ['team', { employeeId: 'r1', departmentId: null }, true],
    ['team', { employeeId: 'x', departmentId: 'd1' }, false],
    ['department', { employeeId: 'x', departmentId: 'd1a' }, true],
    ['department', { employeeId: 'x', departmentId: 'd2' }, false],
    ['organization', { employeeId: 'anyone', departmentId: 'anywhere' }, true],
    ['own', { employeeId: null, departmentId: null }, false],
  ];
  it.each(cases)('scope %s, owner %j → %s', (scope, owner, expected) => {
    expect(isVisible(visibilityFor(scope, actor), owner)).toBe(expected);
  });
});

describe('tree helpers', () => {
  const nodes = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' },
    { id: 'd', parentId: 'a' },
    { id: 'x', parentId: null },
  ];

  it('subtree includes root and all descendants', () => {
    expect(subtree(nodes, ['b']).sort()).toEqual(['b', 'c']);
    expect(subtree(nodes, ['a']).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('detects cycles, including self-parenting', () => {
    expect(wouldCreateCycle(nodes, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(nodes, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(nodes, 'c', 'd')).toBe(false);
    expect(wouldCreateCycle(nodes, 'c', null)).toBe(false);
  });

  it('terminates on already-cyclic data', () => {
    const cyclic = [
      { id: 'p', parentId: 'q' },
      { id: 'q', parentId: 'p' },
    ];
    expect(subtree(cyclic, ['p']).sort()).toEqual(['p', 'q']);
    expect(depthOf(cyclic, 'p')).toBe(2);
  });

  it('computes depth and subtree height', () => {
    expect(depthOf(nodes, 'c')).toBe(3);
    expect(subtreeHeight(nodes, 'a')).toBe(3);
    expect(subtreeHeight(nodes, 'x')).toBe(1);
  });
});
