import type { Grants } from '@omnitrack/permissions';
import type { Request } from 'express';

/** The authenticated caller, resolved from the session cookie on every request. */
export interface Principal {
  sessionId: string;
  sessionStatus: 'active' | 'mfa_pending';
  userId: string;
  email: string;
  displayName: string;
  platformRole: 'none' | 'super_admin';
  mfaEnabled: boolean;
  /** Null when the user has no active membership (e.g. platform admin, or all memberships ended). */
  organizationId: string | null;
  membershipId: string | null;
  employeeId: string | null;
  roleKeys: string[];
  grants: Grants;
  /** A role held requires MFA (owner/admin) or the user is a platform admin. */
  requiresMfa: boolean;
}

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  principal: Principal | null;
}

/** A context guaranteed to have an organization (tenant-scoped routes). */
export interface TenantRequestContext extends RequestContext {
  principal: Principal & { organizationId: string; membershipId: string; employeeId: string };
}

export type AppRequest = Request & { id?: string; principal?: Principal | null };

export function contextFrom(req: AppRequest): RequestContext {
  return {
    requestId: String(req.id ?? ''),
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 400) || null,
    principal: req.principal ?? null,
  };
}
