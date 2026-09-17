# Implementation Plan: Notifications screen

**Branch**: `codex/issue-513-notifications-screen` | **Date**: 2026-09-17 | **Spec**: [spec.md](spec.md)

**Input**: GitHub Issue #513 and the draft feature specification in this directory.

## Summary

Implement the authenticated `/notifications` route as the first user-visible
Notifications surface. The route will consume the existing #512
`listMyNotifications` read boundary, use shared `PageHeading` and `StatePanel`
semantics, render a minimal invitation row with Tokyo-local timestamp and a
non-destructive unread cue, and navigate only active sources to the existing
`/catalog/invitations` authority. A small client boundary will submit only the
server-rendered row IDs to #512's existing `markNotificationsReadAction` after
the rows have rendered, retaining unread presentation and retry feedback when
the write fails. No new persistence, query, action, cache, or generic renderer
is needed.

## Technical Context

**Language/Version**: TypeScript 5, React 19, Next.js App Router (Node 24 in CI)

**Primary Dependencies**: Next.js, `next-safe-action`, `@supabase/supabase-js`,
`@stage-tracker/domain`, `@stage-tracker/ui`, Zod, Vitest, Testing Library,
Playwright

**Storage**: Existing Supabase/PostgreSQL `notifications` and
`occurrence_invitations` tables through the typed #512 read boundary; no schema
change

**Testing**: Vitest unit/component tests, existing route-level async component
tests, Playwright E2E journey, repository `pnpm run verify` and CI lanes

**Target Platform**: Authenticated responsive web application at `/notifications`

**Project Type**: Next.js web application in `apps/web`, with shared UI and
domain packages

**Performance Goals**: Use the existing explicit first window of 50 rows and one
batched source-resolution read; do not add paging or unbounded reads

**Constraints**: Preserve recipient-only RLS, stable newest-first ordering,
Tokyo timezone formatting, StatePanel/PageHeading ownership, exact rendered-ID
read semantics, and the #514 AppBar contract without touching AppBar code

**Scale/Scope**: One MVP kind (`invitation_received`), one authenticated route,
one bounded first window, active/resolved/error/empty/loading states, and no
future-kind framework

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- Living Spec authority: PASS. The draft is scoped to this feature and will be
  finalized only after implementation and verification; Issue #513 remains the
  change contract during the work.
- Artifact boundaries: PASS. Product behavior stays in `spec.md`, structure in
  this plan, mechanical guarantees in tests/CI, and procedure in the runbook.
- Standard-first: PASS. The standard Spec Kit flow is used; no Foundation
  overlay, compatibility layer, or custom authority router is introduced.
- Deterministic safety: PASS. Existing typed reads, RLS, bounded action, exact
  ID input, and tests enforce the safety-sensitive boundaries.
- Bounded ownership: PASS. The route and feature-local client presentation are
  the smallest additions needed; existing shared primitives and data/actions are
  reused.

## Phase 0: Research decisions

See [research.md](research.md). All implementation unknowns were resolved by
inspection of the current route, UI, data, action, date formatting, and test
patterns.

## Phase 1: Design

See [data-model.md](data-model.md) for the existing Notification/source view
shape and [quickstart.md](quickstart.md) for validation scenarios. No external
interface contract is added: this is an internal page consuming existing
application boundaries.

## Project Structure

```text
apps/web/src/app/(app)/notifications/
├── page.tsx                         # authenticated server route and read-state projection
├── loading.tsx                      # heading-parity bounded loading state
└── _components/
    ├── NotificationsList.tsx        # rendered rows and post-render read boundary
    └── NotificationsList.test.tsx   # row, navigation, unread, and read UX
apps/web/src/app/(app)/notifications.test.tsx # route state coverage
specs/002-notifications-screen/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md
```

Existing files consumed without duplicate implementation:

- `apps/web/src/lib/data/reads/notifications.ts`
- `apps/web/src/lib/actions/notifications.ts`
- `apps/web/src/lib/actions/notification.ts`
- `apps/web/src/app/_lib/format.ts`
- `apps/web/src/app/_lib/read-state.ts`
- `packages/ui/src/page-heading.tsx`
- `packages/ui/src/state-panel.tsx`
- `packages/ui/src/list-row.tsx`

**Structure Decision**: Keep route ownership under the existing `(app)` route
group so `/notifications` receives the authenticated AppShell and default-deny
proxy behavior. Keep data and action boundaries in their current locations. Add
only route-local presentation and tests because the MVP has one kind and does
not justify a shared notification renderer.

## Complexity Tracking

No constitution violations. No complexity exception is required.

## Post-implementation authority cutover

After implementation, targeted tests, local verification, E2E/CI evidence, and
review establish the behavior, update `spec.md` to `Status: Current behavior
contract`. The finalized spec will record only the landed Invitation inbox
behavior and explicitly fence AppBar #514, Push, future kinds, pagination,
preferences, and other deferred work from current behavior.
