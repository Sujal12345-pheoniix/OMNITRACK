/**
 * The permission catalog (DOMAINS.md A-R9): a fixed, code-defined list.
 * Organizations combine these into roles; they cannot invent new permissions.
 *
 * Each permission lists the scopes at which it may be granted. A permission whose only
 * sensible scope is the whole organization (for example `role.manage`) lists only that.
 */

export const SCOPES = ['own', 'team', 'department', 'organization'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_RANK: Record<Scope, number> = {
  own: 0,
  team: 1,
  department: 2,
  organization: 3,
};

const ALL: readonly Scope[] = SCOPES;
const ORG: readonly Scope[] = ['organization'];

export interface PermissionDefinition {
  readonly module: string;
  readonly description: string;
  readonly scopes: readonly Scope[];
  /** Sensitive permissions are highlighted in the role editor and audited when granted. */
  readonly sensitive?: boolean;
}

export const PERMISSIONS = {
  // --- Organization & access (domains A, B) ---
  'organization.read': { module: 'organization', description: 'View organization profile and settings', scopes: ORG },
  'organization.update': { module: 'organization', description: 'Change organization profile and settings', scopes: ORG },
  'member.read': { module: 'organization', description: 'View members and their roles', scopes: ORG },
  'member.invite': { module: 'organization', description: 'Invite people and revoke invitations', scopes: ORG },
  'member.deactivate': { module: 'organization', description: 'Deactivate and reactivate members', scopes: ORG, sensitive: true },
  'member.roles.assign': { module: 'organization', description: 'Assign roles to members', scopes: ORG, sensitive: true },
  'role.read': { module: 'organization', description: 'View roles and their permissions', scopes: ORG },
  'role.manage': { module: 'organization', description: 'Create, change and delete custom roles', scopes: ORG, sensitive: true },
  'settings.picklist.manage': { module: 'organization', description: 'Manage value lists such as lead sources and lost reasons', scopes: ORG },
  'audit.read': { module: 'governance', description: 'View the audit log', scopes: ORG, sensitive: true },

  // --- People (domains C, D) ---
  'employee.read': { module: 'people', description: 'View employee records', scopes: ALL },
  'employee.create': { module: 'people', description: 'Create employee records', scopes: ORG },
  'employee.update': { module: 'people', description: 'Edit employee records', scopes: ALL },
  'employee.exit': { module: 'people', description: 'Change employment status (notice, exit, activate)', scopes: ORG },
  'employee.export': { module: 'people', description: 'Export employee lists', scopes: ALL, sensitive: true },
  'department.read': { module: 'people', description: 'View departments', scopes: ORG },
  'department.manage': { module: 'people', description: 'Create and change departments', scopes: ['department', 'organization'] },
  'team.read': { module: 'people', description: 'View teams', scopes: ORG },
  'team.manage': { module: 'people', description: 'Create teams and manage their members', scopes: ['team', 'department', 'organization'] },

  // --- Work (domains H, I) ---
  'task.read': { module: 'work', description: 'View tasks', scopes: ALL },
  'task.create': { module: 'work', description: 'Create tasks', scopes: ORG },
  'task.update': { module: 'work', description: 'Edit tasks and change their status', scopes: ALL },
  'task.assign': { module: 'work', description: 'Assign and reassign tasks to employees within scope', scopes: ALL },
  'task.review': { module: 'work', description: 'Approve tasks in review or request rework', scopes: ['team', 'department', 'organization'] },
  'task.delete': { module: 'work', description: 'Delete tasks', scopes: ALL },
  'daily_report.read': { module: 'work', description: 'View daily reports of others', scopes: ['team', 'department', 'organization'] },
  'daily_report.review': { module: 'work', description: 'Acknowledge reports or request clarification', scopes: ['team', 'department', 'organization'] },

  // --- Sales (domains E, F, G) ---
  'lead.read': { module: 'sales', description: 'View leads', scopes: ALL },
  'lead.create': { module: 'sales', description: 'Create leads', scopes: ORG },
  'lead.update': { module: 'sales', description: 'Edit leads and move them through the pipeline', scopes: ALL },
  'lead.assign': { module: 'sales', description: 'Assign and reassign leads', scopes: ALL },
  'lead.convert': { module: 'sales', description: 'Convert won leads into customers', scopes: ALL },
  'lead.delete': { module: 'sales', description: 'Delete leads', scopes: ALL },
  'lead.export': { module: 'sales', description: 'Export leads', scopes: ALL, sensitive: true },
  'customer.read': { module: 'sales', description: 'View customers and contacts', scopes: ALL },
  'customer.manage': { module: 'sales', description: 'Create and edit customers and contacts', scopes: ALL },
  'customer.export': { module: 'sales', description: 'Export customers and contacts', scopes: ALL, sensitive: true },
  'interaction.read': { module: 'sales', description: 'View interaction history', scopes: ALL },
  'interaction.create': { module: 'sales', description: 'Log calls, emails, meetings and notes', scopes: ALL },
  'followup.read': { module: 'sales', description: 'View follow-ups', scopes: ALL },
  'followup.manage': { module: 'sales', description: 'Schedule, reassign, reschedule and complete follow-ups', scopes: ALL },

  // --- Insight (domain O) ---
  'dashboard.team.view': { module: 'insight', description: 'View the manager dashboard', scopes: ['team', 'department', 'organization'] },
  'dashboard.organization.view': { module: 'insight', description: 'View the administrator dashboard', scopes: ORG },
  'activity.read': { module: 'insight', description: 'View the work activity feed of others', scopes: ['team', 'department', 'organization'] },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function allowedScopes(code: PermissionCode): readonly Scope[] {
  return PERMISSIONS[code].scopes;
}
