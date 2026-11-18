import { z } from 'zod';

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL_WORKER: z.string().url().startsWith('postgresql://'),
  REDIS_URL: z.string().url().startsWith('redis://'),
  SMTP_URL: z.string().url().refine((u) => u.startsWith('smtp://') || u.startsWith('smtps://'), 'must be smtp:// or smtps://'),
  EMAIL_FROM: z.string().min(3),
  APP_BASE_URL: z.string().url(),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4200),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid worker configuration. Refusing to start.\n${issues}`);
  }
  return parsed.data;
}
