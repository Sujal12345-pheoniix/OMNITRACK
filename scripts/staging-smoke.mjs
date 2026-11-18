#!/usr/bin/env node
// End-to-end smoke test against a running staging stack (compose.staging.yml):
// web → API → database → outbox → worker → SMTP, using only public interfaces.
//   sign up through the web origin → verification email arrives in Mailpit → verify →
//   sign in → MFA enrolment required → enrol → create department and employee →
//   read them back → audit trail contains the actions → candidate portal shows the org.
import { createHmac } from 'node:crypto';

const WEB = process.env.STAGING_WEB ?? 'http://localhost:3300';
const PORTAL = process.env.STAGING_PORTAL ?? 'http://localhost:3400';
const MAIL = process.env.STAGING_MAIL ?? 'http://localhost:18026';

const jar = new Map();
let csrf = '';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) {
    console.error('Smoke test failed.');
    process.exit(1);
  }
}

async function call(method, path, body) {
  const headers = { 'content-type': 'application/json', origin: WEB };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (method !== 'GET') headers['x-csrf-token'] = csrf;
  const res = await fetch(`${WEB}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const [k, ...v] = pair.split('=');
    if (v.join('=') === '') jar.delete(k);
    else jar.set(k, v.join('='));
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret.
function totp(secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function waitForMail(to, subjectIncludes) {
  for (let i = 0; i < 40; i += 1) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const data = await r.json();
    const msg = data.messages?.find((m) => m.Subject.includes(subjectIncludes));
    if (msg) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${msg.ID}`)).json();
      return full;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}

const stamp = Date.now().toString(36);
const email = `smoke-${stamp}@example.test`;
const password = `Smoke-${stamp}-Passphrase!`;
const slug = `smoke-${stamp}`;

const csrfRes = await call('GET', '/auth/csrf');
csrf = csrfRes.body?.csrfToken ?? '';
check('Web origin proxies the API (CSRF token issued)', csrfRes.status === 200 && csrf.length > 20);
check('Session cookie flags are production-grade', String(csrfRes.headers.get('set-cookie')).includes('Secure'));

const ready = await call('GET', '/health/ready');
check('API readiness: database and Redis reachable', ready.status === 200 && ready.body?.checks?.database && ready.body?.checks?.redis);

const signup = await call('POST', '/auth/signup', { displayName: 'Smoke Tester', email, password, organizationName: `Smoke ${stamp}`, organizationSlug: slug });
check('Sign-up accepted', signup.status === 202, `status ${signup.status}`);

const mail = await waitForMail(email, 'Verify');
check('Worker delivered the verification email via SMTP', !!mail);
const token = /token=([A-Za-z0-9_-]{20,})/.exec(mail.Text)?.[1];
check('Verification link present in email', !!token);

const verify = await call('POST', '/auth/email/verify', { token });
check('Email verified', verify.status === 200);

const login = await call('POST', '/auth/login', { email, password });
check('Sign-in succeeds', login.status === 200 && login.body?.mfaEnrollmentRequired === true, JSON.stringify(login.body));

const blocked = await call('GET', '/employees');
check('Owner is blocked until MFA enrolment', blocked.status === 403 && blocked.body?.code === 'MFA_ENROLLMENT_REQUIRED');

const setup = await call('POST', '/me/mfa/totp/setup');
const enable = await call('POST', '/me/mfa/totp/enable', { code: totp(setup.body.secret) });
check('MFA enrolled, recovery codes issued', enable.status === 201 && enable.body.recoveryCodes?.length === 10);

const dept = await call('POST', '/departments', { name: 'Smoke Operations', code: 'SMOKE-OPS' });
check('Department created', dept.status === 201);
const emp = await call('POST', '/employees', { firstName: 'Smoke', lastName: 'Employee', departmentId: dept.body.id, jobTitle: 'Tester' });
check('Employee created', emp.status === 201 && emp.body.employeeCode === 'EMP-00002');
const list = await call('GET', `/employees?q=Smoke&departmentId=${dept.body.id}`);
check('Employee readable back through search', list.status === 200 && list.body.total === 1);

const audit = await call('GET', '/audit-events?limit=50');
const actions = new Set(audit.body.items.map((e) => e.action));
check('Audit trail recorded the actions', ['organization.created', 'auth.login', 'user.mfa_enabled', 'department.created', 'employee.created'].every((a) => actions.has(a)));

const portal = await fetch(`${PORTAL}/careers/${slug}`);
const html = await portal.text();
check('Candidate portal serves the organization careers page', portal.status === 200 && html.includes(`Smoke ${stamp}`));

const logout = await call('POST', '/auth/logout');
const after = await call('GET', '/me');
check('Sign-out revokes the session', logout.status === 204 && after.status === 401);

console.log(`\nAll ${results.length} staging smoke checks passed.`);
