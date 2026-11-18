# Deployment

Owner: DevOps Architect · Status: Draft v0.1 (2026-11-16) · No environment exists. Hosting target is undecided (PRD Q2).

## 1. Decided

- Everything runs in containers. The same image is promoted through environments; only configuration differs.
- Local development uses Docker Compose for PostgreSQL, Redis, MinIO and a mail catcher. The API and web app run on the host for fast reload.
- Environments: `local`, `ci`, `staging`, `production`. Staging mirrors production topology.
- Infrastructure is defined as code and reviewed like application code.
- Database migrations run as a separate, explicit deployment step using the migrator role, before the new application version starts.
- Deployments are zero-downtime rolling updates, relying on backward-compatible migrations.
- Rollback redeploys the previous image. Schema is rolled forward, not back.
- Production deploys and any destructive production operation need explicit human approval.

## 2. Pipeline (to be built in Phase 1)

1. Install with frozen lockfile.
2. Lint, type check, unit tests.
3. Integration tests against containers.
4. Build; contract snapshot check.
5. Security scans: dependencies, secrets, static analysis, container image.
6. End-to-end smoke and accessibility checks.
7. Publish image tagged with the commit SHA.
8. Deploy to staging automatically; production on approval.

Assumes GitHub Actions (PRD Q7).

## 3. Not yet decided

| Topic | Depends on |
|---|---|
| Cloud provider, region, managed services | PRD Q2 |
| Container platform (managed containers vs Kubernetes) | Cloud choice, expected scale |
| Secret manager | Cloud choice |
| Observability stack | Cloud choice, budget |
| Backup mechanism and schedule | Cloud choice |
| Domain, TLS, CDN and WAF | Cloud choice |

The default recommendation, absent other constraints, is a managed container service with managed PostgreSQL and Redis rather than self-operated Kubernetes: lower operational burden for a small team.

## 4. Local prerequisites

Node.js 20 LTS, pnpm (via Corepack), Docker, Git. As of 2026-11-16 the development machine has Node 20.18, npm 10.8, Git 2.56 and Docker 29.9; pnpm is not yet enabled.
