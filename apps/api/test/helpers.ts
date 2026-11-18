import type { INestApplication } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@omnitrack/db';
import Redis from 'ioredis';
import { authenticator } from 'otplib';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createApp } from '../src/bootstrap';
import { loadEnv, type Env } from '../src/config/env';
import { testUrls } from './test-env';

export const PASSWORD = 'Correct-Horse-Battery-9917';
export const API = '/api/v1';

let seq = 0;
/** Unique, readable identifiers per test run. */
export function uniq(prefix = 't'): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

export interface TestContext {
  app: INestApplication;
  server: Parameters<typeof request>[0];
  env: Env;
  /** Superuser connection: inspects data underneath RLS. Test-only. */
  db: PrismaClient;
  redis: Redis;
  close(): Promise<void>;
}

export async function startTestApp(overrides: Partial<Record<string, string>> = {}): Promise<TestContext> {
  const urls = testUrls();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: urls.app,
    REDIS_URL: urls.redis,
    WEB_ORIGIN: 'http://localhost:3100',
    PORTAL_ORIGIN: 'http://localhost:3200',
    APP_BASE_URL: 'http://localhost:3100',
    COOKIE_SECURE: 'false',
    SELF_SERVICE_SIGNUP: 'true',
    MFA_ENFORCE_PRIVILEGED: 'true',
    HIBP_ENABLED: 'false',
    ...overrides,
  });
  const app = await createApp(env, { logger: false });
  await app.init();
  const db = createPrismaClient(urls.superuser);
  const redis = new Redis(urls.redis);
  return {
    app,
    server: app.getHttpServer(),
    env,
    db,
    redis,
    async close() {
      await app.close();
      await db.$disconnect();
      redis.disconnect();
    },
  };
}

/** Clears rate-limit counters so unrelated tests do not throttle each other. */
export async function resetRateLimits(t: TestContext): Promise<void> {
  const keys = await t.redis.keys('rl:*');
  if (keys.length) await t.redis.del(...keys);
}

/** A browser-like client: keeps cookies and sends the CSRF header on unsafe requests. */
export class Client {
  readonly agent: TestAgent;
  csrf = '';

  constructor(server: Parameters<typeof request>[0]) {
    this.agent = request.agent(server);
  }

  async init(): Promise<this> {
    const r = await this.agent.get(`${API}/auth/csrf`);
    this.csrf = r.body.csrfToken;
    return this;
  }

