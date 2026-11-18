/**
 * Transactional email templates. Bodies never include record contents beyond what the
 * recipient needs to act (DOMAINS.md M-R3); links point back to the application.
 */
export interface EmailPayload {
  to: string;
  template: string;
  data: Record<string, string>;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#555">If the button does not work, copy this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}${button}<p style="margin-top:32px;font-size:12px;color:#777">OmniTrack — Every Action. Every Record. Every Result.</p></body></html>`;
}

function text(paragraphs: string[], action?: { label: string; url: string }): string {
  return [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : []), '', 'OmniTrack'].join('\n\n');
}

function build(subject: string, paragraphs: string[], action?: { label: string; url: string }): RenderedEmail {
  return { subject, text: text(paragraphs, action), html: layout(subject, paragraphs, action) };
}

export function render(payload: EmailPayload): RenderedEmail {
  const d = payload.data;
  switch (payload.template) {
    case 'verify_email':
      return build('Verify your email address', ['Confirm your email address to finish setting up your OmniTrack account. The link expires in 24 hours.', 'If you did not sign up, you can ignore this email.'], { label: 'Verify email', url: d.link! });
    case 'password_reset':
      return build('Reset your password', ['Someone asked to reset the password for your OmniTrack account. The link expires in 1 hour and can be used once.', 'If this was not you, ignore this email; your password stays the same.'], { label: 'Choose a new password', url: d.link! });
    case 'password_changed':
      return build('Your password was changed', ['The password for your OmniTrack account was just changed and other sessions were signed out.', 'If you did not do this, reset your password immediately and contact your administrator.']);
    case 'account_exists':
      return build('You already have an OmniTrack account', ['Someone tried to sign up with this email address, which already has an account.', 'If it was you, sign in instead. If not, you can ignore this email.'], { label: 'Sign in', url: d.link! });
    case 'invitation':
      return build(`You're invited to ${d.organizationName ?? 'an organization'} on OmniTrack`, [`${d.inviterName ?? 'An administrator'} invited you to join ${d.organizationName ?? 'their organization'} as ${d.roleName ?? 'a member'}. The invitation expires in 7 days.`], { label: 'Accept invitation', url: d.link! });
    case 'mfa_changed':
      return build('Two-factor authentication changed', [`Two-factor authentication was ${d.change === 'disabled' ? 'turned off' : 'turned on'} for your OmniTrack account.`, 'If you did not do this, reset your password immediately and contact your administrator.']);
    case 'notification':
      return build(d.title ?? 'New notification', [d.body ?? 'You have a new notification in OmniTrack.'], d.link ? { label: 'Open OmniTrack', url: d.link } : undefined);
    default:
      throw new Error(`Unknown email template: ${payload.template}`);
  }
}
