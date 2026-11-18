'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  DepartmentDto,
  EmployeeDto,
  MemberDto,
  Page,
  PermissionDto,
  RoleDto,
  TeamDto,
} from '@omnitrack/contracts';
import { get } from './api';

export const keys = {
  employees: ['employees'] as const,
  employee: (id: string) => ['employees', id] as const,
  departments: ['departments'] as const,
  teams: ['teams'] as const,
  members: ['members'] as const,
  invitations: ['invitations'] as const,
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
  organization: ['organization'] as const,
};

export function useDepartments(includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: [...keys.departments, { includeArchived }],
    queryFn: () => get<DepartmentDto[]>('/departments', { includeArchived: includeArchived ? 'true' : undefined }),
    enabled,
  });
}

export function useTeams(includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: [...keys.teams, { includeArchived }],
    queryFn: () => get<TeamDto[]>('/teams', { includeArchived: includeArchived ? 'true' : undefined }),
    enabled,
  });
}

/** Lightweight employee list for pickers (manager, leader, head). Respects the caller's scope. */
export function useEmployeeOptions(enabled = true) {
  return useQuery({
    queryKey: [...keys.employees, 'options'],
    queryFn: () => get<Page<EmployeeDto>>('/employees', { limit: 200, sort: 'name', order: 'asc' }),
    select: (p) => p.items.filter((e) => e.status === 'active' || e.status === 'notice_period'),
    enabled,
  });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: keys.roles, queryFn: () => get<RoleDto[]>('/roles'), enabled });
}

export function usePermissionCatalog(enabled = true) {
  return useQuery({ queryKey: keys.permissions, queryFn: () => get<PermissionDto[]>('/permissions'), staleTime: Infinity, enabled });
}

export function useMembers(enabled = true) {
  return useQuery({ queryKey: keys.members, queryFn: () => get<MemberDto[]>('/members'), enabled });
}
