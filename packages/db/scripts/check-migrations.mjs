#!/usr/bin/env node
// Verifies that the migrations, applied to an empty database, produce exactly the schema in
// schema.prisma (no drift), and that the migration history is append-only versus a base ref.
//
// Non-destructive: it creates its own uniquely named database and drops only that database.
// Usage: DATABASE_URL=<migrator url> node scripts/check-migrations.mjs [--base origin/main]
import { execFileSync, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL (migrator role) is required.');
  process.exit(1);
}

function withDb(u, db) {
  const x = new URL(u);
  x.pathname = `/${db}`;
  return x.toString();
}

let failed = false;

// 1. Append-only history: compared with a base ref, migrations may only be added.
const baseIdx = process.argv.indexOf('--base');
if (baseIdx > -1) {
  const base = process.argv[baseIdx + 1];
  const out = execSync(`git diff --name-status ${base} -- prisma/migrations`, { cwd: pkg }).toString().trim();
  const changed = out.split('\n').filter((l) => l && !l.startsWith('A'));
  if (changed.length) {
    console.error('✗ Existing migrations were modified or deleted (history must be append-only):');
    for (const l of changed) console.error(`    ${l}`);
    failed = true;
  } else {
    console.log('✓ Migration history is append-only versus', base);
  }
}

// 2. Drift: fresh database + migrate deploy, then diff against the Prisma schema.
const name = `omnitrack_migcheck_${Date.now()}_${randomBytes(3).toString('hex')}`;
const admin = new PrismaClient({ datasourceUrl: withDb(url, 'postgres') });
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const target = withDb(url, name);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: pkg, env: { ...process.env, DATABASE_URL: target }, stdio: 'pipe', shell: true });
  console.log('✓ All migrations apply cleanly to an empty database');
  try {
    execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-url', target, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], {
      cwd: pkg,
      stdio: 'pipe',
      shell: true,
    });
    console.log('✓ No drift between migrations and schema.prisma');
  } catch (err) {
    if (err.status === 2) {
      console.error('✗ schema.prisma differs from the migrations. Create a migration with `npm run db:migrate:dev`.');
      console.error(String(err.stdout ?? ''));
      failed = true;
    } else {
      throw err;
    }
  }
} finally {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
  await admin.$disconnect();
}

process.exit(failed ? 1 : 0);
