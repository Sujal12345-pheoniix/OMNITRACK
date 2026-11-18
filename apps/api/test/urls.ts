/** Connection helpers with no Vitest runtime dependency (usable from globalSetup). */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; run integration tests via "npm run test:integration".`);
  return v;
}

export function baseUrls() {
  const migrator = required('DATABASE_URL');
  const redis = new URL(process.env.REDIS_URL ?? 'redis://localhost:16379');
  redis.pathname = '/1';
  return {
    migrator,
    app: required('DATABASE_URL_APP'),
    worker: process.env.DATABASE_URL_WORKER ?? required('DATABASE_URL_APP'),
    superuser: process.env.TEST_SUPERUSER_URL ?? migrator.replace(/\/\/[^@]+@/, '//postgres:dev_superuser_pw@'),
    redis: redis.toString(),
  };
}
