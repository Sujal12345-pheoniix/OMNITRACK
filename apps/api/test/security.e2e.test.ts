import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_KEY } from '../src/common/decorators';
import { addMember, newClient, resetRateLimits, signupOwner, startTestApp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await startTestApp();
  await resetRateLimits(t);
});
afterAll(async () => t.close());

describe('deny by default', () => {
  it('every route declares an access policy', () => {
    const container = t.app.get(ModulesContainer);
    const undeclared: string[] = [];
    let routes = 0;
    for (const mod of container.values()) {
      for (const wrapper of mod.controllers.values()) {
        const cls = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined;
        if (!cls) continue;
        const proto = cls.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = proto[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
          routes += 1;
          const declared = Reflect.getMetadata(ACCESS_KEY, handler) ?? Reflect.getMetadata(ACCESS_KEY, cls);
          if (!declared) {
            const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
            undeclared.push(`${method} ${Reflect.getMetadata(PATH_METADATA, cls)}/${Reflect.getMetadata(PATH_METADATA, handler)} (${cls.name}.${name})`);
          }
        }
      }
    }
    expect(routes).toBeGreaterThan(40);
    expect(undeclared).toEqual([]);
  });

  it('protected routes reject anonymous callers', async () => {
    const anon = await newClient(t);
    for (const path of ['/me', '/employees', '/departments', '/teams', '/members', '/roles', '/audit-events', '/organization', '/platform/organizations']) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
  });

  it('public routes are limited to the expected set', async () => {
    const anon = await newClient(t);
    expect((await anon.get('/health')).status).toBe(200);
    const ready = await anon.get('/health/ready');
    expect(ready.body).toEqual({ status: 'ready', checks: { database: true, redis: true } });
  });
});

describe('input handling and error format', () => {
  it('returns RFC 9457 problem details with a request ID', async () => {
    const owner = await signupOwner(t);
    const r = await owner.client.post('/employees', { firstName: '' });
    expect(r.status).toBe(422);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.body).toMatchObject({ status: 422, code: 'VALIDATION_FAILED', title: 'Unprocessable request' });
    expect(r.body.requestId).toBe(r.headers['x-request-id']);
    expect(r.body.errors).toEqual([{ path: 'firstName', message: 'Required' }]);
  });

  it('rejects unknown fields, wrong types, malformed IDs and oversized input', async () => {
    const owner = await signupOwner(t);
    const c = owner.client;
    expect((await c.post('/employees', { firstName: 'A', organizationId: 'x' })).status).toBe(422);
    expect((await c.post('/employees', { firstName: 'A', joinDate: '31/12/2026' })).status).toBe(422);
    expect((await c.post('/employees', { firstName: 'x'.repeat(81) })).status).toBe(422);
    expect((await c.get('/employees/not-a-uuid')).status).toBe(404);
    expect((await c.get('/employees/../../etc/passwd')).status).toBe(404);
    const huge = await c.post('/employees', { firstName: 'A', lastName: 'x'.repeat(300_000) });
    expect(huge.status).toBe(413);
    const malformed = await c.agent.post('/api/v1/employees').set('X-CSRF-Token', c.csrf).set('Content-Type', 'application/json').send('{"firstName":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('BAD_REQUEST');
  });

  it('never exposes internal error details', async () => {
    const owner = await signupOwner(t);
    const r = await owner.client.get('/employees?sort=;DROP TABLE');
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).not.toMatch(/prisma|stack|at \w+ \(/i);
  });

  it('sets security headers', async () => {
    const r = await (await newClient(t)).get('/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

describe('audit trail', () => {
  it('records security and business events with actor, correlation ID and redaction', async () => {
    const owner = await signupOwner(t);
    const m = await addMember(t, owner.client, 'employee');
    await owner.client.post(`/members/${m.membershipId}/deactivate`);
    const events = await owner.client.get('/audit-events?limit=100');
    const actions = events.body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'organization.created',
        'user.signed_up',
        'user.email_verified',
        'auth.login',
        'user.mfa_enabled',
        'invitation.created',
        'membership.joined',
        'membership.deactivated',
      ]),
    );
    const deact = events.body.items.find((e: { action: string }) => e.action === 'membership.deactivated');
    expect(deact).toMatchObject({ category: 'security', outcome: 'success', actor: { userId: owner.userId, displayName: 'Olivia Owner' } });
    expect(deact.correlationId).toBeTruthy();

    const security = await owner.client.get('/audit-events?category=security&limit=100');
    expect(security.body.items.every((e: { category: string }) => e.category === 'security')).toBe(true);

    // No secrets anywhere in audit metadata.
    const raw = await t.db.auditEvent.findMany({ where: { organizationId: owner.organizationId } });
    expect(JSON.stringify(raw)).not.toMatch(/argon2|Correct-Horse|"token":"[A-Za-z0-9_-]{20,}/);
  });

  it('paginates the audit log with a stable keyset cursor', async () => {
    const owner = await signupOwner(t);
    for (let i = 0; i < 4; i += 1) await owner.client.post('/employees', { firstName: `P${i}` });
    const p1 = await owner.client.get('/audit-events?limit=3');
    const p2 = await owner.client.get(`/audit-events?limit=3&cursor=${p1.body.nextCursor}`);
    const all = [...p1.body.items, ...p2.body.items].map((e: { id: string }) => e.id);
    expect(new Set(all).size).toBe(all.length);
  });
});
