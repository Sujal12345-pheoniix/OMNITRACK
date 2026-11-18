import { Errors } from './errors';

/**
 * Opaque cursors. Lists sorted by a user-chosen column use an offset cursor; append-only
 * logs (audit) use a keyset cursor. Clients must treat both as opaque strings.
 */
export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object') return parsed as T;
  } catch {
    /* fall through */
  }
  throw Errors.rule('INVALID_CURSOR', 'The pagination cursor is invalid.');
}

export function offsetFrom(cursor: string | undefined): number {
  const c = decodeCursor<{ o?: unknown }>(cursor);
  if (!c) return 0;
  if (typeof c.o !== 'number' || !Number.isInteger(c.o) || c.o < 0 || c.o > 1_000_000) {
    throw Errors.rule('INVALID_CURSOR', 'The pagination cursor is invalid.');
  }
  return c.o;
}

export function nextOffsetCursor(offset: number, limit: number, returned: number, total: number): string | null {
  return offset + returned < total && returned === limit ? encodeCursor({ o: offset + limit }) : null;
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function isoDateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function toDate(s: string | null | undefined): Date | null | undefined {
  if (s === undefined) return undefined;
  if (s === null) return null;
  return new Date(`${s}T00:00:00.000Z`);
}
