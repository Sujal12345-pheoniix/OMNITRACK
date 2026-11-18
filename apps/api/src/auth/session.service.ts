import { Inject, Injectable } from '@nestjs/common';
import type { Tx } from '@omnitrack/db';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env';
import { randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../infra/prisma.service';

export const SESSION_COOKIE = 'ot_session';
export const CSRF_COOKIE = 'ot_csrf';

/** Session lifetimes (ADR-012). */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
export const PLATFORM_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const MFA_PENDING_MS = 10 * 60 * 1000;

export interface NewSession {
  userId: string;
  organizationId: string | null;
  membershipId: string | null;
  status: 'active' | 'mfa_pending';
  platformAdmin: boolean;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Opaque server-side sessions. The cookie holds 256 random bits; the database holds only
 * their SHA-256, so a database leak does not yield usable sessions. Revocation is
 * immediate because every request is checked against this table.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  async create(input: NewSession, tx?: Tx): Promise<{ token: string; id: string; absoluteExpiresAt: Date }> {
    const db = tx ?? this.prisma.client;
    const token = randomToken();
    const now = Date.now();
    const absoluteMs =
      input.status === 'mfa_pending'
        ? MFA_PENDING_MS
        : input.platformAdmin
          ? PLATFORM_SESSION_ABSOLUTE_MS
          : SESSION_ABSOLUTE_MS;
    const absoluteExpiresAt = new Date(now + absoluteMs);
    const session = await db.session.create({
      data: {
        tokenHash: sha256(token),
        userId: input.userId,
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        status: input.status,
        ip: input.ip,
        userAgent: input.userAgent,
        idleExpiresAt: new Date(Math.min(now + SESSION_IDLE_MS, absoluteExpiresAt.getTime())),
        absoluteExpiresAt,
      },
      select: { id: true },
    });
    return { token, id: session.id, absoluteExpiresAt };
  }

  findByToken(token: string) {
    return this.prisma.client.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true, organization: true },
    });
  }

  /** Slide the idle timeout, at most once a minute per session. */
  async touch(id: string, lastSeenAt: Date, absoluteExpiresAt: Date): Promise<void> {
    const now = Date.now();
    if (now - lastSeenAt.getTime() < 60_000) return;
    await this.prisma.client.session.updateMany({
      where: { id, revokedAt: null },
      data: {
        lastSeenAt: new Date(now),
        idleExpiresAt: new Date(Math.min(now + SESSION_IDLE_MS, absoluteExpiresAt.getTime())),
      },
    });
  }

  async revoke(id: string, reason: string, tx?: Tx): Promise<void> {
    await (tx ?? this.prisma.client).session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string, tx?: Tx): Promise<number> {
    const r = await (tx ?? this.prisma.client).session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.count;
  }

  async revokeForMembership(membershipId: string, reason: string, tx?: Tx): Promise<number> {
    const r = await (tx ?? this.prisma.client).session.updateMany({
      where: { membershipId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.count;
  }

  async revokeForOrganization(organizationId: string, reason: string, tx?: Tx): Promise<number> {
    const r = await (tx ?? this.prisma.client).session.updateMany({
      where: { organizationId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.count;
  }

  setCookie(res: Response, token: string, expires: Date): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: '/' });
  }

  setCsrfCookie(res: Response, token: string): void {
    res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: this.env.COOKIE_SECURE, sameSite: 'strict', path: '/' });
  }
}
