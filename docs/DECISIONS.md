# Architecture Decision Records

Owner: CTO

Statuses: **Proposed** (awaiting approval), **Accepted**, **Superseded by ADR-nnn**. An accepted decision is changed only by a new ADR, never by editing the old one or by silently doing something else in code.

All records below were written on 2026-11-16 during Phase 0. They are **Proposed** until the sponsor reviews them. ADR-002, 003, 004 and 006 are the ones most expensive to reverse later and deserve the closest look.

---

## ADR-001 — Monorepo with pnpm workspaces and Turborepo

**Context.** The API and web app share types, validation schemas and tooling configuration.
**Decision.** One repository with `apps/api`, `apps/web` and shared `packages/*`, managed by pnpm workspaces and built with Turborepo.
**Why.** Contract changes land atomically across API and web; one CI pipeline; strict dependency isolation from pnpm.
**Alternatives.** Separate repositories (contract drift, harder coordinated changes); Nx (more capable, more to learn than needed now).
**Consequences.** pnpm must be enabled through Corepack on developer machines and CI.

## ADR-002 — Modular monolith, not microservices

**Context.** Fifteen business modules, a small team, no measured load.
**Decision.** One NestJS application with enforced module boundaries, one database, plus queue workers from the same codebase.
**Why.** Cross-module workflows (hire → employee, approval on any record) need transactions that are simple in one process and hard across services. Operational cost of microservices is not justified without evidence.
**Alternatives.** Microservices per domain (rejected for now); unstructured monolith (rejected: boundaries would erode).
**Consequences.** Boundaries must be enforced by lint rules. Extraction of a module later remains possible because modules own their tables and communicate through services and events.

## ADR-003 — Multi-tenancy: shared schema with `organization_id` and PostgreSQL row-level security

**Context.** Tenant isolation is the most damaging thing to get wrong.
**Decision.** Single database and schema. Every tenant table has `organization_id`. Isolation is enforced in the application and independently by RLS policies keyed on a per-transaction setting. The application's database role cannot bypass RLS.
**Why.** Scales to many tenants with one migration path; RLS means a missed filter in application code does not become a data leak.
**Alternatives.** Schema per tenant (migrations and connection handling become costly at hundreds of tenants); database per tenant (strongest isolation, highest cost, reasonable later for specific regulated customers); application-only filtering (single point of failure).
**Consequences.** Every database access runs in a transaction that sets tenant context. Prisma needs a client extension for this, and connection pooling must be transaction-mode safe. Depends on the answer to PRD Q1: if OmniTrack is single-company only, this is still correct but could be simplified.

## ADR-004 — Authentication implemented in the API with cookie sessions

**Context.** Need email and password sign-in, MFA, session revocation, and a separate candidate principal. SSO need is unknown (PRD Q3).
**Decision.** Implement authentication in the API using vetted libraries: Argon2id hashing, 15-minute access JWT, rotating hashed refresh tokens with reuse detection, HttpOnly cookies, CSRF protection, TOTP MFA.
**Why.** Full control over tenancy-aware sessions and audit; no per-user vendor cost; no external dependency for the core sign-in path.
**Alternatives.** Managed identity provider such as Auth0, Clerk or Cognito (faster and offloads risk, but adds cost, a vendor dependency and tenancy-mapping work); Keycloak (powerful, heavy to operate).
**Consequences.** We own the security of this code (risk R-06). The identity module is designed so an OIDC/SAML provider can be added per organization later. If SSO is required for the first release, revisit this decision before Phase 2 starts.

## ADR-005 — Role-based access control with system permission codes and scopes

**Decision.** Permissions are system-defined codes. Roles are per-organization sets of permissions, with built-in defaults and custom roles. Each grant has a scope: own, team or organization. Checks happen in server-side guards and policies.
**Why.** Understandable to administrators, testable as a matrix, sufficient for the listed modules.
**Alternatives.** Attribute-based or relationship-based access control (more flexible, harder to reason about and audit; not needed yet).
**Consequences.** Record-level sharing beyond own/team/organization would need an extension.

## ADR-006 — Zod schemas in a shared package as the single source of API contracts

**Decision.** Request and response schemas are defined once with Zod in `packages/contracts`. The API validates and serializes with them, the OpenAPI document is generated from them, and the web app uses them for forms and types.
**Why.** One definition removes drift between validation, documentation and client types.
**Alternatives.** class-validator DTOs with the Nest Swagger plugin (idiomatic Nest, but not shareable with the web app); tRPC or GraphQL (the brief calls for REST and OpenAPI).
**Consequences.** Depends on the Nest–Zod integration library; its maintenance status is checked at Phase 1 before commitment.

## ADR-007 — Audit events written in the same transaction as the change

**Decision.** Audited actions insert into an append-only `audit_events` table inside the business transaction. The application role cannot update or delete audit rows.
**Why.** An action and its audit record succeed or fail together; no window where a change exists without a trace.
**Alternatives.** Asynchronous audit through the queue (can lose events); database triggers (lack request context such as actor and IP).
**Consequences.** Slight write overhead; the table needs partitioning as it grows.

## ADR-008 — Data conventions

**Decision.** UUID v7 primary keys generated in the application; `timestamptz` in UTC; money as integer minor units with currency code; hard delete by default with soft delete chosen per table; optimistic locking with a `version` column where records are edited concurrently.
**Why.** Time-ordered UUIDs index well and do not leak counts; the rest prevents well-known classes of data error.

## ADR-009 — S3-compatible object storage with presigned URLs

**Decision.** Files go to private S3-compatible buckets (MinIO locally). The API issues short-lived presigned URLs after permission checks and stores metadata in PostgreSQL.
**Why.** Portable across clouds; file bytes do not pass through the API.
**Consequences.** Malware scanning and a separate download origin are required before production.

## ADR-010 — AI assistant acts through the user's permissions only

**Decision.** The assistant invokes the same service layer as user requests under the requesting user's identity. It has no database credentials and no elevated role. Model and provider are selected in Phase 8.
**Why.** Makes it structurally impossible for the assistant to return data the user could not otherwise see.

## ADR-011 — Background jobs on BullMQ with a transactional outbox

**Decision.** Redis and BullMQ for jobs. Events that must follow a database change are written to an outbox table in the same transaction and relayed to the queue.
**Why.** Prevents lost or phantom side effects such as notifications for a change that rolled back.
**Consequences.** Jobs must be idempotent.
