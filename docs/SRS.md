# Software Requirements Specification

Owner: Enterprise Business Analyst · Status: Draft v0.1 (2026-11-16)

Detailed functional requirements are written per module at the SPECIFY step of the phase that builds it (see [ROADMAP.md](ROADMAP.md)). This document currently holds the requirement conventions, the non-functional requirements that bind every module, and the Phase 2 requirements, which are the first to be built.

## 1. Conventions

- Requirement IDs: `FR-<module>-<nnn>` and `NFR-<area>-<nnn>`. IDs are never reused.
- Every FR has acceptance criteria written as observable behaviour and at least one automated test that references the ID.
- "Must" is binding. "Should" needs a recorded reason to skip.

## 2. Non-functional requirements

Targets are initial proposals. They become binding once measured against a deployed environment in Phase 1–2 and confirmed.

| ID | Requirement |
|---|---|
| NFR-SEC-001 | Every API endpoint requires authentication unless explicitly listed as public. |
| NFR-SEC-002 | Every state-changing or data-returning endpoint checks a named permission on the server. |
| NFR-SEC-003 | Every tenant-owned row carries `organization_id`; isolation is enforced in the application and by PostgreSQL row-level security. |
| NFR-SEC-004 | All external input is validated against a schema before use. |
| NFR-SEC-005 | Secrets come from the environment or a secret manager, never from the repository. |
| NFR-AUD-001 | Create, update, delete, permission change, sign-in, export and approval actions write an audit event in the same transaction as the change. |
| NFR-AUD-002 | Audit events cannot be updated or deleted through the application. |
| NFR-PERF-001 | API p95 latency ≤ 300 ms for single-record reads and writes, ≤ 800 ms for list endpoints at 50 rows, under the reference load defined in [TEST_STRATEGY.md](TEST_STRATEGY.md). |
| NFR-PERF-002 | Web: Largest Contentful Paint ≤ 2.5 s and Interaction to Next Paint ≤ 200 ms at the 75th percentile on a mid-range laptop. |
| NFR-PERF-003 | All list endpoints are paginated; no endpoint returns an unbounded result. |
| NFR-REL-001 | Availability target 99.9% monthly for production. |
| NFR-REL-002 | Recovery point objective ≤ 15 minutes; recovery time objective ≤ 4 hours. Restore is rehearsed before first production release. |
| NFR-A11Y-001 | WCAG 2.2 AA; full keyboard operation; automated axe checks in CI. |
| NFR-UX-001 | Layouts work from 360 px to 1920 px. |
| NFR-OBS-001 | Structured JSON logs with request ID, organization ID and user ID; no secrets or personal data in logs beyond IDs. |
| NFR-MNT-001 | TypeScript strict mode everywhere; lint, type check and tests must pass in CI before merge. |
| NFR-DATA-001 | Schema changes only through versioned migrations; merged migrations are immutable. |
| NFR-I18N-001 | No user-facing string hard-coded in a way that blocks translation; timestamps stored in UTC and shown in the user's time zone. |

## 3. Phase 2 functional requirements: tenancy, identity and access

### Organization (M1)

| ID | Requirement |
|---|---|
| FR-ORG-001 | A new organization can be created with an initial owner account. |
| FR-ORG-002 | An owner or admin can update organization profile and settings. |
| FR-ORG-003 | An admin can invite a user by email; the invitation is single-use and expires. |
| FR-ORG-004 | A user of organization A receives "not found" for any resource of organization B, regardless of the ID supplied. |

### Identity (M2)

| ID | Requirement |
|---|---|
| FR-IAM-001 | A user can sign in with email and password. |
| FR-IAM-002 | Passwords are hashed with Argon2id; a minimum length of 12 is enforced and breached-password screening is applied. |
| FR-IAM-003 | Sessions use a short-lived access token and a rotating refresh token; reuse of a rotated refresh token revokes the whole session family. |
| FR-IAM-004 | A user can sign out; an admin can revoke all sessions of a user. |
| FR-IAM-005 | Password reset uses a single-use, expiring token and does not reveal whether an email is registered. |
| FR-IAM-006 | Sign-in is rate-limited per account and per IP, with progressive delay. |
| FR-IAM-007 | A user can enrol in TOTP multi-factor authentication; an organization can require it. |
| FR-IAM-008 | Deactivating a user ends their sessions immediately. |

### Access control

| ID | Requirement |
|---|---|
| FR-RBAC-001 | Permissions are fixed codes defined by the system (for example `employee.read`). |
| FR-RBAC-002 | Each organization has built-in roles and can define custom roles as sets of permissions. |
| FR-RBAC-003 | A permission can be scoped to own records, own team, or the whole organization. |
| FR-RBAC-004 | A user cannot grant a permission they do not hold. |
| FR-RBAC-005 | The UI hides actions the user cannot perform, and the API rejects them independently. |

### Audit

| ID | Requirement |
|---|---|
| FR-AUD-001 | An admin with `audit.read` can list and filter audit events of their organization. |
| FR-AUD-002 | Each event records actor, action, target type and ID, time, request ID, source IP and a before/after summary with sensitive fields redacted. |

## 4. Modules not yet specified

M3–M15 have scope statements in [PRD.md](PRD.md) only. Their FRs are written at the start of their phase.
