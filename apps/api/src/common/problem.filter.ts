import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@omnitrack/db';
import type { Problem } from '@omnitrack/contracts';
import type { Request, Response } from 'express';
import { AppError } from './errors';

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Not authenticated',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload too large',
  422: 'Unprocessable request',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

function isBodyParserError(e: unknown): e is { status: number; type: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { type?: unknown }).type === 'string' &&
    String((e as { type: string }).type).startsWith('entity.') &&
    typeof (e as { status?: unknown }).status === 'number'
  );
}

/** Maps every error to RFC 9457 problem details. Internal details never reach the client. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = String(req.id ?? '');

    let problem: Problem;

    if (exception instanceof AppError) {
      problem = this.make(exception.status, exception.code, exception.message, requestId, exception.extra);
      if (exception.status === 429 && typeof exception.extra.retryAfter === 'number') {
        res.setHeader('Retry-After', String(exception.extra.retryAfter));
      }
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      problem = this.make(409, 'DUPLICATE', 'A record with these values already exists.', requestId);
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      (exception.code === 'P2025' || exception.code === 'P2003')
    ) {
      problem = this.make(404, 'NOT_FOUND', 'Record not found.', requestId);
    } else if (isBodyParserError(exception)) {
      // Raised by the JSON body parser before Nest routing (http-errors objects).
      problem =
        exception.status === 413
          ? this.make(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.', requestId)
          : this.make(400, 'BAD_REQUEST', 'Malformed request.', requestId);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'HTTP_ERROR';
      const message = status === 404 ? 'Route not found.' : status === 400 ? 'Malformed request.' : exception.message;
      problem = this.make(status, code, message, requestId);
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
      problem = this.make(500, 'INTERNAL', 'Something went wrong. Quote the request ID if you contact support.', requestId);
    }

    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private make(
    status: number,
    code: string,
    detail: string,
    requestId: string,
    extra: Record<string, unknown> = {},
  ): Problem {
    return {
      type: `https://omnitrack.dev/problems/${code.toLowerCase().replace(/_/g, '-')}`,
      title: TITLES[status] ?? (status >= 500 ? 'Server error' : 'Request failed'),
      status: status || HttpStatus.INTERNAL_SERVER_ERROR,
      code,
      detail,
      requestId,
      ...extra,
    };
  }
}
