import { PERMISSION_CODES, type PermissionCode, type Scope } from './catalog';

/**
 * Built-in roles. Their grants live in code, not in the database, so that extending the
 * catalog in a later release updates every organization's built-in roles without a data
 * migration. Each organization gets one row per built-in role (for assignment); custom
 * roles store their grants in `role_permissions`.
 */
export const BUILT_IN_ROLE_KEYS = [
  'org_owner',
  'org_admin',
  'hr_manager',
  'department_head',
  'manager',
  'team_leader',
  'sales_manager',
  'sales_executive',
  'recruiter',
  'employee',
] as const;
export type BuiltInRoleKey = (typeof BUILT_IN_ROLE_KEYS)[number];

export type Grants = Partial<Record<PermissionCode, Scope>>;

export interface BuiltInRole {
  readonly name: string;
  readonly description: string;
  /** Members holding this role must enrol in MFA before using the application. */
  readonly requiresMfa: boolean;
  readonly grants: Grants;
}

function everything(scope: Scope): Grants {
  return Object.fromEntries(PERMISSION_CODES.map((c) => [c, scope])) as Grants;
}

/** Everyone gets these: self-service on own work, and read access to the org structure. */
const BASELINE: Grants = {
  'employee.read': 'own',
  'department.read': 'organization',
  'team.read': 'organization',
  'task.read': 'own',
  'task.create': 'organization',
  'task.update': 'own',
  'task.assign': 'own',
};

const SALES_SELF: Grants = {
  'lead.read': 'own',
  'lead.create': 'organization',
  'lead.update': 'own',
  'lead.convert': 'own',
  'customer.read': 'own',
  'customer.manage': 'own',
  'interaction.read': 'own',
  'interaction.create': 'own',
  'followup.read': 'own',
  'followup.manage': 'own',
};

const PEOPLE_LEAD = (scope: Scope): Grants => ({
  'employee.read': scope,
  'task.read': scope,
  'task.update': scope,
  'task.assign': scope,
  'task.review': scope,
  'daily_report.read': scope,
  'daily_report.review': scope,
  'dashboard.team.view': scope,
  'activity.read': scope,
});

export const BUILT_IN_ROLES: Record<BuiltInRoleKey, BuiltInRole> = {
  org_owner: {
    name: 'Organization owner',
    description: 'Full control of the organization, including ownership and closure.',
    requiresMfa: true,
    grants: everything('organization'),
  },
  org_admin: {
    name: 'Organization admin',
    description: 'Administers members, roles, structure and all modules.',
    requiresMfa: true,
    grants: everything('organization'),
  },
  hr_manager: {
    name: 'HR manager',
    description: 'Maintains employee records and organization structure.',
    requiresMfa: false,
    grants: {
      ...BASELINE,
      'employee.read': 'organization',
      'employee.create': 'organization',
      'employee.update': 'organization',
      'employee.exit': 'organization',
      'employee.export': 'organization',
      'department.manage': 'organization',
      'team.manage': 'organization',
      'member.read': 'organization',
      'member.invite': 'organization',
      'daily_report.read': 'organization',
      'dashboard.organization.view': 'organization',
    },
  },
  department_head: {
    name: 'Department head',
    description: 'Leads a department and everything beneath it.',
    requiresMfa: false,
    grants: {
      ...BASELINE,
      ...SALES_SELF,
      ...PEOPLE_LEAD('department'),
      'employee.update': 'department',
      'department.manage': 'department',
      'team.manage': 'department',
      'lead.read': 'department',
      'customer.read': 'department',
      'interaction.read': 'department',
      'followup.read': 'department',
    },
  },
  manager: {
    name: 'Manager',
    description: 'Manages direct and indirect reports.',
    requiresMfa: false,
    grants: { ...BASELINE, ...PEOPLE_LEAD('team') },
  },
  team_leader: {
    name: 'Team leader',
    description: 'Leads one or more teams and manages their membership.',
    requiresMfa: false,
    grants: { ...BASELINE, ...PEOPLE_LEAD('team'), 'team.manage': 'team' },
  },
  sales_manager: {
    name: 'Sales manager',
    description: 'Runs a sales team: assigns leads, reviews pipeline and performance.',
    requiresMfa: false,
    grants: {
      ...BASELINE,
      ...SALES_SELF,
      ...PEOPLE_LEAD('team'),
      'lead.read': 'team',
      'lead.update': 'team',
      'lead.assign': 'team',
      'lead.convert': 'team',
      'lead.delete': 'team',
      'lead.export': 'team',
      'customer.read': 'team',
      'customer.manage': 'team',
      'customer.export': 'team',
      'interaction.read': 'team',
      'followup.read': 'team',
      'followup.manage': 'team',
      'settings.picklist.manage': 'organization',
    },
  },
  sales_executive: {
    name: 'Sales executive',
    description: 'Works their own leads, customers and follow-ups.',
    requiresMfa: false,
    grants: { ...BASELINE, ...SALES_SELF },
  },
  recruiter: {
    name: 'Recruiter',
    description: 'Runs hiring. Recruitment permissions arrive with the recruitment module.',
    requiresMfa: false,
    grants: { ...BASELINE },
  },
  employee: {
    name: 'Employee',
    description: 'Default role: own profile, own tasks, own daily reports.',
    requiresMfa: false,
    grants: { ...BASELINE },
  },
};

export function isBuiltInRoleKey(key: string): key is BuiltInRoleKey {
  return (BUILT_IN_ROLE_KEYS as readonly string[]).includes(key);
}

/** Roles only an existing owner may grant or revoke (DOMAINS.md B-R2). */
export const OWNER_ONLY_ROLE_KEYS: readonly BuiltInRoleKey[] = ['org_owner'];
