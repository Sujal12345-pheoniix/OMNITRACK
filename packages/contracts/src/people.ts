import { z } from 'zod';
import { email, isoDate, optionalText, pageQuery, phone, text, uuid } from './common';

export const EMPLOYEE_STATUSES = ['pre_joining', 'active', 'notice_period', 'exited', 'cancelled'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Allowed employment status transitions (DOMAINS.md C, state diagram). */
export const EMPLOYEE_TRANSITIONS: Record<EmployeeStatus, readonly EmployeeStatus[]> = {
  pre_joining: ['active', 'cancelled'],
  active: ['notice_period', 'exited'],
  notice_period: ['active', 'exited'],
  exited: [],
  cancelled: [],
};

const employeeFields = {
  firstName: text(80),
  lastName: optionalText(80).default(''),
  workEmail: email.nullable().optional(),
  phone: phone.nullable().optional(),
  jobTitle: optionalText(120).default(''),
  departmentId: uuid.nullable().optional(),
  managerId: uuid.nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('full_time'),
  joinDate: isoDate.nullable().optional(),
  location: optionalText(120).default(''),
};

export const createEmployeeRequest = z
  .object({
    ...employeeFields,
    /** Leave empty to auto-generate (EMP-00001). */
    employeeCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,20}$/, { message: 'Letters, digits and hyphens, up to 20' })
      .optional(),
    status: z.enum(['pre_joining', 'active']).default('active'),
    teamIds: z.array(uuid).max(20).default([]),
  })
  .strict();
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequest>;

export const updateEmployeeRequest = z
  .object({
    firstName: employeeFields.firstName.optional(),
    lastName: optionalText(80).optional(),
    workEmail: employeeFields.workEmail,
    phone: employeeFields.phone,
    jobTitle: optionalText(120).optional(),
    departmentId: employeeFields.departmentId,
    managerId: employeeFields.managerId,
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    joinDate: employeeFields.joinDate,
    location: optionalText(120).optional(),
    effectiveDate: isoDate.optional(),
    version: z.number().int().min(1),
  })
  .strict();

export const changeEmployeeStatusRequest = z
  .object({
    status: z.enum(EMPLOYEE_STATUSES),
    effectiveDate: isoDate,
    note: optionalText(500).optional(),
    version: z.number().int().min(1),
  })
  .strict();

export const employeeListQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  departmentId: uuid.optional(),
  teamId: uuid.optional(),
  managerId: uuid.optional(),
  sort: z.enum(['name', 'code', 'joinDate', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export interface EmployeeDto {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  workEmail: string | null;
  phone: string | null;
  jobTitle: string;
  department: { id: string; name: string } | null;
  manager: { id: string; fullName: string } | null;
  teams: { id: string; name: string }[];
  employmentType: (typeof EMPLOYMENT_TYPES)[number];
  status: EmployeeStatus;
  joinDate: string | null;
  exitDate: string | null;
  location: string;
  hasLogin: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EmploymentEventDto {
  id: string;
  type: string;
  from: unknown;
  to: unknown;
  effectiveDate: string;
  actor: string | null;
  createdAt: string;
}

// --- Departments ---

export const departmentRequest = z
  .object({
    name: text(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,20}$/, { message: '2–20 letters, digits or hyphens' }),
    description: optionalText(500).default(''),
    parentId: uuid.nullable().default(null),
    headEmployeeId: uuid.nullable().default(null),
  })
  .strict();

export const updateDepartmentRequest = departmentRequest
  .partial()
  .extend({ version: z.number().int().min(1) })
  .strict();

export interface DepartmentDto {
  id: string;
  name: string;
  code: string;
  description: string;
  parentId: string | null;
  head: { id: string; fullName: string } | null;
  status: 'active' | 'archived';
  employeeCount: number;
  teamCount: number;
  version: number;
}

export interface DepartmentTreeNode extends DepartmentDto {
  children: DepartmentTreeNode[];
}

// --- Teams ---

export const teamRequest = z
  .object({
    name: text(120),
    description: optionalText(500).default(''),
    departmentId: uuid,
    leaderEmployeeId: uuid,
  })
  .strict();

export const updateTeamRequest = teamRequest.partial().extend({ version: z.number().int().min(1) }).strict();

export const addTeamMemberRequest = z.object({ employeeId: uuid }).strict();

export interface TeamDto {
  id: string;
  name: string;
  description: string;
  department: { id: string; name: string };
  leader: { id: string; fullName: string };
  status: 'active' | 'archived';
  memberCount: number;
  version: number;
}

export interface TeamDetailDto extends TeamDto {
  members: { employeeId: string; fullName: string; jobTitle: string; addedAt: string }[];
}

// --- Audit ---

export const auditListQuery = pageQuery.extend({
  category: z.enum(['security', 'business', 'admin']).optional(),
  action: z.string().max(80).optional(),
  entityType: z.string().max(40).optional(),
  entityId: uuid.optional(),
  actorUserId: uuid.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export interface AuditEventDto {
  id: string;
  category: 'security' | 'business' | 'admin';
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: 'success' | 'failure';
  actor: { userId: string | null; type: string; displayName: string | null };
  correlationId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
}
