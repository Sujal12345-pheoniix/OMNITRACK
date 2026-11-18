# OmniTrack

Enterprise Operations and Intelligence Platform. *Every Action. Every Record. Every Result.*

**Status: Phase 0 (engineering operating system). No application code exists yet.**

## Where to look

| You want to know | Read |
|---|---|
| What we are building and for whom | [docs/PRD.md](docs/PRD.md) |
| The order we build it in | [docs/ROADMAP.md](docs/ROADMAP.md) |
| How the system is structured | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Why a technical choice was made | [docs/DECISIONS.md](docs/DECISIONS.md) |
| What is actually built and verified | [engineering/IMPLEMENTATION_STATUS.md](engineering/IMPLEMENTATION_STATUS.md) |
| What to work on next | [engineering/TASK_BOARD.md](engineering/TASK_BOARD.md) |
| What could go wrong | [docs/RISK_REGISTER.md](docs/RISK_REGISTER.md) |

## Rules that apply to every change

1. Nothing is "done" until its acceptance criteria are verified and the result is recorded in [engineering/TEST_REPORT.md](engineering/TEST_REPORT.md).
2. Authorization and tenant isolation are enforced on the server, never only in the UI.
3. Consequential technical choices get an ADR in [docs/DECISIONS.md](docs/DECISIONS.md) before the code is merged.
4. Migrations are append-only. A merged migration is never edited.
5. No secrets, credentials or real customer data in the repository.
