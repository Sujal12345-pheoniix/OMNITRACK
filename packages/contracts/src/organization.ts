import { z } from 'zod';
import { email, optionalText, slug, text, uuid } from './common';

const timezone = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid IANA time zone' },
  );

export const createOrganizationRequest = z
  .object({ name: text(120, 2), slug })
  .strict();

export const updateOrganizationRequest = z
  .object({
    name: text(120, 2).optional(),
    timezone: timezone.optional(),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    version: z.number().int().min(1),
  })
  .strict();

export const platformCreateOrganizationRequest = z
  .object({ name: text(120, 2), slug, ownerEmail: email })
  .strict();

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  timezone: string;
  locale: string;
  currency: string;
  createdAt: string;
  version: number;
}

// --- Members & invitations ---

export const createInvitationRequest = z
  .object({ email, roleId: uuid, employeeId: uuid.optional() })
  .strict();

export const acceptInvitationRequest = z
  .object({
    token: z.string().min(20).max(200),
    /** Required only when the invited email has no OmniTrack account yet. */
    displayName: text(120).optional(),
    password: z.string().min(12).max(128).optional(),
  })
  .strict();

export const assignRolesRequest = z.object({ roleIds: z.array(uuid).min(1).max(20) }).strict();

export interface MemberDto {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  employeeId: string;
  employeeName: string;
  status: 'active' | 'deactivated';
  mfaEnabled: boolean;
  roles: { id: string; key: string; name: string }[];
  createdAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: { id: string; name: string };
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface InvitationPreviewDto {
  organizationName: string;
  email: string;
  roleName: string;
  accountExists: boolean;
}

// --- Roles ---

const scope = z.enum(['own', 'team', 'department', 'organization']);

export const roleRequest = z
  .object({
    name: text(80, 2),
    description: optionalText(300).default(''),
    grants: z.record(z.string().max(64), scope),
  })
  .strict();

export const updateRoleRequest = roleRequest.partial().extend({ version: z.number().int().min(1) }).strict();

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  requiresMfa: boolean;
  grants: Record<string, 'own' | 'team' | 'department' | 'organization'>;
  memberCount: number;
  version: number;
}

export interface PermissionDto {
  code: string;
  module: string;
  description: string;
  scopes: string[];
  sensitive: boolean;
}
