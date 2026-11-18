# Release Readiness

Owner: QA Director · Last updated: 2026-11-16

## Current verdict

**Not releasable. Nothing has been built.**

## Release gate

Every item needs evidence linked from this file. Each sign-off is given by the named role, independently.

| # | Criterion | Sign-off | Status |
|---|---|---|---|
| 1 | All functional requirements in release scope have passing tests (traceability list empty) | QA Director | Not started |
| 2 | Tenant-isolation, authorization-matrix, RLS-coverage and audit-coverage suites pass | QA Director | Not started |
| 3 | No open S1 or S2 defect; S3 defects individually accepted | QA Director | Not started |
| 4 | No open high or critical security finding; dependency, secret, static and image scans clean | Security Lead | Not started |
| 5 | Independent penetration test completed and findings resolved | Security Lead | Not started |
| 6 | Performance targets met under reference load | Performance Engineer | Not started |
| 7 | Accessibility: automated checks pass and manual keyboard and screen-reader pass done | Design Director | Not started |
| 8 | Backup restore rehearsed within recovery objectives | DevOps Lead | Not started |
| 9 | Deploy and rollback rehearsed on staging | DevOps Lead | Not started |
| 10 | Monitoring, alerting and runbooks in place; incident process agreed | SRE | Not started |
| 11 | Migrations reviewed and backward compatible with the previous version | Database Architect | Not started |
| 12 | Documentation and changelog current; no breaking API change without an ADR | CTO | Not started |
| 13 | Product acceptance of the release scope | CPO | Not started |
