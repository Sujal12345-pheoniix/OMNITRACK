import type { Tx } from '@omnitrack/db';

/** Atomically allocates the next number of a per-organization counter (RLS applies). */
export async function nextCounter(tx: Tx, organizationId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO org_counters (organization_id, key, next_value) VALUES (${organizationId}::uuid, ${key}, 2)
    ON CONFLICT (organization_id, key) DO UPDATE SET next_value = org_counters.next_value + 1
    RETURNING next_value - 1 AS value`;
  return Number(rows[0]!.value);
}

export async function nextEmployeeCode(tx: Tx, organizationId: string): Promise<string> {
  const n = await nextCounter(tx, organizationId, 'employee');
  return `EMP-${String(n).padStart(5, '0')}`;
}

export function splitName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/);
  return { firstName: parts[0] ?? displayName, lastName: parts.slice(1).join(' ') };
}

export function fullName(e: { firstName: string; lastName: string }): string {
  return `${e.firstName} ${e.lastName}`.trim();
}
