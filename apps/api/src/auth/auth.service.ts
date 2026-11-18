import { Inject, Injectable } from '@nestjs/common';
import type { LoginRequest, LoginResponse, SignupRequest } from '@omnitrack/contracts';
import type { Tx } from '@omnitrack/db';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env';
import type { RequestContext } from '../common/context';
import { randomToken, sha256 } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { AuditService } from '../infra/audit.service';
import { OutboxService } from '../infra/outbox.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { ProvisioningService } from '../tenancy/provisioning.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { rolesRequireMfa } from './principal.service';
import { SessionService } from './session.service';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOCK_AFTER = 20;
const DELAY_AFTER = 5;

type LoginOutcome =
  | 'success'
  | 'invalid_credentials'
  | 'throttled'
  | 'unverified'
  | 'disabled'
  | 'mfa_required'
  | 'mfa_success'
  | 'mfa_failure'
  | 'no_active_membership';

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly provisioning: ProvisioningService,
  ) {}

  // ───────────── Sign-up and email verification ─────────────

  async signup(ctx: RequestContext, input: SignupRequest): Promise<void> {
    if (!this.env.SELF_SERVICE_SIGNUP) {
      throw new AppError(403, 'SIGNUP_DISABLED', 'Self-service sign-up is not available. Ask for an invitation.');
    }
    await this.redis.limit('signup-ip', ctx.ip ?? 'unknown', 10, 3600);
    await this.passwords.assertNotBreached(input.password, [input.email.split('@')[0] ?? '', input.displayName, input.organizationSlug]);

    const existing = await this.prisma.client.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) {
      // Same response as a new sign-up, so the endpoint cannot be used to discover accounts.
      await this.prisma.transaction((tx) =>
        this.outbox.email(tx, null, {
          to: input.email,
          template: 'account_exists',
          data: { link: `${this.env.APP_BASE_URL}/login` },
        }),
      );
      return;
    }

    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, displayName: input.displayName, passwordHash, status: 'pending_verification' },
        select: { id: true },
      });
      const result = await this.provisioning.createOrganization(tx, ctx, {
        name: input.organizationName,
        slug: input.organizationSlug,
        createdByUserId: user.id,
        owner: { userId: user.id, displayName: input.displayName, email: input.email },
      });
      await this.audit.record(tx, ctx, {
        organizationId: result.organizationId,
        category: 'security',
        action: 'user.signed_up',
        entityType: 'user',
        entityId: user.id,
        actorUserId: user.id,
      });
      await this.issueVerification(tx, user.id, input.email, result.organizationId);
    });
  }

  private async issueVerification(tx: Tx, userId: string, email: string, organizationId: string | null) {
    const token = randomToken();
    await tx.emailToken.create({
      data: { userId, purpose: 'email_verification', tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
      select: { id: true },
    });
    await this.outbox.email(tx, organizationId, {
      to: email,
      template: 'verify_email',
      data: { link: `${this.env.APP_BASE_URL}/verify-email?token=${token}`, token },
    });
  }

  async resendVerification(ctx: RequestContext, email: string): Promise<void> {
    await this.redis.limit('verify-resend-ip', ctx.ip ?? 'unknown', 10, 3600);
    await this.redis.limit('verify-resend-email', email, 3, 3600);
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user || user.status !== 'pending_verification') return;
    await this.prisma.transaction((tx) => this.issueVerification(tx, user.id, user.email, null));
  }

  async verifyEmail(ctx: RequestContext, token: string): Promise<void> {
    const record = await this.prisma.client.emailToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!record || record.purpose !== 'email_verification' || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError(410, 'TOKEN_INVALID', 'This link is invalid or has expired. Request a new one.');
    }
    await this.prisma.transaction(async (tx) => {
      const used = await tx.emailToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw new AppError(410, 'TOKEN_INVALID', 'This link has already been used.');
      if (record.user.status === 'pending_verification') {
        await tx.user.update({ where: { id: record.userId }, data: { status: 'active', emailVerifiedAt: new Date() }, select: { id: true } });
      }
    });
    await this.auditForUser(ctx, record.userId, 'user.email_verified');
  }

  // ───────────── Sign-in ─────────────

  async login(ctx: RequestContext, res: Response, input: LoginRequest): Promise<LoginResponse> {
    await this.redis.limit('login-ip', ctx.ip ?? 'unknown', 100, 15 * 60);

    if (await this.isThrottled(input.email)) {
      await this.recordLogin(ctx, input.email, null, null, 'throttled');
      // Deliberately indistinguishable from a wrong password (AC-A1).
      throw Errors.invalidCredentials();
    }

    const user = await this.prisma.client.user.findUnique({ where: { email: input.email } });
    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      await this.recordLogin(ctx, input.email, user?.id ?? null, null, 'invalid_credentials');
      throw Errors.invalidCredentials();
    }
    if (user.status === 'disabled') {
      await this.recordLogin(ctx, input.email, user.id, null, 'disabled');
      throw Errors.invalidCredentials();
    }
    if (user.status === 'pending_verification') {
      await this.recordLogin(ctx, input.email, user.id, null, 'unverified');
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address first. Check your inbox for the link.');
    }

    const membership = await this.pickMembership(user.id, null);
    if (!membership && user.platformRole !== 'super_admin') {
      // The password was right but there is nowhere to go; still allow a session so the
      // user can create an organization or accept an invitation.
      await this.recordLogin(ctx, input.email, user.id, null, 'no_active_membership');
    }

    const mfaRequired = user.mfaEnabledAt !== null;
    const session = await this.sessions.create({
      userId: user.id,
      organizationId: membership?.organizationId ?? null,
      membershipId: membership?.id ?? null,
      status: mfaRequired ? 'mfa_pending' : 'active',
      platformAdmin: user.platformRole === 'super_admin',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    this.sessions.setCookie(res, session.token, session.absoluteExpiresAt);

    if (mfaRequired) {
      await this.recordLogin(ctx, input.email, user.id, membership?.organizationId ?? null, 'mfa_required');
      return { mfaRequired: true };
    }

    await this.completeLogin(ctx, user.id, input.email, membership?.organizationId ?? null, session.id);
    const enrol = this.env.MFA_ENFORCE_PRIVILEGED && (user.platformRole === 'super_admin' || (membership?.requiresMfa ?? false));
    return { mfaRequired: false, mfaEnrollmentRequired: enrol };
  }

  async verifyMfa(ctx: RequestContext, res: Response, code: string): Promise<LoginResponse> {
    const p = ctx.principal;
    if (!p || p.sessionStatus !== 'mfa_pending') throw Errors.unauthenticated();
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: p.userId } });

    const recentFailures = await this.prisma.client.loginEvent.count({
      where: { userId: user.id, outcome: 'mfa_failure', createdAt: { gte: new Date(Date.now() - LOCK_WINDOW_MS) } },
    });
    if (recentFailures >= 5) {
      await this.sessions.revoke(p.sessionId, 'mfa_attempts_exceeded');
      this.sessions.clearCookie(res);
      throw new AppError(401, 'MFA_LOCKED', 'Too many incorrect codes. Sign in again in 15 minutes.');
    }

    let accepted = false;
    if (/^\d{6}$/.test(code) && user.mfaSecretEnc) {
      const step = this.mfa.verify(this.mfa.decryptSecret(user.mfaSecretEnc), code, user.mfaLastUsedStep);
      if (step !== null) {
        // Conditional update makes concurrent replays of the same code fail.
        const r = await this.prisma.client.user.updateMany({
          where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
          data: { mfaLastUsedStep: step },
        });
        accepted = r.count === 1;
      }
    } else {
      const used = await this.prisma.client.mfaRecoveryCode.updateMany({
        where: { userId: user.id, codeHash: sha256(code), usedAt: null },
        data: { usedAt: new Date() },
      });
      accepted = used.count === 1;
    }

    if (!accepted) {
      await this.recordLogin(ctx, user.email, user.id, p.organizationId, 'mfa_failure');
      throw new AppError(401, 'MFA_INVALID', 'That code is not valid. Try again.');
    }

    // Rotate the session on privilege change (prevents session fixation).
    await this.sessions.revoke(p.sessionId, 'mfa_completed');
    const session = await this.sessions.create({
      userId: user.id,
      organizationId: p.organizationId,
      membershipId: p.membershipId,
      status: 'active',
      platformAdmin: user.platformRole === 'super_admin',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    this.sessions.setCookie(res, session.token, session.absoluteExpiresAt);
    await this.recordLogin(ctx, user.email, user.id, p.organizationId, 'mfa_success');
    await this.completeLogin(ctx, user.id, user.email, p.organizationId, session.id);
    return { mfaRequired: false };
  }

  async logout(ctx: RequestContext, res: Response): Promise<void> {
    const p = ctx.principal;
    if (p) {
      await this.sessions.revoke(p.sessionId, 'logout');
      if (p.organizationId) {
        await this.prisma.forOrganization(p.organizationId, p.userId, (tx) =>
          this.audit.record(tx, ctx, {
            organizationId: p.organizationId!,
            category: 'security',
            action: 'auth.logout',
            entityType: 'session',
            entityId: p.sessionId,
          }),
        );
      }
    }
    this.sessions.clearCookie(res);
  }

  // ───────────── Password reset ─────────────

  async forgotPassword(ctx: RequestContext, email: string): Promise<void> {
    await this.redis.limit('forgot-ip', ctx.ip ?? 'unknown', 10, 3600);
    await this.redis.limit('forgot-email', email, 3, 3600);
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user || user.status === 'disabled') return; // same response either way
    const token = randomToken();
    await this.prisma.transaction(async (tx) => {
      await tx.emailToken.create({
        data: { userId: user.id, purpose: 'password_reset', tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
        select: { id: true },
      });
      await this.outbox.email(tx, null, {
        to: user.email,
        template: 'password_reset',
        data: { link: `${this.env.APP_BASE_URL}/reset-password?token=${token}`, token },
      });
    });
  }

  async resetPassword(ctx: RequestContext, token: string, password: string): Promise<void> {
    const record = await this.prisma.client.emailToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!record || record.purpose !== 'password_reset' || record.usedAt || record.expiresAt < new Date() || record.user.status === 'disabled') {
      throw new AppError(410, 'TOKEN_INVALID', 'This link is invalid or has expired. Request a new one.');
    }
    await this.passwords.assertNotBreached(password, [record.user.email.split('@')[0] ?? '', record.user.displayName]);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.transaction(async (tx) => {
      const used = await tx.emailToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw new AppError(410, 'TOKEN_INVALID', 'This link has already been used.');
      // Invalidate any other outstanding reset links.
      await tx.emailToken.updateMany({
        where: { userId: record.userId, purpose: 'password_reset', usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          // Completing a reset proves control of the mailbox.
          ...(record.user.status === 'pending_verification' ? { status: 'active', emailVerifiedAt: new Date() } : {}),
        },
        select: { id: true },
      });
      await this.sessions.revokeAllForUser(record.userId, 'password_reset', undefined, tx);
      await this.outbox.email(tx, null, { to: record.user.email, template: 'password_changed', data: {} });
    });
    await this.auditForUser(ctx, record.userId, 'user.password_reset');
  }

  // ───────────── Organizations ─────────────

  async switchOrganization(ctx: RequestContext, res: Response, organizationId: string): Promise<void> {
    const p = ctx.principal!;
    const membership = await this.pickMembership(p.userId, organizationId);
    if (!membership || membership.organizationId !== organizationId) throw Errors.notFound('Organization');
    await this.sessions.revoke(p.sessionId, 'organization_switched');
    const session = await this.sessions.create({
      userId: p.userId,
      organizationId,
      membershipId: membership.id,
      status: 'active',
      platformAdmin: p.platformRole === 'super_admin',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    this.sessions.setCookie(res, session.token, session.absoluteExpiresAt);
    await this.prisma.forOrganization(organizationId, p.userId, (tx) =>
      this.audit.record(tx, ctx, {
        organizationId,
        category: 'security',
        action: 'auth.organization_switched',
        entityType: 'session',
        entityId: session.id,
        metadata: { from: p.organizationId },
      }),
    );
  }

  /** An authenticated user creates an additional organization and becomes its owner. */
  async createOrganization(ctx: RequestContext, input: { name: string; slug: string }): Promise<{ id: string }> {
    if (!this.env.SELF_SERVICE_SIGNUP && ctx.principal?.platformRole !== 'super_admin') {
      throw new AppError(403, 'SIGNUP_DISABLED', 'Creating organizations is not enabled.');
    }
    const p = ctx.principal!;
    await this.redis.limit('org-create-user', p.userId, 5, 24 * 3600);
    const result = await this.prisma.transaction((tx) =>
      this.provisioning.createOrganization(tx, ctx, {
        name: input.name,
        slug: input.slug,
        createdByUserId: p.userId,
        owner: { userId: p.userId, displayName: p.displayName, email: p.email },
      }),
    );
    return { id: result.organizationId };
  }

  // ───────────── Helpers ─────────────

  /** The user's active membership in an active organization (preferred one, or most recent). */
  async pickMembership(userId: string, preferredOrganizationId: string | null) {
    const memberships = await this.prisma.forUser(userId, (tx) =>
      tx.membership.findMany({
        where: { userId, status: 'active', ...(preferredOrganizationId ? { organizationId: preferredOrganizationId } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
    );
    if (memberships.length === 0) return null;
    const orgs = await this.prisma.client.organization.findMany({
      where: { id: { in: memberships.map((m) => m.organizationId) }, status: 'active' },
      select: { id: true },
    });
    const activeOrgIds = new Set(orgs.map((o) => o.id));
    const usable = memberships.filter((m) => activeOrgIds.has(m.organizationId));
    if (usable.length === 0) return null;

    let chosen = usable[0]!;
    if (!preferredOrganizationId) {
      // Prefer the organization of the user's most recent session.
      const last = await this.prisma.client.session.findFirst({
        where: { userId, organizationId: { in: usable.map((m) => m.organizationId) } },
        orderBy: { createdAt: 'desc' },
        select: { organizationId: true },
      });
      chosen = usable.find((m) => m.organizationId === last?.organizationId) ?? chosen;
    }
    // Roles are tenant data: read them inside the chosen organization's RLS context.
    const roles = await this.prisma.forOrganization(chosen.organizationId, userId, (tx) =>
      tx.membershipRole.findMany({ where: { membershipId: chosen.id }, include: { role: { select: { key: true, isSystem: true } } } }),
    );
    return { ...chosen, requiresMfa: rolesRequireMfa(roles.map((r) => r.role)) };
  }

  private async isThrottled(email: string): Promise<boolean> {
    const recent = await this.prisma.client.loginEvent.findMany({
      where: { email, createdAt: { gte: new Date(Date.now() - LOCK_WINDOW_MS) } },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { outcome: true, createdAt: true },
    });
    let failures = 0;
    let lastFailure: Date | null = null;
    for (const e of recent) {
      if (e.outcome === 'success' || e.outcome === 'mfa_required' || e.outcome === 'mfa_success') break;
      if (e.outcome === 'invalid_credentials') {
        failures += 1;
        lastFailure ??= e.createdAt;
      }
    }
    if (failures >= LOCK_AFTER) return true;
    if (failures >= DELAY_AFTER && lastFailure) {
      const delayMs = Math.min(2 ** (failures - DELAY_AFTER), 60) * 1000;
      return Date.now() - lastFailure.getTime() < delayMs;
    }
    return false;
  }

  private async completeLogin(ctx: RequestContext, userId: string, email: string, organizationId: string | null, sessionId: string) {
    await this.prisma.client.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() }, select: { id: true } });
    await this.recordLogin(ctx, email, userId, organizationId, 'success');
    if (organizationId) {
      await this.prisma.forOrganization(organizationId, userId, (tx) =>
        this.audit.record(tx, ctx, {
          organizationId,
          category: 'security',
          action: 'auth.login',
          entityType: 'session',
          entityId: sessionId,
          actorUserId: userId,
        }),
      );
    }
  }

  private async recordLogin(ctx: RequestContext, email: string, userId: string | null, organizationId: string | null, outcome: LoginOutcome) {
    await this.prisma.client.loginEvent.create({
      data: { email, userId, organizationId, outcome, ip: ctx.ip, userAgent: ctx.userAgent },
      select: { id: true },
    });
  }

  /** Writes a security audit event into every organization the user belongs to. */
  private async auditForUser(ctx: RequestContext, userId: string, action: string) {
    const memberships = await this.prisma.forUser(userId, (tx) =>
      tx.membership.findMany({ where: { userId }, select: { organizationId: true } }),
    );
    for (const m of memberships) {
      await this.prisma.forOrganization(m.organizationId, userId, (tx) =>
        this.audit.record(tx, ctx, {
          organizationId: m.organizationId,
          category: 'security',
          action,
          entityType: 'user',
          entityId: userId,
          actorUserId: userId,
        }),
      );
    }
  }
}
