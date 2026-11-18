import { createPrismaClient, type PrismaClient } from '@omnitrack/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, addMember, lastEmail, newClient, resetRateLimits, roleId, signupOwner, startTestApp, uniq, type Owner, type TestContext } from './helpers';
import { testUrls } from './test-env';

/**
 * Cross-tenant isolation (SECURITY.md §1, AC-B1). Organization B's administrator attacks
 * organization A by ID through every tenant-scoped route; every attempt must yield 404
 * (never 403, never data). Then the same guarantees are checked directly at the database.
 */
let t: TestContext;
let a: Owner;
let b: Owner;
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await startTestApp();
  await resetRateLimits(t);
  a = await signupOwner(t, { name: 'Alpha Owner' });
  b = await signupOwner(t, { name: 'Bravo Owner' });

  const d = await a.client.post('/departments', { name: 'Alpha Dept', code: 'ALPHA' });
  ids.department = d.body.id;
  const e = await a.client.post('/employees', { firstName: 'Alpha', lastName: 'Secret', departmentId: ids.department, workEmail: `${uniq('as')}@example.test` });
  ids.employee = e.body.id;
  const team = await a.client.post('/teams', { name: 'Alpha Team', departmentId: ids.department, leaderEmployeeId: a.employeeId });
  ids.team = team.body.id;
  const role = await a.client.post('/roles', { name: 'Alpha Custom', grants: { 'employee.read': 'organization' } });
  ids.role = role.body.id;
  const member = await addMember(t, a.client, 'employee');
  ids.membership = member.membershipId;
  const inv = await a.client.post('/invitations', { email: `${uniq('ai')}@example.test`, roleId: await roleId(a.client, 'employee') });
  ids.invitation = inv.body.id;
});
afterAll(async () => t.close());

