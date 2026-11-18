import { z } from 'zod';
import { email, slug, text } from './common';

/** NIST SP 800-63B: length over composition; 12–128 characters (DOMAINS.md A-R2). */
export const password = z
  .string()
  .min(12, { message: 'Must be at least 12 characters' })
  .max(128, { message: 'Must be at most 128 characters' });

export const signupRequest = z
  .object({
    displayName: text(120),
    email,
    password,
    organizationName: text(120, 2),
    organizationSlug: slug,
  })
  .strict();
export type SignupRequest = z.infer<typeof signupRequest>;

export const loginRequest = z
  .object({
    email,
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginRequest = z.infer<typeof loginRequest>;

export const mfaVerifyRequest = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^(\d{6}|[a-z0-9]{5}-[a-z0-9]{5})$/, {
        message: 'Enter the 6-digit code or a recovery code',
      }),
  })
  .strict();

export const tokenRequest = z.object({ token: z.string().min(20).max(200) }).strict();

export const emailRequest = z.object({ email }).strict();

export const resetPasswordRequest = z.object({ token: z.string().min(20).max(200), password }).strict();

export const changePasswordRequest = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: password })
  .strict();

export const mfaEnableRequest = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export const mfaDisableRequest = z
  .object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) })
  .strict();

export const switchOrganizationRequest = z.object({ organizationId: z.string().uuid() }).strict();

export interface LoginResponse {
  mfaRequired: boolean;
  mfaEnrollmentRequired?: boolean;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
    mfaEnabled: boolean;
    platformRole: 'none' | 'super_admin';
  };
  organization: { id: string; name: string; slug: string; timezone: string; currency: string } | null;
  membership: { id: string; employeeId: string; roles: { id: string; key: string; name: string }[] } | null;
  /** Effective permission → scope map for the current membership. */
  permissions: Record<string, 'own' | 'team' | 'department' | 'organization'>;
  /** All organizations the user can switch to. */
  organizations: { id: string; name: string; slug: string; current: boolean }[];
  mfaEnrollmentRequired: boolean;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface LoginHistoryEntry {
  id: string;
  outcome: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}
