import { inject } from 'vitest';
import { baseUrls, withDatabase } from './urls';

/** URLs pointing at this run's test database (see global-setup.ts). Call from test files only. */
export function testUrls() {
  const db = inject('testDatabase');
  const b = baseUrls();
  return {
    database: db,
    migrator: withDatabase(b.migrator, db),
    app: withDatabase(b.app, db),
    worker: withDatabase(b.worker, db),
    // Superuser connection: lets tests inspect state underneath RLS. Test-only.
    superuser: withDatabase(b.superuser, db),
    redis: b.redis,
  };
}
