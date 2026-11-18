import { describe, expect, it } from 'vitest';
import { escapeHtml, render } from './templates';

describe('email templates', () => {
  it('renders every template the API emits', () => {
    for (const template of ['verify_email', 'password_reset', 'password_changed', 'account_exists', 'invitation', 'mfa_changed', 'notification']) {
      const r = render({ to: 'a@b.test', template, data: { link: 'https://app.test/x?token=abc', organizationName: 'Acme', inviterName: 'Ann', roleName: 'Employee', change: 'enabled', title: 'Task assigned to you', body: 'Open OmniTrack to see it.' } });
      expect(r.subject.length).toBeGreaterThan(5);
      expect(r.html).toContain('<!doctype html>');
      expect(r.text).toContain('OmniTrack');
    }
  });

  it('escapes user-controlled values to prevent HTML injection', () => {
    const r = render({ to: 'a@b.test', template: 'invitation', data: { link: 'https://app.test/i', organizationName: '<script>alert(1)</script>', inviterName: 'Eve "x"', roleName: 'r' } });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });

  it('refuses unknown templates', () => {
    expect(() => render({ to: 'a@b.test', template: 'nope', data: {} })).toThrow(/Unknown email template/);
  });
});
