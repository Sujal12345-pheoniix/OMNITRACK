import { type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors';

/** Validates and normalizes input against a shared contract schema (API.md §2). */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new AppError(422, 'VALIDATION_FAILED', 'Some fields are invalid.', {
      errors: result.error.issues.map((i) => ({
        path: i.path.join('.') || '(body)',
        message: i.code === 'unrecognized_keys' ? `Unknown field(s): ${i.keys.join(', ')}` : i.message,
      })),
    });
  }
}

/** Validates a single path parameter as a UUID; malformed IDs are reported as not found. */
export class UuidParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new AppError(404, 'NOT_FOUND', 'Record not found.');
    }
    return value.toLowerCase();
  }
}
