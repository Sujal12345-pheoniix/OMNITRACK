import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@omnitrack/permissions';
import { contextFrom, type AppRequest, type RequestContext, type TenantRequestContext } from './context';
import { Errors } from './errors';

/**
 * Deny by default (SECURITY.md §2): every route must declare exactly one access level.
 * The global AccessGuard rejects routes that declare none, and an integration test
 * enumerates all routes to fail the build if one is missing.
 */
export const ACCESS_KEY = 'omnitrack:access';
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated'; requireOrganization: boolean }
  | { kind: 'permission'; permission: PermissionCode }
  | { kind: 'platform' };

/** No session required. If a valid session cookie is present it is still resolved. */
export const Public = () => SetMetadata<string, AccessRule>(ACCESS_KEY, { kind: 'public' });

/** Any signed-in user. Pass `requireOrganization: false` for routes usable without one. */
export const Authenticated = (opts: { requireOrganization?: boolean } = {}) =>
  SetMetadata<string, AccessRule>(ACCESS_KEY, {
    kind: 'authenticated',
    requireOrganization: opts.requireOrganization ?? true,
  });

/** Signed in, in an organization, and holding `permission` at any scope. Services narrow by scope. */
export const RequirePermission = (permission: PermissionCode) =>
  SetMetadata<string, AccessRule>(ACCESS_KEY, { kind: 'permission', permission });

/** Platform super admin with MFA. */
export const PlatformAdmin = () => SetMetadata<string, AccessRule>(ACCESS_KEY, { kind: 'platform' });

/** Route may be used by a session that has passed the password step but not MFA yet. */
export const ALLOW_MFA_PENDING = 'omnitrack:allowMfaPending';
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);

/** Route may be used before mandatory MFA enrolment is completed (enrolment itself, /me, logout). */
export const ALLOW_WITHOUT_MFA_ENROLLMENT = 'omnitrack:allowWithoutMfaEnrollment';
export const AllowWithoutMfaEnrollment = () => SetMetadata(ALLOW_WITHOUT_MFA_ENROLLMENT, true);

/** Injects the request context. */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext =>
  contextFrom(ctx.switchToHttp().getRequest<AppRequest>()),
);

/** Injects a context that is guaranteed to carry an organization; use on tenant routes. */
export const TenantCtx = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantRequestContext => {
  const c = contextFrom(ctx.switchToHttp().getRequest<AppRequest>());
  const p = c.principal;
  if (!p || !p.organizationId || !p.membershipId || !p.employeeId) throw Errors.unauthenticated();
  return c as TenantRequestContext;
});
