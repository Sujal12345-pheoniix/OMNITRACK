# Design System

Owner: Design Director · Status: Draft v0.1 (2026-11-16) · Principles only. Tokens and components are built in Phase 3.

## 1. Foundations

- Component base: shadcn/ui on Radix primitives, styled with Tailwind CSS.
- Design tokens are CSS variables (colour, spacing, radius, typography, elevation, motion) consumed through the Tailwind theme. Components never use raw colour values.
- Light and dark themes from the start.
- Brand identity (logo, palette, typeface) is **not yet defined** and needs Design Director and sponsor input before Phase 3.

## 2. Experience principles

1. **One way to do each thing.** A list, a detail page, a form and a confirmation look and behave the same in every module.
2. **The workflow is the interface.** Show the record's current state and the next valid actions, not a generic edit form.
3. **Every state is designed.** Loading, empty, error, partial permission and success are specified for every screen.
4. **Nothing is lost silently.** Destructive actions confirm; long forms protect unsaved changes; failures say what happened and what to do.
5. **Density for daily users.** Staff use this all day; favour scannable tables and keyboard operation over decoration.

## 3. Standard patterns (to be specified in Phase 3)

| Pattern | Covers |
|---|---|
| App shell | Navigation, organization context, global search, notifications, user menu |
| Data table | Sort, filter, pagination, column visibility, bulk actions, saved views |
| Record page | Header with status and actions, tabs, activity timeline |
| Form | Validation messages, required markers, async submit, unsaved-changes guard |
| Pipeline board | Stages, drag and drop with keyboard alternative (leads, candidates, tasks) |
| Approval panel | Request summary, history, approve/reject with comment |
| Feedback | Toasts, inline errors, confirmation dialogs, empty states |

## 4. Accessibility

WCAG 2.2 AA is a requirement, not a goal.

- Colour contrast at least 4.5:1 for text and 3:1 for interface components.
- Everything operable by keyboard with a visible focus indicator.
- Semantic HTML first; ARIA only where needed.
- Form fields have programmatic labels and errors linked to their field.
- Motion respects `prefers-reduced-motion`.
- Automated axe checks in CI plus a manual keyboard and screen-reader pass per phase.

## 5. Responsive

Breakpoints at 360, 768, 1024 and 1440 px. Tables collapse to cards or scroll horizontally with a fixed first column on small screens. The candidate portal is designed mobile-first.

## 6. Content

Plain language, sentence case, consistent terms across modules (a glossary is added in Phase 3). Dates, numbers and currency are formatted for the user's locale.
