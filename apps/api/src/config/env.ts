import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/**
 * Validated configuration. The process refuses to start when anything is missing or
 * malformed (SECURITY.md: secrets and configuration).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL_APP: z.string().url().startsWith('postgresql://'),
  REDIS_URL: z.string().url().startsWith('redis://'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  WEB_ORIGIN: z.string().url(),
  PORTAL_ORIGIN: z.string().url(),
  COOKIE_SECURE: bool,
  MFA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'must be 32 bytes, base64-encoded',
    }),
  SELF_SERVICE_SIGNUP: bool,
  MFA_ENFORCE_PRIVILEGED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  HIBP_ENABLED: bool,
  APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration. Refusing to start.\n${issues}`);
  }
  const env = parsed.data;
  if ((env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') && !env.COOKIE_SECURE) {
    throw new Error('Invalid configuration: COOKIE_SECURE must be true in staging and production.');
  }
  return env;
}

export const ENV = Symbol('ENV');
