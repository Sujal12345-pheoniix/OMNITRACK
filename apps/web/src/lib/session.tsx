'use client';

import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@omnitrack/contracts';
import { hasPermission, type PermissionCode, type Scope } from '@omnitrack/permissions';
import { get } from './api';

export const meKey = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => get<MeResponse>('/me'), staleTime: 60_000 });
}

/** UX-only permission check; the API enforces every rule independently (FR-RBAC-005). */
export function useCan() {
  const { data } = useMe();
  return (code: PermissionCode, atLeast: Scope = 'own') =>
    !!data && hasPermission(data.permissions as Partial<Record<PermissionCode, Scope>>, code, atLeast);
}

/** Sends the browser to the sign-in page, preserving where the user was. */
export function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const here = window.location.pathname + window.location.search;
  const params = here && here !== '/' && !here.startsWith('/login') ? `?returnTo=${encodeURIComponent(here)}` : '';
  window.location.assign(`/login${params}`);
}

/** Only allow internal, path-only redirect targets (prevents open redirects). */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
