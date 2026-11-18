import type { Problem } from '@omnitrack/contracts';

/** A failed API call, carrying the RFC 9457 problem details (API.md §4). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly fieldErrors: Record<string, string>;
  readonly problem: Partial<Problem>;

  constructor(status: number, problem: Partial<Problem> | undefined) {
    const p = problem ?? {};
    super(p.detail ?? (status >= 500 ? 'Something went wrong on our side.' : 'The request could not be completed.'));
    this.status = status;
    this.code = p.code ?? (status === 0 ? 'NETWORK_ERROR' : 'HTTP_ERROR');
    this.requestId = p.requestId ?? null;
    this.problem = p;
    this.fieldErrors = {};
    for (const e of p.errors ?? []) {
      if (!this.fieldErrors[e.path]) this.fieldErrors[e.path] = e.message;
    }
  }

  /** User-facing message; includes the request ID for server errors so support can trace it. */
  get userMessage(): string {
    if (this.status >= 500 && this.requestId) return `${this.message} (Reference: ${this.requestId})`;
    return this.message;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function freshCsrfToken(): Promise<string> {
  const res = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
  const body = (await res.json()) as { csrfToken: string };
  return body.csrfToken;
}

async function csrfToken(): Promise<string> {
  return readCookie('ot_csrf') ?? (await freshCsrfToken());
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

/**
 * Calls the OmniTrack API through the same-origin /api proxy. Session cookies are HttpOnly
 * and never read by JavaScript; unsafe methods carry the double-submit CSRF token.
 */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const unsafe = method !== 'GET';
  const url = `/api/v1${withQuery(path, opts.query)}`;

  const send = async (token: string | null) =>
    fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-CSRF-Token': token } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res: Response;
  try {
    res = await send(unsafe ? await csrfToken() : null);
    if (unsafe && res.status === 403) {
      const problem = (await res.clone().json().catch(() => null)) as Partial<Problem> | null;
      if (problem?.code === 'CSRF_FAILED') res = await send(await freshCsrfToken());
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, { detail: 'Cannot reach the server. Check your connection and try again.' });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new ApiError(res.status, data as Partial<Problem> | undefined);
  return data as T;
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.userMessage;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? err.fieldErrors : {};
}
