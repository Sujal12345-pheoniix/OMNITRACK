import { describe, expect, it } from 'vitest';
import {
  createEmployeeRequest,
  EMPLOYEE_TRANSITIONS,
  isoDate,
  loginRequest,
  signupRequest,
  slug,
  updateOrganizationRequest,
} from './index';

describe('signupRequest', () => {
  const valid = {
    displayName: 'Asha Rao',
    email: '  Asha@Example.COM ',
    password: 'correct horse battery',
    organizationName: 'Acme Ltd',
    organizationSlug: 'acme',
  };

  it('normalizes email to lower case', () => {
    expect(signupRequest.parse(valid).email).toBe('asha@example.com');
  });

  it('rejects short passwords', () => {
    expect(signupRequest.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('rejects unknown fields (strict)', () => {
    expect(signupRequest.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
  });
});

describe('slug', () => {
  it.each(['ab', 'Has Space', '-lead', 'trail-', 'dou--ble', 'a'.repeat(41)])('rejects %s', (s) => {
    expect(slug.safeParse(s).success).toBe(false);
  });
  it.each(['acme', 'acme-2', 'a1b2c3'])('accepts %s', (s) => {
    expect(slug.safeParse(s).success).toBe(true);
  });
});

describe('isoDate', () => {
  it('rejects impossible dates and other formats', () => {
    expect(isoDate.safeParse('2026-13-01').success).toBe(false);
    expect(isoDate.safeParse('01/02/2026').success).toBe(false);
    expect(isoDate.safeParse('2026-02-01').success).toBe(true);
  });
});

describe('loginRequest', () => {
  it('rejects oversized passwords (DoS guard for hashing)', () => {
    expect(loginRequest.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success).toBe(false);
  });
});

describe('createEmployeeRequest', () => {
  it('applies defaults', () => {
    const r = createEmployeeRequest.parse({ firstName: 'Ravi' });
    expect(r).toMatchObject({ lastName: '', employmentType: 'full_time', status: 'active', teamIds: [] });
  });
  it('rejects bad codes', () => {
    expect(createEmployeeRequest.safeParse({ firstName: 'R', employeeCode: 'has space' }).success).toBe(false);
  });
});

describe('updateOrganizationRequest', () => {
  it('rejects unknown time zones', () => {
    expect(updateOrganizationRequest.safeParse({ timezone: 'Mars/Base', version: 1 }).success).toBe(false);
    expect(updateOrganizationRequest.safeParse({ timezone: 'Asia/Kolkata', version: 1 }).success).toBe(true);
  });
});

describe('EMPLOYEE_TRANSITIONS', () => {
  it('terminal states have no exits', () => {
    expect(EMPLOYEE_TRANSITIONS.exited).toEqual([]);
    expect(EMPLOYEE_TRANSITIONS.cancelled).toEqual([]);
  });
});
