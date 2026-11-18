import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@omnitrack/permissions';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env';
import type { AppRequest } from '../common/context';
import {
  ACCESS_KEY,
  ALLOW_MFA_PENDING,
  ALLOW_WITHOUT_MFA_ENROLLMENT,
  type AccessRule,
} from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { PrincipalService } from './principal.service';
import { SESSION_COOKIE, SessionService } from './session.service';

/**
 * Global guard enforcing authentication and authorization on every route (deny by default).
 * Scope-level narrowing (own/team/department/organization) is applied by services.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly principals: PrincipalService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, targets);
    if (!rule) {
      // A route without an access declaration is a programming error; refuse it.
      throw new AppError(403, 'ROUTE_NOT_DECLARED', 'This route has no access policy.');
    }

    const req = context.switchToHttp().getRequest<AppRequest & { cookies?: Record<string, string> }>();
    const res = context.switchToHttp().getResponse<Response>();
    const token = req.cookies?.[SESSION_COOKIE];
    const resolved = await this.principals.resolve(token);
    req.principal = 'principal' in resolved ? resolved.principal : null;

    if (rule.kind === 'public') return true;

    const principal = req.principal;
    if (!principal) {
      if (token) this.sessions.clearCookie(res);
      if ('failure' in resolved && resolved.failure === 'org_inactive') {
        throw new AppError(401, 'ORGANIZATION_SUSPENDED', 'This organization is suspended.');
      }
      throw Errors.unauthenticated();
    }

    if (principal.sessionStatus === 'mfa_pending' && !this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING, targets)) {
      throw new AppError(401, 'MFA_REQUIRED', 'Enter your authentication code to continue.');
    }

    if (
      this.env.MFA_ENFORCE_PRIVILEGED &&
      principal.requiresMfa &&
      !principal.mfaEnabled &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA_ENROLLMENT, targets)
    ) {
      throw new AppError(
        403,
        'MFA_ENROLLMENT_REQUIRED',
        'Your role requires two-factor authentication. Set it up to continue.',
      );
    }

    switch (rule.kind) {
      case 'authenticated':
        if (rule.requireOrganization && !principal.organizationId) {
          throw new AppError(403, 'NO_ORGANIZATION', 'Join or create an organization first.');
        }
        return true;
      case 'permission':
        if (!principal.organizationId) throw new AppError(403, 'NO_ORGANIZATION', 'Join or create an organization first.');
        if (!hasPermission(principal.grants, rule.permission)) throw Errors.forbidden();
        return true;
      case 'platform':
        if (principal.platformRole !== 'super_admin') throw Errors.forbidden();
        if (!principal.mfaEnabled) {
          throw new AppError(403, 'MFA_ENROLLMENT_REQUIRED', 'Platform administration requires two-factor authentication.');
        }
        return true;
    }
  }
}
