# Security

Owner: Application Security Engineer · Status: Draft v0.1 (2026-11-16) · Describes required controls. None are implemented yet.

Verification standard: OWASP ASVS 4.0 Level 2 is the target for first production release. Findings are tracked in [engineering/SECURITY_FINDINGS.md](../engineering/SECURITY_FINDINGS.md).

## 1. Assets and adversaries

Assets: employee personal data, candidate personal data and documents, customer and deal data, credentials and sessions, audit records.

Adversaries considered: an unauthenticated internet attacker; an authenticated user of another tenant; an authenticated user of the same tenant exceeding their role; a candidate reaching staff functions; a compromised dependency; a leaked credential.

The highest-impact failure is cross-tenant data exposure. It has two independent controls and a dedicated test suite.

## 2. Required controls

### Authentication and sessions
- Argon2id password hashing; minimum 12 characters; breached-password screening.
- Access token lifetime 15 minutes; refresh tokens rotate on use, are stored hashed, and reuse revokes the session family.
- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax` or stricter. CSRF token on state-changing requests.
- Rate limiting and progressive delay on sign-in, reset and invitation endpoints.
- Responses never reveal whether an account exists.
- TOTP multi-factor authentication, enforceable per organization.
- Deactivation and password change revoke existing sessions.

### Authorization
- Deny by default: a route without a declared permission or explicit public marker fails the build.
- Permission and scope checked on the server for every request. UI visibility is a convenience only.
- Object-level checks on every access by ID.
- Privilege changes are audited, and a user cannot grant what they do not hold.

### Tenant isolation
- Tenant ID taken only from the session.
- PostgreSQL row-level security on every tenant table; application role cannot bypass it.
- Cross-tenant requests return 404.
- Background jobs, exports, file access, caches and search carry and enforce the tenant ID. Cache keys include it.

### Input and output
- Schema validation on all input; unknown fields rejected.
- Parameterized queries only. Raw SQL needs review.
- Responses serialized through a schema, so internal fields cannot leak.
- Output encoding by React defaults; `dangerouslySetInnerHTML` is banned by lint unless sanitized and reviewed.
- Security headers: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors.

### Files
- Private buckets; short-lived presigned URLs issued after a permission check.
- Server-side validation of type (by content, not extension) and size.
- Stored under generated keys; user-supplied names never used as paths.
- Malware scan before a file becomes downloadable (required before production).
- Downloads served with `Content-Disposition: attachment` from a separate origin.

### Secrets and configuration
- Secrets from environment or a secret manager; configuration validated at start-up, and the process refuses to start if anything is missing.
- `.env` files are git-ignored; only `.env.example` with placeholder values is committed.
- Secret scanning runs in CI and as a pre-commit hook.

### Supply chain
- Lockfile committed; installs use the frozen lockfile.
- Dependency vulnerability scan in CI; high and critical findings block release.
- Container images built from pinned minimal bases, run as non-root, and are scanned.

### Logging and audit
- Security events logged: sign-in success and failure, token reuse, permission denials, role changes, exports.
- No passwords, tokens or document contents in logs.
- Audit events are append-only.

### Data protection
- TLS in transit everywhere; encryption at rest for database and object storage.
- Data inventory of personal-data columns maintained in [DATABASE.md](DATABASE.md).
- Retention and deletion rules defined per data class once compliance scope is confirmed (PRD Q5).

## 3. Process

- Each phase includes a threat review at ARCHITECT and a security review at REVIEW.
- Security approval from the Security Lead is a release criterion.
- Security checks are never disabled and authentication is never weakened to make a test or a deadline pass.
- An independent penetration test is required before the first production release with real customer data.

## 4. Reporting a vulnerability

Process and contact to be defined before any external deployment.
