import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, resetRateLimits, signupOwner, startTestApp, uniq, type Owner, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => resetRateLimits(t));

async function dept(owner: Owner, name: string, parentId: string | null = null, headEmployeeId: string | null = null) {
  const r = await owner.client.post('/departments', { name, code: uniq('D').toUpperCase().slice(0, 18), parentId, headEmployeeId });
  if (r.status !== 201) throw new Error(`dept: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string; version: number };
}

async function emp(owner: Owner, firstName: string, extra: Record<string, unknown> = {}) {
  const r = await owner.client.post('/employees', { firstName, lastName: 'Test', ...extra });
  if (r.status !== 201) throw new Error(`emp: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string; version: number; employeeCode: string };
}

describe('departments', () => {
  it('builds a hierarchy, prevents cycles and limits depth', async () => {
    const owner = await signupOwner(t);
    const root = await dept(owner, 'Company');
    const a = await dept(owner, 'Sales', root.id);
    const b = await dept(owner, 'Inside Sales', a.id);

    const tree = await owner.client.get('/departments/tree');
    expect(tree.body).toHaveLength(1);
    expect(tree.body[0].children[0].children[0].id).toBe(b.id);

    const cycle = await owner.client.patch(`/departments/${root.id}`, { parentId: b.id, version: root.version });
    expect(cycle.status).toBe(422);
    expect(cycle.body.code).toBe('DEPARTMENT_CYCLE');

    let parent = b.id;
    for (let i = 0; i < 3; i += 1) parent = (await dept(owner, `L${i}`, parent)).id; // depth 6
    const tooDeep = await owner.client.post('/departments', { name: 'Too deep', code: 'DEEP', parentId: parent });
    expect(tooDeep.body.code).toBe('DEPTH_EXCEEDED');

    const dup = await owner.client.post('/departments', { name: 'Dup', code: (await owner.client.get(`/departments/${a.id}`)).body.code });
    expect(dup.status).toBe(409);
  });

  it('archives only empty departments', async () => {
    const owner = await signupOwner(t);
    const d = await dept(owner, 'Ops');
    const e = await emp(owner, 'Olu', { departmentId: d.id });
    const blocked = await owner.client.post(`/departments/${d.id}/archive`);
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ code: 'DEPARTMENT_NOT_EMPTY', employees: 1 });
    await owner.client.patch(`/employees/${e.id}`, { departmentId: null, version: e.version });
    expect((await owner.client.post(`/departments/${d.id}/archive`)).status).toBe(200);
    const archivedAssign = await owner.client.post('/employees', { firstName: 'X', departmentId: d.id });
    expect(archivedAssign.body.code).toBe('DEPARTMENT_NOT_FOUND');
  });
});

describe('teams', () => {
  it('makes the leader a member and lets a team leader manage only their own team', async () => {
    const owner = await signupOwner(t);
    const d = await dept(owner, 'Engineering');
    const leader = await addMember(t, owner.client, 'team_leader', { name: 'Lee Leader' });
    const team = await owner.client.post('/teams', { name: 'Platform', departmentId: d.id, leaderEmployeeId: leader.employeeId });
    expect(team.status).toBe(201);
    expect(team.body.members.map((m: { employeeId: string }) => m.employeeId)).toEqual([leader.employeeId]);

    const other = await owner.client.post('/teams', { name: 'Other', departmentId: d.id, leaderEmployeeId: owner.employeeId });
    const e1 = await emp(owner, 'Mia');

    const add = await leader.client.post(`/teams/${team.body.id}/members`, { employeeId: e1.id });
    expect(add.status).toBe(201);
    expect((await leader.client.post(`/teams/${team.body.id}/members`, { employeeId: e1.id })).body.code).toBe('ALREADY_IN_TEAM');
    expect((await leader.client.post(`/teams/${other.body.id}/members`, { employeeId: e1.id })).status).toBe(403);
    expect((await leader.client.post(`/teams/${team.body.id}/archive`)).status).toBe(403);
    expect((await leader.client.delete(`/teams/${team.body.id}/members/${leader.employeeId}`)).body.code).toBe('LEADER_REMOVAL');
    expect((await leader.client.post('/teams', { name: 'Mine', departmentId: d.id, leaderEmployeeId: leader.employeeId })).status).toBe(403);
  });
});

