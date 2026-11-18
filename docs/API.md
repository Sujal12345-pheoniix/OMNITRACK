# API

Owner: API and Integration Engineer · Status: Draft v0.1 (2026-11-16) · No endpoints exist yet.

The OpenAPI document generated from the code is the reference for individual endpoints once they exist. This file holds the rules every endpoint follows.

## 1. Style

- REST over HTTPS, JSON bodies, base path `/api/v1`.
- Resource names are plural nouns in kebab-case: `/api/v1/employees/{id}`.
- Workflow transitions are explicit sub-resources, not field patches: `POST /api/v1/leads/{id}/qualify`.
- Request and response field names are `camelCase`.
- Timestamps are ISO 8601 in UTC. IDs are UUID strings.

## 2. Contracts

Request and response shapes are Zod schemas in `packages/contracts`, used by the API for validation and serialization and by the web app for forms and types (ADR-006). The OpenAPI document is generated from these schemas and published at `/api/docs` in non-production environments. CI fails if the committed OpenAPI snapshot differs from the generated one, which makes every contract change visible in review.

## 3. Authentication

Cookie-based session (see [SECURITY.md](SECURITY.md)). State-changing requests require a CSRF token header. The organization is derived from the session; it is never accepted as a request parameter.

## 4. Errors

One format for every error, following RFC 9457 problem details:

```json
{
  "type": "https://omnitrack.dev/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "requestId": "…",
  "errors": [{ "path": "email", "message": "Must be a valid email address" }]
}
```

| Status | Used for |
|---|---|
| 400 | Malformed request |
| 401 | Not authenticated |
| 403 | Authenticated, but lacks the permission for an action on a resource the user can see |
| 404 | Resource does not exist or belongs to another organization (never reveals which) |
| 409 | Conflict, including stale `version` on update |
| 422 | Validation or business-rule failure |
| 429 | Rate limited |
| 500 | Unexpected error; no internal detail in the body |

## 5. Lists

- Cursor pagination: `?limit=50&cursor=…`; default 50, maximum 200. Response: `{ "items": [...], "nextCursor": "…" | null }`.
- Filtering and sorting only on documented, indexed fields.

## 6. Writes

- `POST` endpoints that create resources or trigger side effects accept an `Idempotency-Key` header.
- Updates to concurrently edited resources require the current `version` and return 409 when stale.

## 7. Versioning and change control

- Additive changes (new optional fields, new endpoints) are allowed within `v1`.
- Removing or renaming a field, changing a type, or tightening validation is a breaking change. It needs an ADR, a deprecation period and a new version. Breaking changes are never introduced silently.

## 8. Rate limiting

Per user and per IP, stricter on authentication endpoints. Limits are returned in standard `RateLimit-*` headers.
