import type { NextFunction, Request, Response } from 'express';
import { safeEqual } from './crypto';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence for cookie-authenticated requests (SECURITY.md §2):
 *  1. Double-submit token: the X-CSRF-Token header must equal the ot_csrf cookie.
 *     A cross-site page can neither read the cookie nor set the header.
 *  2. If the browser sends an Origin header, it must be one of our own origins.
 * Session cookies are additionally SameSite=Lax.
 */
export function csrfMiddleware(allowedOrigins: string[]) {
  const origins = new Set(allowedOrigins.map((o) => new URL(o).origin));
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!UNSAFE.has(req.method)) return next();
    const origin = req.headers.origin;
    const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.ot_csrf ?? '';
    const header = String(req.headers['x-csrf-token'] ?? '');
    const originOk = !origin || origins.has(origin);
    if (originOk && cookie.length >= 20 && safeEqual(cookie, header)) return next();
    res
      .status(403)
      .type('application/problem+json')
      .json({
        type: 'https://omnitrack.dev/problems/csrf-failed',
        title: 'Forbidden',
        status: 403,
        code: 'CSRF_FAILED',
        detail: 'Your session security token is missing or invalid. Reload the page and try again.',
        requestId: String((req as Request & { id?: string }).id ?? ''),
      });
  };
}
