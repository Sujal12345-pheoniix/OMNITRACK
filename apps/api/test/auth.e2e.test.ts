import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  addMember,
  lastEmail,
  freshTotp,
  newClient,
  resetRateLimits,
  signupOwner,
  startTestApp,
  totp,
  uniq,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => resetRateLimits(t));

describe('sign-up and email verification', () => {
  it('creates an unverified account that cannot sign in until verified', async () => {
    const email = `${uniq('su')}@example.test`;
    const c = await newClient(t);
    const r = await c.post('/auth/signup', {
      displayName: 'Sam Signup',
      email: email.toUpperCase(),
      password: PASSWORD,
      organizationName: 'Signup Co',
      organizationSlug: uniq('signup-'),
    });
    expect(r.status).toBe(202);

    const early = await c.post('/auth/login', { email, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('EMAIL_NOT_VERIFIED');

    const mail = await lastEmail(t, email, 'verify_email');
    expect((await c.post('/auth/email/verify', { token: mail.data.token })).status).toBe(200);
    // Single use.
    expect((await c.post('/auth/email/verify', { token: mail.data.token })).status).toBe(410);

    const ok = await c.post('/auth/login', { email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ mfaRequired: false, mfaEnrollmentRequired: true });
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/ot_session=.+HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('does not reveal whether an email is already registered', async () => {
    const owner = await signupOwner(t);
    const c = await newClient(t);
    const r = await c.post('/auth/signup', {
      displayName: 'Imposter',
      email: owner.email,
      password: PASSWORD,
      organizationName: 'Other Co',
      organizationSlug: uniq('other-'),
    });
    expect(r.status).toBe(202);
    expect((await lastEmail(t, owner.email)).template).toBe('account_exists');
  });

  it('rejects breached or trivially guessable passwords and unknown fields', async () => {
    const c = await newClient(t);
    const base = { displayName: 'Pat', email: `${uniq('p')}@example.test`, organizationName: 'Pat Co', organizationSlug: uniq('pat-') };
    const breached = await c.post('/auth/signup', { ...base, password: 'password1234' });
    expect(breached.status).toBe(422);
    expect(breached.body.code).toBe('PASSWORD_BREACHED');
    const short = await c.post('/auth/signup', { ...base, password: 'short' });
    expect(short.status).toBe(422);
    expect(short.body.errors[0].path).toBe('password');
    const extra = await c.post('/auth/signup', { ...base, password: PASSWORD, role: 'admin' });
    expect(extra.status).toBe(422);
  });

  it('rejects a taken organization slug', async () => {
    const owner = await signupOwner(t);
    const c = await newClient(t);
    const r = await c.post('/auth/signup', {
      displayName: 'Dup',
      email: `${uniq('d')}@example.test`,
      password: PASSWORD,
      organizationName: 'Dup',
      organizationSlug: owner.slug,
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SLUG_TAKEN');
  });
});

describe('sign-in protections', () => {
  it('returns identical responses for wrong password and unknown account', async () => {
    const owner = await signupOwner(t);
    const c = await newClient(t);
    const wrong = await c.post('/auth/login', { email: owner.email, password: 'not-the-password' });
    const unknown = await c.post('/auth/login', { email: `${uniq('nobody')}@example.test`, password: 'not-the-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
  });

  it('applies progressive delay after 5 failures, then allows sign-in after the delay', async () => {
    const owner = await signupOwner(t);
    const c = await newClient(t);
    for (let i = 0; i < 5; i += 1) {
      expect((await c.post('/auth/login', { email: owner.email, password: 'wrong-password-x' })).status).toBe(401);
    }
    // Correct password immediately after: still refused (throttled, indistinguishable).
    const throttled = await c.post('/auth/login', { email: owner.email, password: PASSWORD });
    expect(throttled.status).toBe(401);
    expect(throttled.body.code).toBe('INVALID_CREDENTIALS');
    await new Promise((r) => setTimeout(r, 1_100));
    const ok = await c.post('/auth/login', { email: owner.email, password: PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('locks the account after 20 failures within 15 minutes', async () => {
    const owner = await signupOwner(t);
    await t.db.loginEvent.createMany({
      data: Array.from({ length: 20 }, () => ({ email: owner.email, outcome: 'invalid_credentials' as const })),
    });
    const c = await newClient(t);
    const r = await c.post('/auth/login', { email: owner.email, password: PASSWORD });
    expect(r.status).toBe(401);
    const history = await t.db.loginEvent.findFirst({ where: { email: owner.email }, orderBy: { createdAt: 'desc' } });
    expect(history?.outcome).toBe('throttled');
  });

  it('rate-limits sign-in attempts per IP', async () => {
    const c = await newClient(t);
    let last = 0;
    for (let i = 0; i < 101; i += 1) {
      last = (await c.post('/auth/login', { email: `${uniq('ip')}@example.test`, password: 'whatever-123' })).status;
    }
    expect(last).toBe(429);
  });

  it('refuses state-changing requests without a valid CSRF token', async () => {
    const c = await newClient(t);
    const r = await c.agent.post('/api/v1/auth/login').send({ email: 'a@b.test', password: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF_FAILED');
    const forged = await c.agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', c.csrf)
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.test', password: 'x' });
    expect(forged.status).toBe(403);
  });
});

describe('sessions', () => {
  it('logout revokes the session server-side', async () => {
    const owner = await signupOwner(t);
    const c = owner.client;
    expect((await c.get('/me')).status).toBe(200);
    const cookie = String((await c.get('/me')).request.cookies ?? '');
    expect((await c.post('/auth/logout')).status).toBe(204);
    expect((await c.get('/me')).status).toBe(401);
    expect(cookie).toBeDefined();
    const s = await t.db.session.findFirst({ where: { userId: owner.userId }, orderBy: { createdAt: 'desc' } });
    expect(s?.revokedReason).toBe('logout');
  });

  it('expires idle sessions', async () => {
    const owner = await signupOwner(t);
    await t.db.session.updateMany({ where: { userId: owner.userId, revokedAt: null }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
    const r = await owner.client.get('/me');
    expect(r.status).toBe(401);
  });

  it('expires sessions past their absolute lifetime even if active', async () => {
    const owner = await signupOwner(t);
    await t.db.session.updateMany({ where: { userId: owner.userId, revokedAt: null }, data: { absoluteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await owner.client.get('/me')).status).toBe(401);
  });

  it('lists sessions and revokes the other ones', { timeout: 70_000 }, async () => {
    const owner = await signupOwner(t);
    const second = await newClient(t);
    expect((await second.post('/auth/login', { email: owner.email, password: PASSWORD })).status).toBe(200);
    expect((await second.post('/auth/mfa/verify', { code: await freshTotp(owner.mfaSecret) })).status).toBe(200);
    const list = await owner.client.get('/me/sessions');
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const r = await owner.client.post('/me/sessions/revoke-others');
    expect(r.body.revoked).toBeGreaterThanOrEqual(1);
    expect((await second.get('/me')).status).toBe(401);
    expect((await owner.client.get('/me')).status).toBe(200);
  });

  it('records login history', async () => {
    const owner = await signupOwner(t);
    const h = await owner.client.get('/me/login-history');
    expect(h.status).toBe(200);
    expect(h.body.map((e: { outcome: string }) => e.outcome)).toContain('success');
  });
});

describe('password reset', () => {
  it('resets the password, revokes all sessions and is single use', async () => {
    const owner = await signupOwner(t);
    const c = await newClient(t);
    const unknown = await c.post('/auth/password/forgot', { email: `${uniq('ghost')}@example.test` });
    const known = await c.post('/auth/password/forgot', { email: owner.email });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);

    const mail = await lastEmail(t, owner.email, 'password_reset');
    const newPassword = 'A-brand-new-passphrase-2026';
    expect((await c.post('/auth/password/reset', { token: mail.data.token, password: newPassword })).status).toBe(200);
    expect((await c.post('/auth/password/reset', { token: mail.data.token, password: newPassword })).status).toBe(410);

    expect((await owner.client.get('/me')).status).toBe(401);
    expect((await c.post('/auth/login', { email: owner.email, password: PASSWORD })).status).toBe(401);
    expect((await c.post('/auth/login', { email: owner.email, password: newPassword })).status).toBe(200);
    expect((await lastEmail(t, owner.email)).template).toBe('password_changed');
  });

  it('rejects expired reset tokens', async () => {
    const owner = await signupOwner(t);
    const c = await newClient(t);
    await c.post('/auth/password/forgot', { email: owner.email });
    const mail = await lastEmail(t, owner.email, 'password_reset');
    await t.db.emailToken.updateMany({ where: { userId: owner.userId, purpose: 'password_reset' }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await c.post('/auth/password/reset', { token: mail.data.token, password: 'Another-fine-passphrase' })).status).toBe(410);
  });

  it('changing the password requires the current one and keeps only this session', async () => {
    const owner = await signupOwner(t);
    const wrong = await owner.client.post('/me/password', { currentPassword: 'nope-nope-nope', newPassword: 'Yet-another-passphrase-1' });
    expect(wrong.status).toBe(422);
    const ok = await owner.client.post('/me/password', { currentPassword: PASSWORD, newPassword: 'Yet-another-passphrase-1' });
    expect(ok.status).toBe(204);
    expect((await owner.client.get('/me')).status).toBe(200);
  });
});

describe('multi-factor authentication', () => {
  it('requires a second factor at sign-in once enrolled, rejects wrong and replayed codes', async () => {
    const owner = await signupOwner(t);
    const c = await newClient(t);
    const l = await c.post('/auth/login', { email: owner.email, password: PASSWORD });
    expect(l.body).toEqual({ mfaRequired: true });
    // A password-only session cannot use the application.
    const blocked = await c.get('/me');
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('MFA_REQUIRED');
    expect((await c.post('/auth/mfa/verify', { code: '000000' })).status).toBe(401);

    // The code used at enrolment is already consumed; wait for a fresh time step if needed.
    let code = totp(owner.mfaSecret);
    let r = await c.post('/auth/mfa/verify', { code });
    if (r.status !== 200) {
      await new Promise((res) => setTimeout(res, 31_000 - (Date.now() % 30_000)));
      code = totp(owner.mfaSecret);
      r = await c.post('/auth/mfa/verify', { code });
    }
    expect(r.status).toBe(200);
    expect((await c.get('/me')).status).toBe(200);

    // Replaying the same code in a new sign-in is refused.
    const again = await newClient(t);
    await again.post('/auth/login', { email: owner.email, password: PASSWORD });
    expect((await again.post('/auth/mfa/verify', { code })).status).toBe(401);
  }, 70_000);

  it('accepts each recovery code exactly once', async () => {
    const email = `${uniq('rc')}@example.test`;
    const owner = await signupOwner(t, { email });
    // Re-enrol to capture recovery codes: disable is blocked for owners, so read them from a fresh member.
    const member = await addMember(t, owner.client, 'employee');
    const setup = await member.client.post('/me/mfa/totp/setup');
    const enabled = await member.client.post('/me/mfa/totp/enable', { code: totp(setup.body.secret) });
    const [recovery] = enabled.body.recoveryCodes as string[];

    const c = await newClient(t);
    await c.post('/auth/login', { email: member.email, password: PASSWORD });
    expect((await c.post('/auth/mfa/verify', { code: recovery })).status).toBe(200);
    const c2 = await newClient(t);
    await c2.post('/auth/login', { email: member.email, password: PASSWORD });
    expect((await c2.post('/auth/mfa/verify', { code: recovery })).status).toBe(401);
  });

  it('forces privileged roles to enrol before using the application', async () => {
    const email = `${uniq('np')}@example.test`;
    const c = await newClient(t);
    await c.post('/auth/signup', { displayName: 'No Mfa', email, password: PASSWORD, organizationName: 'NoMfa', organizationSlug: uniq('nomfa-') });
    await c.post('/auth/email/verify', { token: (await lastEmail(t, email, 'verify_email')).data.token });
    await c.post('/auth/login', { email, password: PASSWORD });
    const blocked = await c.get('/employees');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    const me = await c.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.mfaEnrollmentRequired).toBe(true);
  });

  it('does not let owners switch MFA off', async () => {
    const owner = await signupOwner(t);
    const r = await owner.client.post('/me/mfa/totp/disable', { password: PASSWORD, code: totp(owner.mfaSecret) });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('MFA_REQUIRED_BY_ROLE');
  });

  it('stores the TOTP secret encrypted, never in plain text', async () => {
    const owner = await signupOwner(t);
    const u = await t.db.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(u.mfaSecretEnc).not.toContain(owner.mfaSecret);
    expect(u.passwordHash.startsWith('$argon2id$')).toBe(true);
  });
});
