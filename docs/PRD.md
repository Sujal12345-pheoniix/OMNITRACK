# Product Requirements Document

Owner: Chief Product Officer · Status: Draft v0.1 (2026-11-16) · Not yet confirmed by the sponsor

This draft is derived from the product brief only. No user research or stakeholder interviews have been done. Items marked **[OPEN]** need a sponsor decision; they are collected in section 8.

## 1. Product

OmniTrack is a multi-tenant platform where an organization runs its people, sales, work and hiring operations in one place, with every critical action recorded and reportable.

Brand promise: *Every Action. Every Record. Every Result.*

## 2. Problem

Organizations run these functions across disconnected tools and spreadsheets. The consequences are duplicate data entry, no single record of who did what, approvals that happen in chat and leave no trail, and reports that nobody trusts because the numbers come from different sources.

## 3. Users

| Persona | Primary goals |
|---|---|
| Organization admin | Set up the org, departments, roles and permissions; control access |
| HR manager | Maintain employee records, run hiring, manage documents |
| Recruiter | Move candidates through a pipeline, schedule and record interviews |
| Sales rep | Capture leads, log activity, move deals forward |
| Sales manager | See the pipeline, assign leads, forecast |
| Team lead / manager | Assign work, review daily activity, approve requests |
| Employee | See own tasks, log daily activity, submit requests |
| Candidate (external) | Apply, upload documents, track application status |
| Executive | Read trustworthy cross-functional reports |

## 4. Principles

1. Real functionality over visual prototypes.
2. Security before convenience.
3. Correct data over impressive dashboards.
4. Business workflows over disconnected CRUD screens.
5. Consistent user experience across modules.
6. Traceability for critical operations.
7. Maintainable architecture over unnecessary complexity.
8. Measurable performance and reliability.
9. Accessibility and responsive design.
10. No production release without verification.

## 5. Scope by module

Each module lists the workflow it must support end to end. A module is not complete if it only offers create/read/update/delete screens.

| # | Module | Core workflow | Phase |
|---|---|---|---|
| M1 | Organization and tenancy | Create org → configure → invite users | 2 |
| M2 | Identity and access | Sign in → session → role-based permissions → sign out / revoke | 2 |
| M3 | Employees | Onboard → maintain record → change role/department → offboard | 3 |
| M4 | Teams and departments | Define structure → assign members and managers | 3 |
| M5 | Tasks and projects | Create → assign → progress → review → close | 4 |
| M6 | Daily activity tracking | Employee logs day → manager reviews | 4 |
| M7 | Approval workflows | Submit → route → approve/reject → record outcome | 4 |
| M8 | Notifications | Event → in-app and email delivery → read state | 4 |
| M9 | Documents | Upload → classify → control access → version → retain | 4 |
| M10 | Sales CRM and leads | Capture → qualify → assign → pipeline stages → won/lost | 5 |
| M11 | Customer tracking | Account and contacts → interaction history | 5 |
| M12 | Recruitment / ATS | Open requisition → source → screen → interview → offer → hire | 6 |
| M13 | Candidate portal | Apply → upload documents → track status | 6 |
| M14 | Reporting and BI | Defined metrics → dashboards → export | 7 |
| M15 | AI assistant | Ask questions and get help, limited to what the user may see | 8 |

Hiring a candidate (M12) must create the employee record (M3) without re-entering data. This is the kind of cross-module workflow the product exists to provide.

## 6. Cross-cutting requirements

- **Tenant isolation**: one organization can never read or change another's data.
- **Audit trail**: who did what to which record, and when, for all critical operations.
- **Permissions**: every action is gated by a permission checked on the server.
- **Accessibility**: WCAG 2.2 AA.
- **Responsive**: usable from 360px wide to desktop.
- **Performance and availability targets**: see [SRS.md](SRS.md).

## 7. Out of scope for now

Payroll, attendance hardware/biometrics, accounting/invoicing, native mobile apps, a marketplace of third-party integrations, and custom report builders. These can be revisited after Phase 7.

## 8. Open questions for the sponsor

| # | Question | Why it matters | Working assumption until answered |
|---|---|---|---|
| Q1 | Is OmniTrack a SaaS product sold to many external organizations, or an internal platform for one company group? | Drives tenancy, billing, onboarding and compliance scope | SaaS, many tenants |
| Q2 | Which cloud and which data-residency region? | Drives infrastructure, cost and legal exposure | Undecided; local Docker only until answered |
| Q3 | Is enterprise SSO (OIDC/SAML) needed for the first release? | Changes the identity design and timeline | Email + password with MFA first; SSO later |
| Q4 | Which module must reach users first after identity? | Sets Phase 3–6 order | People → Work → Sales → Recruitment |
| Q5 | Which compliance regimes apply (for example DPDP, GDPR, SOC 2, ISO 27001)? | Drives retention, consent, audit and hosting | Design for GDPR-style data-subject rights |
| Q6 | Does OmniTrack need to import from or integrate with any existing system? | Migration and integration work is not in the roadmap | None |
| Q7 | Where will the code be hosted and which CI is available? | CI design | GitHub + GitHub Actions |
| Q8 | Languages and locales at launch? | i18n has to be designed in early | English only, but all strings externalizable |
