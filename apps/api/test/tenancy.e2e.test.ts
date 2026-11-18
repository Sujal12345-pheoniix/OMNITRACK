import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  addMember,
  enrolMfa,
  freshTotp,
  lastEmail,
  newClient,
  resetRateLimits,
  roleId,
  signupOwner,
  startTestApp,
  uniq,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => resetRateLimits(t));

describe('organization creation', () => {
  it('provisions built-in roles, an owner employee and an audit record', async () => {
    const owner = await signupOwner(t);
    const roles = await owner.client.get('/roles');
    expect(roles.status).toBe(200);
    expect(roles.body.map((r: { key: string }) => r.key)).toEqual(
      expect.arrayContaining(['org_owner', 'org_admin', 'hr_manager', 'department_head', 'manager', 'team_leader', 'recruiter', 'employee']),
    );
    const me = await owner.client.get('/me');
    expect(me.body.membership.roles.map((r: { key: string }) => r.key)).toEqual(['org_owner']);
    const emp = await owner.client.get(`/employees/${owner.employeeId}`);
    expect(emp.body).toMatchObject({ employeeCode: 'EMP-00001', workEmail: owner.email, hasLogin: true });
    const audit = await owner.client.get('/audit-events?action=organization.created');
    expect(audit.body.items).toHaveLength(1);
  });

  it('lets a user create a second organization, switch to it, and keeps them independent', async () => {
    const owner = await signupOwner(t);
    const slug = uniq('second-');
    const created = await owner.client.post('/organizations', { name: 'Second Org', slug });
    expect(created.status).toBe(201);

    const me1 = await owner.client.get('/me');
    expect(me1.body.organizations).toHaveLength(2);
    expect(me1.body.organization.id).toBe(owner.organizationId);

    expect((await owner.client.post('/auth/switch-organization', { organizationId: created.body.id })).status).toBe(204);
    const me2 = await owner.client.get('/me');
    expect(me2.body.organization.slug).toBe(slug);
    // Fresh tenant: only its own owner employee is visible.
    const list = await owner.client.get('/employees');
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).not.toBe(owner.employeeId);
  });

  it('refuses to switch into an organization the user does not belong to', async () => {
    const a = await signupOwner(t);
    const b = await signupOwner(t);
    const r = await a.client.post('/auth/switch-organization', { organizationId: b.organizationId });
    expect(r.status).toBe(404);
  });

  it('updates organization settings with optimistic locking', async () => {
    const owner = await signupOwner(t);
    const org = await owner.client.get('/organization');
    const ok = await owner.client.patch('/organization', { timezone: 'Asia/Kolkata', version: org.body.version });
    expect(ok.status).toBe(200);
    expect(ok.body.timezone).toBe('Asia/Kolkata');
    const stale = await owner.client.patch('/organization', { name: 'Stale', version: org.body.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });
});

describe('invitations and membership', () => {
  it('invites a new person who sets a password, joins with the role and gets an employee record', async () => {
    const owner = await signupOwner(t);
    const preview = await newClient(t);
    const email = `${uniq('inv')}@example.test`;
    await owner.client.post('/invitations', { email, roleId: await roleId(owner.client, 'hr_manager') });
    const mail = await lastEmail(t, email, 'invitation');
    const p = await preview.post('/invitations/preview', { token: mail.data.token });
    expect(p.body).toMatchObject({ email, roleName: 'HR manager', accountExists: false });

    const accept = await preview.post('/invitations/accept', { token: mail.data.token, displayName: 'Hana Hr', password: PASSWORD });
    expect(accept.status).toBe(200);
    const me = await preview.get('/me');
    expect(me.body.organization.id).toBe(owner.organizationId);
    expect(me.body.permissions['employee.create']).toBe('organization');

    // Token is single use.
    const again = await (await newClient(t)).post('/invitations/accept', { token: mail.data.token, displayName: 'X', password: PASSWORD });
    expect(again.status).toBe(410);

    const members = await owner.client.get('/members');
    expect(members.body.map((m: { email: string }) => m.email)).toContain(email);
  });

  it('requires an existing account holder to sign in as that account before accepting', async () => {
    const a = await signupOwner(t);
    const b = await signupOwner(t);
    await a.client.post('/invitations', { email: b.email, roleId: await roleId(a.client, 'employee') });
    const mail = await lastEmail(t, b.email, 'invitation');

    const anon = await newClient(t);
    const refused = await anon.post('/invitations/accept', { token: mail.data.token });
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('LOGIN_REQUIRED');

    const accepted = await b.client.post('/invitations/accept', { token: mail.data.token });
    expect(accepted.status).toBe(200);
    const me = await b.client.get('/me');
    expect(me.body.organization.id).toBe(a.organizationId);
    expect(me.body.organizations).toHaveLength(2);
  });

  it('links the invitation to an existing employee record when one is given', async () => {
    const owner = await signupOwner(t);
    const emp = await owner.client.post('/employees', { firstName: 'Existing', lastName: 'Person', workEmail: `${uniq('ex')}@example.test` });
    const member = await addMember(t, owner.client, 'employee', { employeeId: emp.body.id });
    expect(member.employeeId).toBe(emp.body.id);
    expect((await owner.client.get(`/employees/${emp.body.id}`)).body.hasLogin).toBe(true);
  });

  it('rejects expired and revoked invitations', async () => {
    const owner = await signupOwner(t);
    const e1 = `${uniq('exp')}@example.test`;
    await owner.client.post('/invitations', { email: e1, roleId: await roleId(owner.client, 'employee') });
    await t.db.invitation.updateMany({ where: { email: e1 }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const tok1 = (await lastEmail(t, e1, 'invitation')).data.token;
    expect((await (await newClient(t)).post('/invitations/accept', { token: tok1, displayName: 'E', password: PASSWORD })).status).toBe(410);

    const e2 = `${uniq('rev')}@example.test`;
    const inv = await owner.client.post('/invitations', { email: e2, roleId: await roleId(owner.client, 'employee') });
    expect((await owner.client.delete(`/invitations/${inv.body.id}`)).status).toBe(204);
    const tok2 = (await lastEmail(t, e2, 'invitation')).data.token;
    expect((await (await newClient(t)).post('/invitations/accept', { token: tok2, displayName: 'R', password: PASSWORD })).status).toBe(410);
  });

  it('deactivating a member ends their sessions immediately; reactivation restores access', async () => {
    const owner = await signupOwner(t);
    const m = await addMember(t, owner.client, 'employee');
    expect((await m.client.get('/me')).status).toBe(200);
    const d = await owner.client.post(`/members/${m.membershipId}/deactivate`);
    expect(d.status).toBe(200);
    expect(d.body.status).toBe('deactivated');
    expect((await m.client.get('/employees')).status).toBe(401);
    expect((await owner.client.post(`/members/${m.membershipId}/reactivate`)).status).toBe(200);
    const c = await newClient(t);
    expect((await c.post('/auth/login', { email: m.email, password: PASSWORD })).status).toBe(200);
    expect((await c.get('/me')).body.organization.id).toBe(owner.organizationId);
  });

  it('keeps at least one owner', async () => {
    const owner = await signupOwner(t);
    const me = await owner.client.get('/me');
    const selfDeactivate = await owner.client.post(`/members/${me.body.membership.id}/deactivate`);
    expect(selfDeactivate.body.code).toBe('CANNOT_DEACTIVATE_SELF');
    const demote = await owner.client.put(`/members/${me.body.membership.id}/roles`, { roleIds: [await roleId(owner.client, 'org_admin')] });
    expect(demote.status).toBe(422);
    expect(demote.body.code).toBe('LAST_OWNER');
  });
});

describe('roles and permissions', () => {
  it('enforces permissions server-side for an ordinary employee', async () => {
    const owner = await signupOwner(t);
    const m = await addMember(t, owner.client, 'employee');
    expect((await m.client.post('/employees', { firstName: 'Nope' })).status).toBe(403);
    expect((await m.client.get('/members')).status).toBe(403);
    expect((await m.client.get('/audit-events')).status).toBe(403);
    expect((await m.client.post('/roles', { name: 'Mine', grants: { 'employee.read': 'own' } })).status).toBe(403);
    // Own record only.
    const list = await m.client.get('/employees');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(m.employeeId);
    expect((await m.client.get(`/employees/${owner.employeeId}`)).status).toBe(404);
  });

  it('creates custom roles and applies them on the next request', async () => {
    const owner = await signupOwner(t);
    const m = await addMember(t, owner.client, 'employee');
    const role = await owner.client.post('/roles', {
      name: 'Directory reader',
      description: 'Can see everyone',
      grants: { 'employee.read': 'organization', 'member.read': 'organization' },
    });
    expect(role.status).toBe(201);
    expect((await m.client.get('/members')).status).toBe(403);
    const assign = await owner.client.put(`/members/${m.membershipId}/roles`, { roleIds: [await roleId(owner.client, 'employee'), role.body.id] });
    expect(assign.status).toBe(200);
    expect((await m.client.get('/members')).status).toBe(200);
    expect((await m.client.get('/employees')).body.total).toBe(2);

    // A role in use cannot be deleted.
    const del = await owner.client.delete(`/roles/${role.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('ROLE_IN_USE');
  });

  it('validates grants against the catalog and refuses changes to built-in roles', async () => {
    const owner = await signupOwner(t);
    const bad = await owner.client.post('/roles', { name: 'Bad', grants: { 'employee.read': 'galaxy', 'made.up': 'own' } });
    expect(bad.status).toBe(422);
    const builtIn = await owner.client.patch(`/roles/${await roleId(owner.client, 'employee')}`, { name: 'Hacked', version: 1 });
    expect(builtIn.status).toBe(422);
    expect(builtIn.body.code).toBe('BUILT_IN_ROLE_IMMUTABLE');
  });

  it('prevents privilege escalation through roles', async () => {
    const owner = await signupOwner(t);
    // A delegated role manager who does not hold audit.read.
    const delegate = await owner.client.post('/roles', {
      name: 'Role steward',
      grants: { 'role.read': 'organization', 'role.manage': 'organization', 'member.roles.assign': 'organization', 'member.read': 'organization' },
    });
    const m = await addMember(t, owner.client, 'employee');
    await owner.client.put(`/members/${m.membershipId}/roles`, { roleIds: [delegate.body.id] });

    const escalate = await m.client.post('/roles', { name: 'Auditor', grants: { 'audit.read': 'organization' } });
    expect(escalate.status).toBe(403);
    expect(escalate.body.code).toBe('ESCALATION_DENIED');

    const toAdmin = await m.client.put(`/members/${m.membershipId}/roles`, { roleIds: [await roleId(owner.client, 'org_admin')] });
    expect(toAdmin.status).toBe(403);
    expect(toAdmin.body.code).toBe('ESCALATION_DENIED');
  });

  it('only owners can grant the owner role', async () => {
    const owner = await signupOwner(t);
    const admin = await addMember(t, owner.client, 'org_admin');
    await enrolMfa(admin.client);
    const target = await addMember(t, owner.client, 'employee');
    const r = await admin.client.put(`/members/${target.membershipId}/roles`, { roleIds: [await roleId(owner.client, 'org_owner')] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ESCALATION_DENIED');
  });
});

describe('platform administration', () => {
  it('creates organizations with an owner invitation and suspends them', { timeout: 90_000 }, async () => {
    // A platform admin is designated out-of-band (database), never through the API.
    const admin = await signupOwner(t);
    await t.db.user.update({ where: { id: admin.userId }, data: { platformRole: 'super_admin' } });

    const tenant = await signupOwner(t);
    const member = await addMember(t, tenant.client, 'employee');

    const ownerOnly = await tenant.client.get('/platform/organizations');
    expect(ownerOnly.status).toBe(403);

    const list = await admin.client.get('/platform/organizations');
    expect(list.status).toBe(200);

    const newOwner = `${uniq('po')}@example.test`;
    const created = await admin.client.post('/platform/organizations', { name: 'Platform Made', slug: uniq('pm-'), ownerEmail: newOwner });
    expect(created.status).toBe(201);
    expect((await lastEmail(t, newOwner, 'invitation')).data.roleName).toBe('Organization owner');

    const s = await admin.client.post(`/platform/organizations/${tenant.organizationId}/suspend`);
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('suspended');
    expect((await member.client.get('/me')).status).toBe(401);
    // Members of a suspended organization can no longer sign into it.
    const c = await newClient(t);
    await c.post('/auth/login', { email: member.email, password: PASSWORD });
    expect((await c.get('/employees')).body.code).toBe('NO_ORGANIZATION');

    expect((await admin.client.post(`/platform/organizations/${tenant.organizationId}/reactivate`)).status).toBe(200);
    const c2 = await newClient(t);
    await c2.post('/auth/login', { email: tenant.email, password: PASSWORD });
    expect((await c2.post('/auth/mfa/verify', { code: await freshTotp(tenant.mfaSecret) })).status).toBe(200);
    expect((await c2.get('/me')).body.organization.id).toBe(tenant.organizationId);

    const audit = await t.db.auditEvent.findMany({ where: { organizationId: tenant.organizationId, action: { startsWith: 'organization.' } } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['organization.suspended', 'organization.reactivated']));
    expect(audit.find((a) => a.action === 'organization.suspended')?.actorType).toBe('platform_admin');
  });

  it('serves a public profile for active organizations only', async () => {
    const owner = await signupOwner(t);
    const anon = await newClient(t);
    const r = await anon.get(`/public/organizations/${owner.slug}`);
    expect(r.body).toEqual({ name: `Org ${owner.slug}`, slug: owner.slug });
    expect((await anon.get('/public/organizations/does-not-exist')).status).toBe(404);
  });
});
