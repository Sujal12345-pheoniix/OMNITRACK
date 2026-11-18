# Roadmap

Owner: CPO and CTO · Status: Draft v0.1 (2026-11-16) · Order of Phases 3–6 awaits sponsor confirmation (PRD Q4)

No dates are given. There is no measured delivery rate yet; estimates will be added after Phase 1 and 2 provide one.

Every phase runs the full lifecycle: DISCOVER → SPECIFY → ARCHITECT → DESIGN → IMPLEMENT → TEST → REVIEW → HARDEN → RELEASE. A phase closes only when every exit criterion is verified and recorded in [engineering/TEST_REPORT.md](../engineering/TEST_REPORT.md).

## Phase 0 — Engineering operating system

Establish current state, governance, standards, risks and plan.

Exit criteria:
- Repository inspected and state recorded.
- Documentation set and engineering trackers exist.
- Initial ADRs and risk register written.
- Sponsor has answered or accepted the working assumptions for PRD Q1–Q8.

## Phase 1 — Foundation

A running skeleton with the full quality pipeline and no business features.

Scope: monorepo scaffold; API and web apps that start; Docker Compose for PostgreSQL, Redis, MinIO and mail; configuration validation; structured logging; error format; health endpoints; Prisma baseline with database roles; CI pipeline with lint, types, tests and security scans.

Exit criteria:
- A fresh clone reaches a running local system with documented commands only.
- `GET /api/v1/health` returns 200 and checks database and Redis.
- The web app renders a page that calls the API through the typed client.
- CI runs every pipeline stage and is green on the main branch.
- A deliberately failing test, a lint error and a committed fake secret each make CI fail.

## Phase 2 — Tenancy, identity and access

The security foundation that every later module depends on. Requirements: SRS section 3.

Exit criteria:
- All FR-ORG, FR-IAM, FR-RBAC and FR-AUD requirements have passing tests.
- Tenant-isolation, authorization-matrix, RLS-coverage and audit-coverage suites exist and pass.
- Security review completed with no open S1 or S2 finding.
- Session revocation and key rotation procedures written and rehearsed.

## Phase 3 — People and the application shell

Employees, departments and teams (M3, M4), plus the design system and app shell that all later modules reuse.

## Phase 4 — Work operations

Tasks and projects, daily activity, approval engine, notifications, documents (M5–M9). The approval engine and documents are built as shared services because Sales and Recruitment depend on them.

## Phase 5 — Sales

Leads, pipeline and customers (M10, M11).

## Phase 6 — Recruitment

Applicant tracking and the candidate portal (M12, M13), including hire-to-employee conversion. The candidate portal is the first surface used by external, untrusted users and gets its own threat review.

## Phase 7 — Reporting and intelligence

Metric definitions, dashboards and exports (M14). Each metric has one written definition and a test that checks it against known data.

## Phase 8 — AI assistant

M15, acting only through the user's own permissions. Includes evaluation of answer correctness and tests for prompt injection and data leakage.

## Phase 9 — Production readiness

Performance testing against NFR targets, penetration test, backup-restore rehearsal, incident runbooks, production infrastructure and first release. Hardening happens in every phase; this phase verifies the whole.

## Dependencies

```
0 → 1 → 2 → 3 → 4 → 5
                  ├→ 6
                  └→ 7 (needs data from 3–6) → 8
9 follows whichever phases are in the first release
```

Phases 5 and 6 are independent of each other and can run in parallel in separate worktrees once Phase 4 is closed.
