import { HttpStatus } from '@nestjs/common';

/**
 * Application error carrying a stable machine-readable code (API.md §4).
 * Thrown anywhere; mapped to RFC 9457 problem details by ProblemFilter.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const Errors = {
  unauthenticated: (message = 'Sign in to continue.') =>
    new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message),
  invalidCredentials: () =>
    new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'),
  forbidden: (message = 'You do not have permission to do this.') =>
    new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message),
  notFound: (what = 'Record') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`),
  conflict: (code: string, message: string, extra: Record<string, unknown> = {}) =>
    new AppError(HttpStatus.CONFLICT, code, message, extra),
  rule: (code: string, message: string, extra: Record<string, unknown> = {}) =>
    new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, extra),
  versionConflict: () =>
    new AppError(
      HttpStatus.CONFLICT,
      'VERSION_CONFLICT',
      'This record was changed by someone else. Reload it and try again.',
    ),
  invalidTransition: (from: string, to: string, allowed: readonly string[]) =>
    new AppError(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `Cannot change status from ${from} to ${to}.`, {
      current: from,
      allowed,
    }),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many attempts. Try again later.', {
      retryAfter: retryAfterSeconds,
    }),
  duplicate: (field: string, message?: string) =>
    new AppError(HttpStatus.CONFLICT, 'DUPLICATE', message ?? `A record with this ${field} already exists.`, {
      field,
    }),
};
