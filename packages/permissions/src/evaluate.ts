import {
  SCOPE_RANK,
  allowedScopes,
  isPermissionCode,
  type PermissionCode,
  type Scope,
} from './catalog';
import type { Grants } from './roles';

/** Merge several roles' grants: each permission takes the broadest scope any role gives. */
export function mergeGrants(...grantSets: Grants[]): Grants {
  const out: Grants = {};
  for (const set of grantSets) {
    for (const [code, scope] of Object.entries(set) as [PermissionCode, Scope][]) {
      const current = out[code];
      if (!current || SCOPE_RANK[scope] > SCOPE_RANK[current]) out[code] = scope;
    }
  }
  return out;
}

export function scopeCovers(held: Scope, required: Scope): boolean {
  return SCOPE_RANK[held] >= SCOPE_RANK[required];
}

/** Deny by default: absent permission means no access. */
export function hasPermission(grants: Grants, code: PermissionCode, atLeast: Scope = 'own'): boolean {
  const held = grants[code];
  return held !== undefined && scopeCovers(held, atLeast);
}

export interface EscalationCheck {
  ok: boolean;
  missing: { permission: PermissionCode; required: Scope; held: Scope | null }[];
}

/**
 * Anti-escalation (DOMAINS.md A-R11): an actor may hand out a set of grants only if they
 * hold every one of them at an equal or broader scope.
 */
export function canGrant(actor: Grants, requested: Grants): EscalationCheck {
  const missing: EscalationCheck['missing'] = [];
  for (const [code, scope] of Object.entries(requested) as [PermissionCode, Scope][]) {
    const held = actor[code] ?? null;
    if (held === null || !scopeCovers(held, scope)) missing.push({ permission: code, required: scope, held });
  }
  return { ok: missing.length === 0, missing };
}

export interface GrantValidationError {
  permission: string;
  message: string;
}

/** Validates a custom role's grants against the catalog. */
export function validateGrants(input: Record<string, string>): {
  grants: Grants;
  errors: GrantValidationError[];
} {
  const grants: Grants = {};
  const errors: GrantValidationError[] = [];
  for (const [code, scope] of Object.entries(input)) {
    if (!isPermissionCode(code)) {
      errors.push({ permission: code, message: 'Unknown permission' });
      continue;
    }
    if (!(allowedScopes(code) as readonly string[]).includes(scope)) {
      errors.push({
        permission: code,
        message: `Scope must be one of: ${allowedScopes(code).join(', ')}`,
      });
      continue;
    }
    grants[code] = scope as Scope;
  }
  return { grants, errors };
}