describe('API: organization B cannot reach organization A by ID', () => {
  const reads = [
    ['GET', '/employees/:employee'],
    ['GET', '/employees/:employee/history'],
    ['GET', '/employees/:employee/direct-reports'],
    ['GET', '/departments/:department'],
    ['GET', '/teams/:team'],
    ['GET', '/roles/:role'],
    ['GET', '/members/:membership'],
  ] as const;
  const writes = [
    ['PATCH', '/employees/:employee', { jobTitle: 'pwned', version: 1 }],
    ['POST', '/employees/:employee/status', { status: 'exited', effectiveDate: '2026-12-31', version: 1 }],
    ['PATCH', '/departments/:department', { name: 'pwned', version: 1 }],
    ['POST', '/departments/:department/archive', {}],
    ['PATCH', '/teams/:team', { name: 'pwned', version: 1 }],
    ['POST', '/teams/:team/members', { employeeId: '{employee}' }],
    ['POST', '/teams/:team/archive', {}],
    ['PATCH', '/roles/:role', { name: 'pwned', version: 1 }],
    ['DELETE', '/roles/:role', undefined],
    ['POST', '/members/:membership/deactivate', {}],
    ['PUT', '/members/:membership/roles', { roleIds: ['{role}'] }],
    ['DELETE', '/invitations/:invitation', undefined],
  ] as const;

  const fill = (path: string) => path.replace(/:(\w+)/g, (_, k: string) => ids[k]!);
  const fillBody = (body: object | undefined) =>
    body && JSON.parse(JSON.stringify(body).replace(/\{(\w+)\}/g, (_, k: string) => ids[k]!));

  it.each(reads)('%s %s → 404', async (_m, path) => {
    const r = await b.client.get(fill(path));
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('Alpha');
  });

  it.each(writes)('%s %s → 404 and nothing changes', async (method, path, body) => {
    const c = b.client;
    const url = fill(path);
    const payload = fillBody(body as object | undefined);
    const r =
      method === 'PATCH' ? await c.patch(url, payload) : method === 'PUT' ? await c.put(url, payload) : method === 'DELETE' ? await c.delete(url) : await c.post(url, payload);
    expect(r.status).toBe(404);
  });

  it('A’s data is unchanged after the attacks', async () => {
    const e = await a.client.get(`/employees/${ids.employee}`);
    expect(e.body).toMatchObject({ jobTitle: '', status: 'active' });
    expect((await a.client.get(`/departments/${ids.department}`)).body.name).toBe('Alpha Dept');
    expect((await a.client.get(`/members/${ids.membership}`)).body.status).toBe('active');
  });

  it('list endpoints never include another organization’s rows', async () => {
    for (const path of ['/employees?limit=200', '/departments', '/teams', '/roles', '/members', '/invitations', '/audit-events?limit=200']) {
      const r = await b.client.get(path);
      expect(r.status, path).toBe(200);
      expect(JSON.stringify(r.body), path).not.toMatch(/Alpha/);
    }
  });

  it('references to another organization’s records are rejected on create', async () => {
    const r1 = await b.client.post('/employees', { firstName: 'X', departmentId: ids.department });
    expect(r1.body.code).toBe('DEPARTMENT_NOT_FOUND');
    const r2 = await b.client.post('/employees', { firstName: 'X', managerId: ids.employee });
    expect(r2.body.code).toBe('MANAGER_NOT_FOUND');
    const r3 = await b.client.post('/teams', { name: 'X', departmentId: ids.department, leaderEmployeeId: b.employeeId });
    expect(r3.body.code).toBe('DEPARTMENT_NOT_FOUND');
    const r4 = await b.client.post('/invitations', { email: `${uniq('x')}@example.test`, roleId: ids.role });
    expect(r4.body.code).toBe('ROLE_NOT_FOUND');
    const r5 = await b.client.post('/invitations', { email: `${uniq('x')}@example.test`, roleId: await roleId(b.client, 'employee'), employeeId: ids.employee });
    expect(r5.body.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('an invitation token from A always joins A, whoever presents it', async () => {
    const email = `${uniq('tok')}@example.test`;
    await a.client.post('/invitations', { email, roleId: await roleId(a.client, 'employee') });
    const token = (await lastEmail(t, email, 'invitation')).data.token;
    const c = await newClient(t);
    await c.post('/invitations/accept', { token, displayName: 'Tok', password: PASSWORD });
    expect((await c.get('/me')).body.organization.id).toBe(a.organizationId);
  });
});

describe('Database: row-level security as the application role', () => {
  let app: PrismaClient;
  beforeAll(() => {
    app = createPrismaClient(testUrls().app);
  });
  afterAll(async () => app.$disconnect());

  const tenantTables = ['employees', 'departments', 'teams', 'team_members', 'roles', 'role_permissions', 'membership_roles', 'invitations', 'employment_events', 'org_counters', 'audit_events'];

  it('sees no tenant rows at all without a tenant context', async () => {
    for (const table of [...tenantTables, 'memberships']) {
      // eslint-disable-next-line no-restricted-syntax
      const rows = await app.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM ${table}`);
      expect(Number(rows[0]!.n), table).toBe(0);
    }
  });

  it('sees only the current organization’s rows with a context', async () => {
    const counts = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${b.organizationId}, true)`;
      return {
        mine: await tx.employee.count({ where: { organizationId: b.organizationId } }),
        theirs: await tx.employee.count({ where: { organizationId: a.organizationId } }),
        theirsById: await tx.employee.findUnique({ where: { id: ids.employee! } }),
      };
    });
    expect(counts.mine).toBeGreaterThan(0);
    expect(counts.theirs).toBe(0);
    expect(counts.theirsById).toBeNull();
  });

  it('cannot write rows into another organization', async () => {
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${b.organizationId}, true)`;
        await tx.department.create({ data: { organizationId: a.organizationId, name: 'Smuggled', code: 'SMUG' } });
      }),
    ).rejects.toThrow(/row-level security/);
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${b.organizationId}, true)`;
        return tx.employee.updateMany({ where: { id: ids.employee! }, data: { jobTitle: 'pwned' } });
      }),
    ).resolves.toEqual({ count: 0 });
  });

  it('does not leak tenant context between transactions on pooled connections', async () => {
    const pool = createPrismaClient(`${testUrls().app}${testUrls().app.includes('?') ? '&' : '?'}connection_limit=1`);
    await pool.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${a.organizationId}, true)`;
      expect(await tx.employee.count()).toBeGreaterThan(0);
    });
    // Same single connection, new transaction, no context → nothing visible.
    expect(await pool.employee.count()).toBe(0);
    await pool.$disconnect();
  });

  it('cannot modify or delete audit events, nor read the outbox', async () => {
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${a.organizationId}, true)`;
        await tx.$executeRaw`UPDATE audit_events SET action = 'tampered'`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${a.organizationId}, true)`;
        await tx.$executeRaw`DELETE FROM audit_events`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(app.$queryRaw`SELECT * FROM outbox_events LIMIT 1`).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`UPDATE login_events SET outcome = 'success'`).rejects.toThrow(/permission denied/);
  });

  it('every table with organization_id has forced RLS and a policy (except documented exceptions)', async () => {
    // Global tables keyed by organization but intentionally outside RLS (see DATABASE.md §3):
    // sessions and login_events are looked up before any tenant context exists; the outbox
    // is protected by grants instead.
    const exceptions = new Set(['sessions', 'login_events', 'outbox_events']);
    const rows = await t.db.$queryRaw<{ table: string; rls: boolean; forced: boolean; policies: bigint }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id'
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace`;
    const missing = rows.filter((r) => !exceptions.has(r.table) && (!r.rls || !r.forced || Number(r.policies) === 0));
    expect(missing).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(tenantTables.length);
  });
});
