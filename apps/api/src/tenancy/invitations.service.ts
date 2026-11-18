import { Inject, Injectable } from '@nestjs/common';
import type { InvitationDto, InvitationPreviewDto } from '@omnitrack/contracts';
import { BUILT_IN_ROLES, canGrant, isBuiltInRoleKey, OWNER_ONLY_ROLE_KEYS, type BuiltInRoleKey } from '@omnitrack/permissions';
import type { Tx } from '@omnitrack/db';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env';
import type { RequestContext, TenantRequestContext } from '../common/context';
import { nextEmployeeCode, splitName } from '../common/codes';
import { randomToken, sha256 } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { AuditService } from '../infra/audit.service';
import { OutboxService } from '../infra/outbox.service';
import { PrismaService } from '../infra/prisma.service';
import { PasswordService } from '../auth/password.service';
import { grantsForRoles } from '../auth/principal.service';
import { SessionService } from '../auth/session.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IssueInvitation {
  organizationId: string;
  organizationName: string;
  email: string;
  roleId: string;
  roleName: string;
  employeeId?: string | null;
  invitedByUserId: string;
  inviterName: string;
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async list(ctx: TenantRequestContext): Promise<InvitationDto[]> {
    return this.prisma.tenant(ctx, async (tx) => {
      const rows = await tx.invitation.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
      const roles = await tx.role.findMany({ where: { id: { in: rows.map((r) => r.roleId) } }, select: { id: true, name: true } });
      const roleName = new Map(roles.map((r) => [r.id, r.name]));
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: { id: r.roleId, name: roleName.get(r.roleId) ?? 'Unknown role' },
        status: r.status === 'pending' && r.expiresAt < new Date() ? 'expired' : r.status,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async create(ctx: TenantRequestContext, input: { email: string; roleId: string; employeeId?: string }): Promise<{ id: string }> {
    const p = ctx.principal;
    const org = await this.prisma.client.organization.findUniqueOrThrow({ where: { id: p.organizationId } });
    return this.prisma.tenant(ctx, async (tx) => {
      const role = await tx.role.findUnique({ where: { id: input.roleId }, include: { permissions: true } });
      if (!role) throw Errors.rule('ROLE_NOT_FOUND', 'Choose a valid role.', { errors: [{ path: 'roleId', message: 'Unknown role' }] });
      this.assertCanAssign(p.grants, p.roleKeys, role);

      const existingUser = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (existingUser) {
        const member = await tx.membership.findFirst({ where: { userId: existingUser.id, status: 'active' }, select: { id: true } });
        if (member) throw Errors.conflict('ALREADY_MEMBER', 'This person is already a member of the organization.');
      }
      if (input.employeeId) {
        const emp = await tx.employee.findUnique({ where: { id: input.employeeId }, include: { membership: true } });
        if (!emp) throw Errors.rule('EMPLOYEE_NOT_FOUND', 'Choose a valid employee.', { errors: [{ path: 'employeeId', message: 'Unknown employee' }] });
        if (emp.membership) throw Errors.conflict('EMPLOYEE_HAS_LOGIN', 'This employee already has a login.');
        if (emp.status === 'exited' || emp.status === 'cancelled') throw Errors.rule('EMPLOYEE_INACTIVE', 'This employee is no longer active.');
      }
      // Re-inviting replaces any pending invitation for the same address.
      await tx.invitation.updateMany({
        where: { email: input.email, status: 'pending' },
        data: { status: 'revoked', revokedAt: new Date() },
      });
      return this.issue(tx, ctx, {
        organizationId: p.organizationId,
        organizationName: org.name,
        email: input.email,
        roleId: role.id,
        roleName: role.name,
        employeeId: input.employeeId ?? null,
        invitedByUserId: p.userId,
        inviterName: p.displayName,
      });
    });
  }

  /** Creates the invitation and its email inside the caller's tenant transaction. */
  async issue(tx: Tx, ctx: RequestContext, input: IssueInvitation): Promise<{ id: string }> {
    const token = randomToken();
    const inv = await tx.invitation.create({
      data: {
        organizationId: input.organizationId,
        email: input.email,
        tokenHash: sha256(token),
        roleId: input.roleId,
        employeeId: input.employeeId ?? null,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedByUserId: input.invitedByUserId,
      },
      select: { id: true },
    });
    await this.outbox.email(tx, input.organizationId, {
      to: input.email,
      template: 'invitation',
      data: {
        link: `${this.env.APP_BASE_URL}/accept-invitation?token=${token}`,
        token,
        organizationName: input.organizationName,
        inviterName: input.inviterName,
        roleName: input.roleName,
      },
    });
    await this.audit.record(tx, ctx, {
      organizationId: input.organizationId,
      category: 'admin',
      action: 'invitation.created',
      entityType: 'invitation',
      entityId: inv.id,
      metadata: { email: input.email, roleId: input.roleId, employeeId: input.employeeId ?? null },
    });
    return inv;
  }

  async revoke(ctx: TenantRequestContext, id: string): Promise<void> {
    await this.prisma.tenant(ctx, async (tx) => {
      const r = await tx.invitation.updateMany({ where: { id, status: 'pending' }, data: { status: 'revoked', revokedAt: new Date() } });
      if (r.count === 0) {
        if (await tx.invitation.findUnique({ where: { id }, select: { id: true } })) {
          throw Errors.conflict('INVITATION_CLOSED', 'This invitation is no longer pending.');
        }
        throw Errors.notFound('Invitation');
      }
      await this.audit.record(tx, ctx, { organizationId: ctx.principal.organizationId, category: 'admin', action: 'invitation.revoked', entityType: 'invitation', entityId: id });
    });
  }

  async preview(token: string): Promise<InvitationPreviewDto> {
    const { invitation, organization } = await this.load(token);
    const role = await this.prisma.forOrganization(organization.id, null, (tx) => tx.role.findUnique({ where: { id: invitation.roleId } }));
    const account = await this.prisma.client.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    return { organizationName: organization.name, email: invitation.email, roleName: role?.name ?? '', accountExists: !!account };
  }

  async accept(
    ctx: RequestContext,
    res: Response,
    input: { token: string; displayName?: string; password?: string },
  ): Promise<{ organizationId: string }> {
    const { invitation, organization } = await this.load(input.token);
    const existing = await this.prisma.client.user.findUnique({ where: { email: invitation.email } });

    if (existing && ctx.principal?.userId !== existing.id) {
      throw new AppError(401, 'LOGIN_REQUIRED', `Sign in as ${invitation.email} to accept this invitation.`, { email: invitation.email });
    }
    if (existing && existing.status === 'disabled') throw Errors.forbidden('This account is disabled.');
    if (!existing) {
      if (!input.displayName || !input.password) {
        throw new AppError(422, 'VALIDATION_FAILED', 'Enter your name and choose a password.', {
          errors: [
            ...(input.displayName ? [] : [{ path: 'displayName', message: 'Required' }]),
            ...(input.password ? [] : [{ path: 'password', message: 'Required' }]),
          ],
        });
      }
      await this.passwords.assertNotBreached(input.password, [invitation.email.split('@')[0] ?? '', input.displayName]);
    }
    const passwordHash = existing ? null : await this.passwords.hash(input.password!);

    const result = await this.prisma.transaction(async (tx) => {
      let userId: string;
      let displayName: string;
      if (existing) {
        userId = existing.id;
        displayName = existing.displayName;
        if (existing.status === 'pending_verification') {
          // The invitation link proves control of the mailbox.
          await tx.user.update({ where: { id: userId }, data: { status: 'active', emailVerifiedAt: new Date() }, select: { id: true } });
        }
      } else {
        const created = await tx.user.create({
          data: {
            email: invitation.email,
            displayName: input.displayName!,
            passwordHash: passwordHash!,
            status: 'active',
            emailVerifiedAt: new Date(),
          },
          select: { id: true, displayName: true },
        });
        userId = created.id;
        displayName = created.displayName;
      }
      await this.prisma.setTenant(tx, organization.id, userId);

      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'pending', expiresAt: { gt: new Date() } },
        data: { status: 'accepted', acceptedAt: new Date(), acceptedByUserId: userId },
      });
      if (claimed.count !== 1) throw new AppError(410, 'INVITATION_INVALID', 'This invitation is no longer valid.');

      const prior = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: organization.id, userId } } });
      if (prior?.status === 'active') throw Errors.conflict('ALREADY_MEMBER', 'You are already a member of this organization.');

      let membershipId: string;
      let employeeId: string;
      if (prior) {
        await tx.membership.update({
          where: { id: prior.id },
          data: { status: 'active', deactivatedAt: null, permissionsVersion: { increment: 1 } },
          select: { id: true },
        });
        membershipId = prior.id;
        employeeId = prior.employeeId;
      } else {
        employeeId = await this.resolveEmployee(tx, organization.id, userId, invitation.employeeId, invitation.email, displayName);
        const m = await tx.membership.create({ data: { organizationId: organization.id, userId, employeeId }, select: { id: true } });
        membershipId = m.id;
      }
      await tx.membershipRole.upsert({
        where: { membershipId_roleId: { membershipId, roleId: invitation.roleId } },
        create: { organizationId: organization.id, membershipId, roleId: invitation.roleId, createdBy: invitation.invitedByUserId },
        update: {},
        select: { id: true },
      });
      await this.audit.record(tx, ctx, {
        organizationId: organization.id,
        category: 'admin',
        action: 'membership.joined',
        entityType: 'membership',
        entityId: membershipId,
        actorUserId: userId,
        metadata: { invitationId: invitation.id, roleId: invitation.roleId, employeeId },
      });
      return { userId, membershipId };
    });

    // Sign the user into the organization they just joined.
    if (ctx.principal) await this.sessions.revoke(ctx.principal.sessionId, 'organization_switched');
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: result.userId } });
    const session = await this.sessions.create({
      userId: result.userId,
      organizationId: organization.id,
      membershipId: result.membershipId,
      status: user.mfaEnabledAt && !ctx.principal ? 'mfa_pending' : 'active',
      platformAdmin: user.platformRole === 'super_admin',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    this.sessions.setCookie(res, session.token, session.absoluteExpiresAt);
    return { organizationId: organization.id };
  }

  /** Links an existing employee record when possible, otherwise creates a minimal one (DOMAINS.md §0.2). */
  private async resolveEmployee(
    tx: Tx,
    organizationId: string,
    userId: string,
    invitedEmployeeId: string | null,
    email: string,
    displayName: string,
  ): Promise<string> {
    const candidate = invitedEmployeeId
      ? await tx.employee.findUnique({ where: { id: invitedEmployeeId }, include: { membership: true } })
      : await tx.employee.findFirst({ where: { workEmail: email }, include: { membership: true } });
    if (candidate && !candidate.membership && candidate.status !== 'exited' && candidate.status !== 'cancelled') {
      return candidate.id;
    }
    if (invitedEmployeeId) throw Errors.conflict('EMPLOYEE_UNAVAILABLE', 'The employee record for this invitation is no longer available.');
    const { firstName, lastName } = splitName(displayName);
    const emailFree = !(await tx.employee.findFirst({ where: { workEmail: email }, select: { id: true } }));
    const employee = await tx.employee.create({
      data: {
        organizationId,
        employeeCode: await nextEmployeeCode(tx, organizationId),
        firstName,
        lastName,
        workEmail: emailFree ? email : null,
        status: 'active',
        createdBy: userId,
      },
      select: { id: true },
    });
    await tx.employmentEvent.create({
      data: {
        organizationId,
        employeeId: employee.id,
        type: 'created',
        toValue: { status: 'active', via: 'invitation' },
        effectiveDate: new Date(new Date().toISOString().slice(0, 10)),
        actorUserId: userId,
      },
      select: { id: true },
    });
    return employee.id;
  }

  private async load(token: string) {
    const tokenHash = sha256(token);
    // RLS policy `invitation_by_token` reveals a row only to a transaction presenting its hash.
    const invitation = await this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.invitation_token_hash', ${tokenHash}, true)`;
      return tx.invitation.findUnique({ where: { tokenHash } });
    });
    const invalid = () => new AppError(410, 'INVITATION_INVALID', 'This invitation is invalid, expired or already used.');
    if (!invitation || invitation.status !== 'pending' || invitation.expiresAt < new Date()) throw invalid();
    const organization = await this.prisma.client.organization.findUnique({ where: { id: invitation.organizationId } });
    if (!organization || organization.status !== 'active') throw invalid();
    return { invitation, organization };
  }

  /** Anti-escalation and owner-only rules for handing out a role. */
  assertCanAssign(
    actorGrants: Parameters<typeof canGrant>[0],
    actorRoleKeys: string[],
    role: { key: string; isSystem: boolean; permissions: { permission: string; scope: string }[] },
  ): void {
    if (role.isSystem && isBuiltInRoleKey(role.key) && OWNER_ONLY_ROLE_KEYS.includes(role.key as BuiltInRoleKey) && !actorRoleKeys.includes('org_owner')) {
      throw new AppError(403, 'ESCALATION_DENIED', 'Only an owner can grant the owner role.');
    }
    const grants = role.isSystem && isBuiltInRoleKey(role.key) ? BUILT_IN_ROLES[role.key].grants : grantsForRoles([role]);
    const check = canGrant(actorGrants, grants);
    if (!check.ok) {
      throw new AppError(403, 'ESCALATION_DENIED', 'You cannot grant permissions you do not hold yourself.', {
        missing: check.missing.map((m) => `${m.permission}@${m.required}`),
      });
    }
  }
}
