import { z } from 'zod';

export const uuid = z.string().uuid({ message: 'Must be a valid ID' });

/** Trimmed, non-empty, bounded text. */
export const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min, { message: min === 1 ? 'Required' : `Must be at least ${min} characters` })
    .max(max, { message: `Must be at most ${max} characters` });

export const optionalText = (max: number) =>
  z.string().trim().max(max, { message: `Must be at most ${max} characters` });

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email({ message: 'Must be a valid email address' });

/** ISO calendar date, YYYY-MM-DD. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Must be a date in YYYY-MM-DD format' })
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), { message: 'Must be a valid date' });

export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, { message: 'Must be a valid phone number' });

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, { message: 'Must be at least 3 characters' })
  .max(40, { message: 'Must be at most 40 characters' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Use lowercase letters, digits and single hyphens',
  });

/** Cursor pagination (API.md §5). */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /** Total matching rows; present on endpoints where counting is cheap. */
  total?: number;
}

export const versionField = z.number().int().min(1);

/** RFC 9457 problem details, the single error format (API.md §4). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
  [extra: string]: unknown;
}
