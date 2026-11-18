import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? parseISO(`${iso}T00:00:00`) : parseISO(iso);
  return format(d, 'd MMM yyyy');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(parseISO(iso), 'd MMM yyyy, HH:mm');
}

export function timeAgo(iso: string): string {
  return `${formatDistanceToNowStrict(parseISO(iso))} ago`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<string, string> = {
  pre_joining: 'Pre-joining',
  active: 'Active',
  notice_period: 'Notice period',
  exited: 'Exited',
  cancelled: 'Cancelled',
  deactivated: 'Deactivated',
  archived: 'Archived',
  pending: 'Pending',
  accepted: 'Accepted',
  revoked: 'Revoked',
  expired: 'Expired',
};

export function statusVariant(status: string): 'success' | 'warning' | 'secondary' | 'destructive' | 'default' {
  switch (status) {
    case 'active':
    case 'accepted':
      return 'success';
    case 'notice_period':
    case 'pre_joining':
    case 'pending':
      return 'warning';
    case 'exited':
    case 'cancelled':
    case 'deactivated':
    case 'revoked':
    case 'expired':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  intern: 'Intern',
};

export const SCOPE_LABEL: Record<string, string> = {
  own: 'Own',
  team: 'Team',
  department: 'Department',
  organization: 'Organization',
};

export const LOGIN_OUTCOME_LABEL: Record<string, string> = {
  success: 'Signed in',
  invalid_credentials: 'Wrong password',
  throttled: 'Blocked (too many attempts)',
  unverified: 'Email not verified',
  disabled: 'Account disabled',
  mfa_required: 'Password accepted, code requested',
  mfa_success: 'Code accepted',
  mfa_failure: 'Wrong code',
  no_active_membership: 'Signed in (no organization)',
};

/** Rough, readable device description from a user agent string. */
export function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
