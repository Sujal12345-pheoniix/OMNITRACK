# Risk Register

Owner: CTO · Status: v0.1 (2026-11-16) · Reviewed at the close of every phase

Likelihood and impact: Low, Medium, High.

| ID | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-01 | Cross-tenant data exposure | M | H | Two-layer isolation (application + RLS); isolation suite over every route; RLS-coverage check in CI | Security Lead | Open — controls designed, not built |
| R-02 | Scope is very large (15 modules) and delivery stalls before anything is usable | H | H | Strict phase order; each phase delivers a verified, usable slice; sponsor fixes module priority (Q4) | CPO | Open |
| R-03 | Requirements come from a brief, not from users; we build the wrong workflows | H | H | SPECIFY step per phase with real stakeholder input; PRD marked unconfirmed until reviewed | CPO | Open |
| R-04 | Hosting and compliance undecided; late decisions force rework | M | H | Keep infrastructure portable (containers, S3 API, standard PostgreSQL); get Q2 and Q5 answered before Phase 2 closes | DevOps Lead | Open |
| R-05 | Work reported as done without verification | M | H | Exit criteria per phase; test report records actual commands and output; QA independent of implementers | QA Director | Open |
| R-06 | Hand-built authentication contains a flaw | M | H | Follow ASVS L2; use vetted libraries for hashing, tokens and TOTP; dedicated security review; pen test before production | Security Lead | Open |
| R-07 | RLS with connection pooling leaks tenant context between requests | M | H | Set context with `SET LOCAL` inside a transaction only; integration test that interleaves tenants on one connection | Database Architect | Open |
| R-08 | Modular monolith boundaries erode into a tangled codebase | M | M | Import-boundary lint rule in CI; module template; review checklist | CTO | Open |
| R-09 | Personal data of employees and candidates mishandled | M | H | Data inventory; least-privilege permissions; retention rules once Q5 is answered; no production data outside production | Security Lead | Open |
| R-10 | Uploaded files carry malware or are served unsafely | M | H | Content-type validation, private buckets, scan before availability, separate download origin | Security Lead | Open |
| R-11 | Reports show numbers that do not match source records | M | H | One written definition per metric; tests against known data; reports read the same tables as the application | Database Architect | Open |
| R-12 | AI assistant leaks data across permissions or tenants, or is manipulated by injected content | M | H | Assistant acts only through the user's authorized service layer; no direct database access; injection tests | AI Director | Open — Phase 8 |
| R-13 | Parallel AI agents edit the same files and produce conflicting or unreviewed changes | M | M | One owner per file set per task; separate worktrees; all output inspected before it is recorded as done | AI Director | Open |
| R-14 | No version-control remote or CI yet; work exists on one machine only | H | M | Initialize git now; sponsor provides remote (Q7); CI in Phase 1 | DevOps Lead | Open |
| R-15 | Dependency vulnerability or malicious package | M | H | Frozen lockfile, automated scanning, minimal dependencies, pinned base images | Security Lead | Open |
| R-16 | Performance targets unvalidated until late | M | M | Reference-load test from Phase 2 onward on list and auth endpoints, not only in Phase 9 | Performance Engineer | Open |
