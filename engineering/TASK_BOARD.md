# Task Board

Owner: AI Director · Last updated: 2026-11-16

## Assignment template

Every delegated task is written in this form before work starts. A task is moved to Done only after its output has been inspected and its tests run by someone other than the implementer.

```
ID:
Objective:
Scope (in / out):
Inputs:
Dependencies:
Expected output:
Files allowed to change:
Acceptance criteria:
Testing requirements:
Owner:
Reviewer:
```

Two tasks in progress at the same time must not share files in "Files allowed to change". Parallel tasks use separate branches or worktrees.

## Waiting on sponsor

| ID | Item |
|---|---|
| S-01 | Answer PRD Q1–Q8 or accept the working assumptions |
| S-02 | Review ADR-001 to ADR-011, especially 002, 003, 004 and 006 |
| S-03 | Provide a git remote and confirm the CI platform |
| S-04 | Confirm the order of Phases 3–6 |

## Ready — Phase 1 Foundation

Ordered. P1-01 must finish first because it creates the files the others build on; after it, tasks marked ∥ can run in parallel.

| ID | Task | Owner | Reviewer | Files allowed to change |
|---|---|---|---|---|
| P1-01 | Monorepo scaffold: pnpm workspace, Turborepo, shared tsconfig (strict), ESLint, Prettier, editor config | Frontend + Backend Architects | CTO | root config, `packages/config/**` |
| P1-02 ∥ | Local infrastructure: Compose for PostgreSQL 16, Redis, MinIO, mail catcher; `.env.example` | DevOps Architect | SRE | `infra/**`, `.env.example` |
| P1-03 ∥ | API skeleton: NestJS, validated configuration, pino logging, request ID, problem-details error filter, health and readiness endpoints | Backend Architect | CTO | `apps/api/**` |
| P1-04 ∥ | Contracts package and OpenAPI generation with snapshot check; verify the Nest–Zod library is maintained (ADR-006) | API Engineer | Backend Architect | `packages/contracts/**` |
| P1-05 | Prisma baseline: database roles (migrator, app, read-only), first empty migration, tenant-context client extension with an interleaving test (risk R-07) | Database Architect | Security Engineer | `apps/api/prisma/**`, `apps/api/src/platform/database/**` |
| P1-06 ∥ | Web skeleton: Next.js, Tailwind, shadcn/ui, typed API client, one page calling health | Frontend Architect | Design Director | `apps/web/**` |
| P1-07 | Test harness: Vitest, Testcontainers, Playwright with axe; one real test at each level | Automation Engineer | QA Director | test config, `**/*.test.ts`, `e2e/**` |
| P1-08 | CI pipeline: all stages from DEPLOYMENT.md, including secret, dependency and static scans | DevOps Architect | Security Engineer | `.github/**` |
| P1-09 | Verify Phase 1 exit criteria independently, including the three deliberate-failure checks; write results to TEST_REPORT.md | QA Director | AI Director | `engineering/TEST_REPORT.md` |
| P1-10 | Write the local-start and migration procedures | SRE | DevOps Architect | `docs/RUNBOOK.md` |

## In progress

None.

## Done

| ID | Task | Verified by | Date |
|---|---|---|---|
| P0-01 | Inspect repository and toolchain | Directory listing and version commands | 2026-11-16 |
| P0-02 | Write documentation set, trackers, ADRs, risk register | Files exist; content not yet reviewed by sponsor | 2026-11-16 |