  get(path: string) {
    return this.agent.get(API + path);
  }
  post(path: string, body?: object) {
    return this.agent.post(API + path).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  patch(path: string, body?: object) {
    return this.agent.patch(API + path).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  put(path: string, body?: object) {
    return this.agent.put(API + path).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  delete(path: string) {
    return this.agent.delete(API + path).set('X-CSRF-Token', this.csrf);
  }
}

export async function newClient(t: TestContext): Promise<Client> {
  return new Client(t.server).init();
}

/** Reads the most recent email to `to` from the outbox, as a mailbox would receive it. */
export async function lastEmail(t: TestContext, to: string, template?: string): Promise<{ template: string; data: Record<string, string> }> {
  const rows = await t.db.$queryRaw<{ payload: { to: string; template: string; data: Record<string, string> } }[]>`
    SELECT payload FROM outbox_events WHERE type = 'email.send' AND payload->>'to' = ${to}
    ORDER BY created_at DESC, id DESC LIMIT 20`;
  const match = rows.map((r) => r.payload).find((p) => !template || p.template === template);
  if (!match) throw new Error(`No ${template ?? ''} email found for ${to}`);
  return match;
}

export interface Owner {
  client: Client;
  email: string;
  slug: string;
  organizationId: string;
  employeeId: string;
  userId: string;
  mfaSecret: string;
}

/** Signs up a new organization, verifies email, signs in and enrols MFA (required for owners). */
export async function signupOwner(t: TestContext, opts: { name?: string; slug?: string; email?: string } = {}): Promise<Owner> {
  const slug = opts.slug ?? uniq('org-');
  const email = opts.email ?? `${uniq('owner')}@example.test`;
  const c = await newClient(t);
  const s = await c.post('/auth/signup', {
    displayName: opts.name ?? 'Olivia Owner',
    email,
    password: PASSWORD,
    organizationName: `Org ${slug}`,
    organizationSlug: slug,
  });
  if (s.status !== 202) throw new Error(`signup failed: ${s.status} ${JSON.stringify(s.body)}`);
  const verify = await lastEmail(t, email, 'verify_email');
  const v = await c.post('/auth/email/verify', { token: verify.data.token });
  if (v.status !== 200) throw new Error(`verify failed: ${v.status}`);
  const l = await c.post('/auth/login', { email, password: PASSWORD });
  if (l.status !== 200) throw new Error(`login failed: ${l.status} ${JSON.stringify(l.body)}`);
  const mfaSecret = await enrolMfa(c);
  const me = await c.get('/me');
  return {
    client: c,
    email,
    slug,
    organizationId: me.body.organization.id,
    employeeId: me.body.membership.employeeId,
    userId: me.body.user.id,
    mfaSecret,
  };
}

export async function enrolMfa(c: Client): Promise<string> {
  const setup = await c.post('/me/mfa/totp/setup');
  if (setup.status !== 201) throw new Error(`mfa setup failed: ${setup.status} ${JSON.stringify(setup.body)}`);
  const secret: string = setup.body.secret;
  const en = await c.post('/me/mfa/totp/enable', { code: authenticator.generate(secret) });
  if (en.status !== 201) throw new Error(`mfa enable failed: ${en.status} ${JSON.stringify(en.body)}`);
  markTotpUsed(secret);
  return secret;
}

export async function roleId(owner: Client, key: string): Promise<string> {
  const r = await owner.get('/roles');
  const role = (r.body as { id: string; key: string }[]).find((x) => x.key === key);
  if (!role) throw new Error(`role ${key} not found`);
  return role.id;
}

export interface Member {
  client: Client;
  email: string;
  employeeId: string;
  membershipId: string;
  userId: string;
}

/** Invites a new person with a role and accepts as them; returns their signed-in client. */
export async function addMember(
  t: TestContext,
  owner: Client,
  roleKey: string,
  opts: { email?: string; employeeId?: string; name?: string } = {},
): Promise<Member> {
  const email = opts.email ?? `${uniq('m')}@example.test`;
  const inv = await owner.post('/invitations', { email, roleId: await roleId(owner, roleKey), ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const mail = await lastEmail(t, email, 'invitation');
  const c = await newClient(t);
  const acc = await c.post('/invitations/accept', { token: mail.data.token, displayName: opts.name ?? 'Member Person', password: PASSWORD });
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);
  const me = await c.get('/me');
  if (me.status !== 200) throw new Error(`me failed after accept: ${me.status} ${JSON.stringify(me.body)}`);
  return { client: c, email, employeeId: me.body.membership.employeeId, membershipId: me.body.membership.id, userId: me.body.user.id };
}

export function totp(secret: string): string {
  return authenticator.generate(secret);
}

const usedSteps = new Map<string, number>();
const step = () => Math.floor(Date.now() / 30_000);

/**
 * A TOTP code that has not been used yet. The server rejects replays of a time step that
 * was already accepted, so this waits for the next 30-second step when necessary.
 */
export async function freshTotp(secret: string): Promise<string> {
  if ((usedSteps.get(secret) ?? -1) >= step()) {
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 200));
  }
  usedSteps.set(secret, step());
  return authenticator.generate(secret);
}

/** Record that a code for the current step was consumed (e.g. at enrolment). */
export function markTotpUsed(secret: string): void {
  usedSteps.set(secret, step());
}
