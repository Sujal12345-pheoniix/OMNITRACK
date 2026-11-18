# Runbook

Owner: Site Reliability Engineer · Status: Placeholder (2026-11-16)

There is no running system, so there are no operating procedures yet. Writing them now would be fiction. Each procedure below is written and rehearsed when the thing it operates exists.

| Procedure | Written in | Rehearsal required before release |
|---|---|---|
| Start the local environment | Phase 1 | — |
| Deploy and roll back | Phase 1 (staging), Phase 9 (production) | Yes |
| Run and verify a migration | Phase 1 | Yes |
| Restore the database from backup | Phase 9 | Yes |
| Revoke all sessions for a user or an organization | Phase 2 | Yes |
| Rotate secrets and signing keys | Phase 2 | Yes |
| Respond to a suspected cross-tenant exposure | Phase 2 | Tabletop exercise |
| Drain and replay the dead-letter queue | Phase 4 | Yes |
| Incident response, severity levels and communication | Phase 9 | Tabletop exercise |

## Format for each procedure

When, preconditions, exact steps, how to verify success, how to undo, who to tell.
