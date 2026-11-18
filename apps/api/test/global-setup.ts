import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createPrismaClient } from '@omnitrack/db';
import Redis from 'ioredis';
import type { TestProject } from 'vitest/node';
import { baseUrls, withDatabase } from './urls';

const PREFIX = 'omnitrack_test_run_';

/**
 * Creates a fresh, uniquely named database for this test run and applies all migrations
 * with `prisma migrate deploy` (non-destructive). This proves the migrations build a working
 * schema from nothing. The run drops only the database it created.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const base = baseUrls();
  const name = `${PREFIX}${Date.now()}_${randomBytes(3).toString('hex')}`;
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error('unsafe database name');

  const admin = createPrismaClient(withDatabase(base.migrator, 'postgres'));
  // Identifiers cannot be bound as parameters; `name` is generated above and validated.
  // eslint-disable-next-line no-restricted-syntax
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../../../packages/db'),
    env: { ...process.env, DATABASE_URL: withDatabase(base.migrator, name) },
    stdio: 'pipe',
  });

  const redis = new Redis(base.redis);
  await redis.flushdb();
  redis.disconnect();

  project.provide('testDatabase', name);

  return async () => {
    if (process.env.KEEP_TEST_DB === 'true' || !name.startsWith(PREFIX)) return;
    // eslint-disable-next-line no-restricted-syntax
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: string;
  }
}
