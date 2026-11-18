# Architecture

Owner: CTO · Status: Draft v0.1 (2026-11-16) · Describes the intended design. Nothing here is built yet.

Each choice below is backed by an ADR in [DECISIONS.md](DECISIONS.md).

## 1. Shape of the system

A modular monolith: one API process and one web app, sharing one PostgreSQL database, with background work on a queue.

```
Browser ──► Next.js web app ──► NestJS API ──► PostgreSQL (RLS)
                                   │
                                   ├──► Redis ──► BullMQ workers (email, exports, reports)
                                   └──► S3-compatible object storage (documents)
```

Microservices are deliberately not used (ADR-002). Module boundaries are enforced in code so a module can be extracted later if load or team structure demands it.

## 2. Repository layout (ADR-001)

```
apps/
  api/          NestJS REST API and queue workers
  web/          Next.js app (staff UI and candidate portal)
packages/
  contracts/    Zod schemas and types shared by api and web
  config/       Shared tsconfig, eslint and prettier settings
  ui/           Design-system components (added in Phase 3)
docs/           Product and technical documentation
engineering/    Status, task board, test and security reports
infra/          Docker, compose and deployment definitions
```

Package manager pnpm with workspaces; task runner Turborepo.

## 3. Backend modules

Each domain is a NestJS module under `apps/api/src/modules/<domain>` with the same internal structure:

```
<domain>/
  <domain>.module.ts
  <domain>.controller.ts     HTTP only: parse, authorize, delegate
  <domain>.service.ts        Business rules and transactions
  <domain>.repository.ts     All database access for this domain
  <domain>.policy.ts         Permission and scope rules
  <domain>.events.ts         Domain events this module publishes
```

Boundary rules:

- A module reads and writes only its own tables. It reaches another module's data through that module's exported service.
- Cross-module reactions go through domain events, not direct calls, when the caller does not need the result.
- Controllers contain no business logic. Repositories contain no authorization logic.
- An import-boundary lint rule enforces these in CI.

Platform modules used by all domains: `tenancy`, `auth`, `rbac`, `audit`, `files`, `notifications`, `jobs`, `health`.

## 4. Request lifecycle

1. Request ID assigned; structured log context opened.
2. Authentication guard validates the access token and loads the principal (user, organization, permissions).
3. Permission guard checks the permission declared on the route. Routes without a declared permission or an explicit `@Public()` marker fail the build.
4. Zod validation of params, query and body against the shared contract.
5. Service runs inside a database transaction that first sets the tenant context (`SET LOCAL app.current_org_id`), so row-level security applies to every statement.
6. Audit event written in the same transaction for audited actions.
7. Response serialized through the contract schema, so undeclared fields cannot leak.
8. Errors mapped to one error format (see [API.md](API.md)).

## 5. Multi-tenancy (ADR-003)

Shared database, shared schema. Every tenant-owned table has a non-null `organization_id`. Isolation has two independent layers:

1. Application: the tenant ID comes only from the authenticated session, never from request input. Repositories are tenant-scoped by construction.
2. Database: PostgreSQL row-level security policies compare `organization_id` with the transaction's `app.current_org_id`. The application connects as a role that cannot bypass RLS. Migrations run as a separate, privileged role.

An automated isolation test suite runs every tenant-scoped endpoint as a user of another organization and expects "not found".

## 6. Identity and access (ADR-004, ADR-005)

- Authentication is implemented in the API: Argon2id password hashes, 15-minute access JWT, rotating opaque refresh token stored hashed, both delivered in `HttpOnly; Secure; SameSite` cookies.
- Candidates are a separate principal type with their own session audience and can reach only candidate-portal routes.
- Authorization is role-based with system-defined permission codes and a scope (own, team, organization).

## 7. Data

PostgreSQL 16 with Prisma. Conventions are in [DATABASE.md](DATABASE.md).

## 8. Background jobs

BullMQ on Redis. Jobs carry the organization ID and re-establish tenant context before touching data. Jobs are idempotent and retried with backoff; exhausted jobs go to a dead-letter queue that is monitored. A transactional outbox table guarantees that an event is published if and only if the business transaction commits.

## 9. Files (ADR-009)

Private buckets in S3-compatible storage (MinIO locally). Upload and download use short-lived presigned URLs issued after a permission check. Metadata, ownership and classification live in PostgreSQL. Type and size are validated server-side; malware scanning gates availability before production release.

## 10. Frontend

Next.js App Router, TypeScript strict, Tailwind CSS, shadcn/ui. The web app calls the API through a typed client generated from the OpenAPI document. Server state via TanStack Query; forms via React Hook Form with the shared Zod schemas. The web app holds no business rules and makes no authorization decisions; it only reflects what the API reports the user may do.

## 11. Observability

Structured JSON logs (pino), OpenTelemetry traces and metrics, health and readiness endpoints, error tracking. Tooling choice depends on the hosting decision (PRD Q2).

## 12. AI assistant (ADR-010)

Built last. It calls the same service layer as a normal user request, under the requesting user's identity and permissions. It has no direct database access and no elevated role. Design is finalized in Phase 8.

## 13. Known contradictions and gaps

- Hosting target is undecided, so deployment, observability tooling and cost are not yet designed.
- Reporting on the transactional database will not scale indefinitely; a read replica or warehouse decision is deferred to Phase 7.
- Search (full-text across modules) has no design yet; PostgreSQL full-text search is the assumed starting point.