describe('employees', () => {
  it('creates employees with generated codes and enforces uniqueness', async () => {
    const owner = await signupOwner(t);
    const a = await emp(owner, 'Ana');
    expect(a.employeeCode).toBe('EMP-00002');
    const email = `${uniq('w')}@example.test`;
    await emp(owner, 'Ben', { workEmail: email, employeeCode: 'CUSTOM-1' });
    expect((await owner.client.post('/employees', { firstName: 'C', employeeCode: 'custom-1' })).status).toBe(409);
    const dupEmail = await owner.client.post('/employees', { firstName: 'D', workEmail: email.toUpperCase() });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body).toMatchObject({ code: 'DUPLICATE', field: 'workEmail' });
  });

  it('rejects circular and invalid reporting lines', async () => {
    const owner = await signupOwner(t);
    const ceo = await emp(owner, 'Ceo');
    const vp = await emp(owner, 'Vp', { managerId: ceo.id });
    const ic = await emp(owner, 'Ic', { managerId: vp.id });
    const cur = (await owner.client.get(`/employees/${ceo.id}`)).body;
    const cycle = await owner.client.patch(`/employees/${ceo.id}`, { managerId: ic.id, version: cur.version });
    expect(cycle.status).toBe(422);
    expect(cycle.body.code).toBe('MANAGER_CYCLE');
    const self = await owner.client.patch(`/employees/${ceo.id}`, { managerId: ceo.id, version: cur.version });
    expect(self.body.code).toBe('MANAGER_CYCLE');
    const missing = await owner.client.post('/employees', { firstName: 'X', managerId: '01900000-0000-7000-8000-000000000000' });
    expect(missing.body.code).toBe('MANAGER_NOT_FOUND');
  });

  it('follows the employment state machine and blocks exits with open responsibilities', async () => {
    const owner = await signupOwner(t);
    const boss = await emp(owner, 'Boss');
    const report = await emp(owner, 'Report', { managerId: boss.id });
    const bad = await owner.client.post(`/employees/${boss.id}/status`, { status: 'pre_joining', effectiveDate: '2026-01-01', version: boss.version });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('INVALID_TRANSITION');

    const blocked = await owner.client.post(`/employees/${boss.id}/status`, { status: 'exited', effectiveDate: '2026-12-31', version: boss.version });
    expect(blocked.body.code).toBe('HAS_ACTIVE_REPORTS');
    const r = (await owner.client.get(`/employees/${report.id}`)).body;
    await owner.client.patch(`/employees/${report.id}`, { managerId: null, version: r.version });
    const notice = await owner.client.post(`/employees/${boss.id}/status`, { status: 'notice_period', effectiveDate: '2026-12-01', version: boss.version });
    expect(notice.body.status).toBe('notice_period');
    const exit = await owner.client.post(`/employees/${boss.id}/status`, { status: 'exited', effectiveDate: '2026-12-31', version: notice.body.version });
    expect(exit.status).toBe(200);
    expect(exit.body).toMatchObject({ status: 'exited', exitDate: '2026-12-31' });
    expect((await owner.client.patch(`/employees/${boss.id}`, { jobTitle: 'Ghost', version: exit.body.version })).body.code).toBe('EMPLOYEE_CLOSED');
  });

  it('exiting an employee revokes their access', async () => {
    const owner = await signupOwner(t);
    const m = await addMember(t, owner.client, 'employee');
    const e = (await owner.client.get(`/employees/${m.employeeId}`)).body;
    await owner.client.post(`/employees/${m.employeeId}/status`, { status: 'exited', effectiveDate: '2026-11-18', version: e.version });
    expect((await m.client.get('/me')).status).toBe(401);
    expect((await owner.client.get(`/members/${m.membershipId}`)).body.status).toBe('deactivated');
  });

  it('records effective-dated history and audit events for changes', async () => {
    const owner = await signupOwner(t);
    const d = await dept(owner, 'Finance');
    const e = await emp(owner, 'Hist');
    await owner.client.patch(`/employees/${e.id}`, { departmentId: d.id, jobTitle: 'Analyst', effectiveDate: '2026-12-01', version: e.version });
    const h = await owner.client.get(`/employees/${e.id}/history`);
    expect(h.body.map((x: { type: string }) => x.type)).toEqual(expect.arrayContaining(['created', 'department_changed', 'title_changed']));
    expect(h.body.find((x: { type: string }) => x.type === 'department_changed').effectiveDate).toBe('2026-12-01');
    const audit = await owner.client.get(`/audit-events?entityId=${e.id}`);
    expect(audit.body.items.map((x: { action: string }) => x.action)).toEqual(['employee.updated', 'employee.created']);
    expect(audit.body.items[0].metadata.changes.jobTitle).toEqual(['', 'Analyst']);
  });

  it('rejects stale updates (optimistic locking)', async () => {
    const owner = await signupOwner(t);
    const e = await emp(owner, 'Lock');
    expect((await owner.client.patch(`/employees/${e.id}`, { jobTitle: 'A', version: e.version })).status).toBe(200);
    const stale = await owner.client.patch(`/employees/${e.id}`, { jobTitle: 'B', version: e.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('searches, filters, sorts and paginates server-side', async () => {
    const owner = await signupOwner(t);
    const d = await dept(owner, 'Search Dept');
    for (const n of ['Zara', 'Yusuf', 'Xena', 'Wren', 'Vik']) await emp(owner, n, { departmentId: d.id, jobTitle: 'Searcher' });
    const page1 = await owner.client.get(`/employees?departmentId=${d.id}&limit=2&sort=name&order=asc`);
    expect(page1.body.total).toBe(5);
    expect(page1.body.items.map((e: { firstName: string }) => e.firstName)).toEqual(['Vik', 'Wren']);
    const page2 = await owner.client.get(`/employees?departmentId=${d.id}&limit=2&sort=name&order=asc&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items.map((e: { firstName: string }) => e.firstName)).toEqual(['Xena', 'Yusuf']);
    const search = await owner.client.get('/employees?q=yus');
    expect(search.body.items.map((e: { firstName: string }) => e.firstName)).toEqual(['Yusuf']);
    expect((await owner.client.get('/employees?cursor=garbage')).status).toBe(422);
    expect((await owner.client.get('/employees?limit=500')).status).toBe(422);
  });
});

describe('scoped visibility', () => {
  it('team leaders see their teams, managers their reports, department heads their subtree', async () => {
    const owner = await signupOwner(t);
    const sales = await dept(owner, 'Sales');
    const inside = await dept(owner, 'Inside', sales.id);
    const ops = await dept(owner, 'Ops');

    const head = await addMember(t, owner.client, 'department_head', { name: 'Hea Head' });
    const s = (await owner.client.get(`/departments/${sales.id}`)).body;
    await owner.client.patch(`/departments/${sales.id}`, { headEmployeeId: head.employeeId, version: s.version });

    const leader = await addMember(t, owner.client, 'team_leader', { name: 'Tea Leader' });
    const manager = await addMember(t, owner.client, 'manager', { name: 'Man Ager' });

    const inInside = await emp(owner, 'InsideRep', { departmentId: inside.id });
    const inOps = await emp(owner, 'OpsPerson', { departmentId: ops.id });
    const report = await emp(owner, 'Reportee', { managerId: manager.employeeId });
    const grand = await emp(owner, 'GrandReport', { managerId: report.id });

    const team = await owner.client.post('/teams', { name: 'T1', departmentId: ops.id, leaderEmployeeId: leader.employeeId });
    await owner.client.post(`/teams/${team.body.id}/members`, { employeeId: inOps.id });

    const ids = async (c: typeof owner.client) => ((await c.get('/employees?limit=200')).body.items as { id: string }[]).map((e) => e.id).sort();

    expect(await ids(head.client)).toEqual([head.employeeId, inInside.id].sort());
    expect(await ids(leader.client)).toEqual([leader.employeeId, inOps.id].sort());
    expect(await ids(manager.client)).toEqual([manager.employeeId, report.id, grand.id].sort());

    expect((await leader.client.get(`/employees/${inInside.id}`)).status).toBe(404);
    expect((await manager.client.get(`/employees/${grand.id}/history`)).status).toBe(200);
    // Managers can read but not edit their reports.
    expect((await manager.client.patch(`/employees/${report.id}`, { jobTitle: 'x', version: 1 })).status).toBe(403);
    // Department heads can edit within their subtree only.
    const ins = (await owner.client.get(`/employees/${inInside.id}`)).body;
    expect((await head.client.patch(`/employees/${inInside.id}`, { jobTitle: 'Senior', version: ins.version })).status).toBe(200);
    expect((await head.client.patch(`/employees/${inOps.id}`, { jobTitle: 'x', version: 1 })).status).toBe(404);
  });
});
