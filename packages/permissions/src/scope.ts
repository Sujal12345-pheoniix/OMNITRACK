import type { Scope } from './catalog';

/**
 * Facts about the actor's position in the organization, loaded by the API once per request
 * when a scoped check needs them (DOMAINS.md §0.3).
 */
export interface ActorStructure {
  employeeId: string;
  /** Employees in teams the actor leads (excluding the actor). */
  ledTeamMemberIds: readonly string[];
  /** Direct and indirect reports of the actor. */
  reportIds: readonly string[];
  /** Departments the actor heads, including all of their sub-departments. */
  headedDepartmentIds: readonly string[];
}

/**
 * Which records are visible for a given scope, expressed over the employee who owns a
 * record. A record is visible when its owner is in `employeeIds` or works in one of
 * `departmentIds`. `all` means no restriction within the organization.
 */
export type Visibility =
  | { all: true }
  | { all: false; employeeIds: string[]; departmentIds: string[] };

export function visibilityFor(scope: Scope, actor: ActorStructure): Visibility {
  if (scope === 'organization') return { all: true };
  const ids = new Set<string>([actor.employeeId]);
  if (scope === 'team' || scope === 'department') {
    actor.ledTeamMemberIds.forEach((id) => ids.add(id));
    actor.reportIds.forEach((id) => ids.add(id));
  }
  const departmentIds = scope === 'department' ? [...actor.headedDepartmentIds] : [];
  return { all: false, employeeIds: [...ids], departmentIds };
}

export function isVisible(
  visibility: Visibility,
  owner: { employeeId: string | null; departmentId: string | null },
): boolean {
  if (visibility.all) return true;
  if (owner.employeeId && visibility.employeeIds.includes(owner.employeeId)) return true;
  if (owner.departmentId && visibility.departmentIds.includes(owner.departmentId)) return true;
  return false;
}

/** All descendants of the given roots, roots included. Safe against malformed cyclic data. */
export function subtree(
  nodes: readonly { id: string; parentId: string | null }[],
  rootIds: readonly string[],
): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = children.get(n.parentId) ?? [];
    list.push(n.id);
    children.set(n.parentId, list);
  }
  const seen = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return [...seen];
}

/**
 * True when making `newParentId` the parent of `nodeId` would create a cycle, i.e. when
 * `newParentId` is `nodeId` itself or one of its descendants. Used for departments and
 * reporting lines alike.
 */
export function wouldCreateCycle(
  nodes: readonly { id: string; parentId: string | null }[],
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  return subtree(nodes, [nodeId]).includes(newParentId);
}

/** Depth of a node (root = 1) after hypothetically re-parenting `nodeId`. */
export function depthOf(
  nodes: readonly { id: string; parentId: string | null }[],
  nodeId: string,
): number {
  const parent = new Map(nodes.map((n) => [n.id, n.parentId]));
  let depth = 0;
  let current: string | null | undefined = nodeId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = parent.get(current) ?? null;
  }
  return depth;
}

/** Height of the subtree rooted at nodeId (a leaf = 1). */
export function subtreeHeight(
  nodes: readonly { id: string; parentId: string | null }[],
  nodeId: string,
): number {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  }
  const height = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = children.get(id) ?? [];
    return 1 + (kids.length ? Math.max(...kids.map((k) => height(k, seen))) : 0);
  };
  return height(nodeId, new Set());
}
