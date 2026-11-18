import { Inject, Injectable } from '@nestjs/common';
import type { LoginHistoryEntry, MeResponse, MfaSetupResponse, SessionSummary } from '@omnitrack/contracts';
import { ENV, type Env } from '../config/env';
import type { Principal, RequestContext } from '../common/context';
import { AppError, Errors } from '../common/errors';
import { AuditService } from '../infra/audit.service';
import { OutboxService } from '../infra/outbox.service';
import { PrismaService } from '../infra/prisma.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Injectable()
export class MeService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async me(p: Principal): Promise<MeResponse> {
    const memberships = await this.prisma.forUser(p.userId, (tx) =>
      tx.membership.findMany({ where: { userId: p.userId, status: 'active' }, select: { organizationId: true } }),
    );
    const orgs = await this.prisma.client.organization.findMany({
      where: { id: { in: memberships.map((m) => m.organizationId) }, status: 'active' },
      orderBy: { name: 'asc' },
    });
    const current = orgs.find((o) => o.id === p.organizationId) ?? null;

    let roles: { id: string; key: string; name: string }[] = [];
    if (p.organizationId && p.membershipId) {
      roles = await this.prisma.forOrganization(p.organizationId, p.userId, async (tx) => {
        const rows = await tx.membershipRole.findMany({
          where: { membershipId: p.membershipId! },
          include: { role: { select: { id: true, key: true, name: true } } },
        });
        return rows.map((r) => r.role);
      });
    }

    return {
      user: {
        id: p.userId,
        email: p.email,
        displayName: p.displayName,
        mfaEnabled: p.mfaEnabled,
        platformRole: p.platformRole,
      },
      organization: current
        ? { id: current.id, name: current.name, slug: current.slug, timezone: current.timezone, currency: current.currency }
        : null,
      membership: p.membershipId && p.employeeId ? { id: p.membershipId, employeeId: p.employeeId, roles } : null,
      permissions: p.grants as MeResponse['permissions'],
      organizations: orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, current: o.id === p.organizationId })),
      mfaEnrollmentRequired: this.env.MFA_ENFORCE_PRIVILEGED && p.requiresMfa && !p.mfaEnabled,
    };
  }

  async sessionsOf(p: Principal): Promise<SessionSummary[]> {
    const rows = await this.prisma.client.session.findMany({
      where: { userId: p.userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() }, idleExpiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
    });
    return rows.map((s) => ({
      id: s.id,
      current: s.id === p.sessionId,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    }));
  }

  async revokeSession(ctx: RequestContext, sessionId: string): Promise<void> {
    const p = ctx.principal!;
    const r = await this.prisma.client.session.updateMany({
      where: { id: sessionId, userId: p.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    });
    if (r.count === 0) throw Errors.notFound('Session');
    await this.securityAudit(ctx, 'auth.session_revoked', 'session', sessionId);
  }

  async revokeOtherSessions(ctx: RequestContext): Promise<number> {
    const p = ctx.principal!;
    const n = await this.sessions.revokeAllForUser(p.userId, 'revoked_by_user', p.sessionId);
    await this.securityAudit(ctx, 'auth.other_sessions_revoked', 'user', p.userId, { count: n });
    return n;
  }

  async loginHistory(p: Principal): Promise<LoginHistoryEntry[]> {
    const rows = await this.prisma.client.loginEvent.findMany({
      where: { userId: p.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({ id: r.id, outcome: r.outcome, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt.toISOString() }));
  }

  async changePassword(ctx: RequestContext, currentPassword: string, newPassword: string): Promise<void> {
    const p = ctx.principal!;
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppError(422, 'CURRENT_PASSWORD_INCORRECT', 'Your current password is incorrect.', {
        errors: [{ path: 'currentPassword', message: 'Incorrect password' }],
      });
    }
    await this.passwords.assertNotBreached(newPassword, [user.email.split('@')[0] ?? '', user.displayName]);
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() }, select: { id: true } });
      await this.sessions.revokeAllForUser(user.id, 'password_changed', p.sessionId, tx);
      await this.outbox.email(tx, null, { to: user.email, template: 'password_changed', data: {} });
    });
    await this.securityAudit(ctx, 'user.password_changed', 'user', user.id);
  }

  async startMfaSetup(p: Principal): Promise<MfaSetupResponse> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (user.mfaEnabledAt) throw Errors.conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on.');
    const secret = this.mfa.newSecret();
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: this.mfa.encryptSecret(secret), mfaLastUsedStep: null },
      select: { id: true },
    });
    return { secret, otpauthUrl: this.mfa.otpauthUrl(user.email, secret) };
  }

  async enableMfa(ctx: RequestContext, code: string): Promise<{ recoveryCodes: string[] }> {
    const p = ctx.principal!;
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (user.mfaEnabledAt) throw Errors.conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already on.');
    if (!user.mfaSecretEnc) throw Errors.rule('MFA_SETUP_NOT_STARTED', 'Start the setup first.');
    const step = this.mfa.verify(this.mfa.decryptSecret(user.mfaSecretEnc), code, null);
    if (step === null) throw new AppError(422, 'MFA_INVALID', 'That code is not valid. Check the time on your device and try again.');
    const codes = this.mfa.recoveryCodes();
    await this.prisma.transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date(), mfaLastUsedStep: step }, select: { id: true } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({ data: codes.hashes.map((codeHash) => ({ userId: user.id, codeHash })) });
      await this.outbox.email(tx, null, { to: user.email, template: 'mfa_changed', data: { change: 'enabled' } });
    });
    await this.securityAudit(ctx, 'user.mfa_enabled', 'user', user.id);
    return { recoveryCodes: codes.plain };
  }

  async disableMfa(ctx: RequestContext, password: string, code: string): Promise<void> {
    const p = ctx.principal!;
    if (this.env.MFA_ENFORCE_PRIVILEGED && p.requiresMfa) {
      throw Errors.rule('MFA_REQUIRED_BY_ROLE', 'Your role requires two-factor authentication, so it cannot be turned off.');
    }
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (!user.mfaEnabledAt || !user.mfaSecretEnc) throw Errors.rule('MFA_NOT_ENABLED', 'Two-factor authentication is not on.');
    const passwordOk = await this.passwords.verify(user.passwordHash, password);
    const step = this.mfa.verify(this.mfa.decryptSecret(user.mfaSecretEnc), code, user.mfaLastUsedStep);
    if (!passwordOk || step === null) throw new AppError(422, 'REAUTH_FAILED', 'Password or code is incorrect.');
    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastUsedStep: null },
        select: { id: true },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await this.sessions.revokeAllForUser(user.id, 'mfa_disabled', p.sessionId, tx);
      await this.outbox.email(tx, null, { to: user.email, template: 'mfa_changed', data: { change: 'disabled' } });
    });
    await this.securityAudit(ctx, 'user.mfa_disabled', 'user', user.id);
  }

  private async securityAudit(ctx: RequestContext, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
    const p = ctx.principal!;
    if (!p.organizationId) return;
    await this.prisma.forOrganization(p.organizationId, p.userId, (tx) =>
      this.audit.record(tx, ctx, { organizationId: p.organizationId!, category: 'security', action, entityType, entityId, metadata }),
    );
  }
}
