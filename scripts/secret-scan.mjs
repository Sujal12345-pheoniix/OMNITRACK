#!/usr/bin/env node
// Scans the working tree (or git history with --history) for committed secrets using gitleaks
// in Docker. Exit code is non-zero when a leak is found.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const history = process.argv.includes('--history');
const args = [
  'run', '--rm', '-v', `${root}:/repo`, 'ghcr.io/gitleaks/gitleaks:v8.24.3',
  history ? 'git' : 'dir', '/repo', '--config', '/repo/.gitleaks.toml', '--redact', '--no-banner', '--exit-code', '1',
];
const r = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
