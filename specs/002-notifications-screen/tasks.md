---
description: 'Task list for Issue #513 Notifications screen'
---

# Tasks: Notifications screen

**Input**: Design documents from `/specs/002-notifications-screen/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Included because Issue #513 explicitly requires route/list, rendered-read, accessibility, and E2E verification.

**Organization**: Tasks are grouped by user story; existing #512 data/action boundaries are consumed rather than changed.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the standard route/test locations; no dependency or schema setup is needed.

- [x] T001 Verify the existing `(app)` route group, typed Notification read/action boundaries, shared UI primitives, and Tokyo formatter in `apps/web/src/` and `packages/ui/src/`

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Reuse current authenticated routing, read classification, and design-system contracts without adding new infrastructure.

- [x] T002 Confirm no new migration, read RPC, global store, generic renderer, or AppBar change is required for `apps/web/src/app/(app)/notifications/`

**Checkpoint**: Existing #498/#512 foundations are ready; implementation can proceed.

## Phase 3: User Story 1 - Review received notices (Priority: P1) 🎯 MVP

**Goal**: Provide the authenticated `/notifications` page with heading, bounded newest-first invitation rows, timestamp, privacy-safe copy, and accessible unread presentation.

**Independent Test**: Mock a populated and empty `listMyNotifications` result, render the route, and verify exact copy/order/timestamps, recipient-safe fields, canonical empty StatePanel, and heading parity.

### Tests for User Story 1

- [x] T003 [P] [US1] Add populated/empty/list-error/auth-state route tests for exact heading, StatePanel copy, and read classification in `apps/web/src/app/(app)/notifications/page.test.tsx`
- [x] T004 [P] [US1] Add populated-row, newest-first supplied order, Tokyo timestamp, neutral unread cue, no source snapshot fields, list semantics, and keyboard accessibility tests in `apps/web/src/app/(app)/notifications/_components/NotificationsList.test.tsx`

### Implementation for User Story 1

- [x] T005 [US1] Implement authenticated page read/classification and exact populated/empty/error/unavailable rendering in `apps/web/src/app/(app)/notifications/page.tsx` using `listMyNotifications`, `requireAuthenticatedUserId`, `PageHeading`, `StatePanel`, and `READ_FAILURE_RETRY_HINT_JA`
- [x] T006 [US1] Implement the MVP invitation row presentation with exact copy, `formatTokyoDateTimeJa`, list semantics, and non-destructive accessible unread cue in `apps/web/src/app/(app)/notifications/_components/NotificationsList.tsx`
- [x] T007 [P] [US1] Implement heading-parity bounded loading presentation in `apps/web/src/app/(app)/notifications/loading.tsx` using `PageHeading` and existing loading conventions

**Checkpoint**: Populated, empty, unavailable, error, and loading route states are independently demonstrable.

## Phase 4: User Story 2 - Follow an available source safely (Priority: P1)

**Goal**: Navigate only active invitation sources to `/catalog/invitations`; render resolved/unavailable source fallback without action.

**Independent Test**: Render active and resolved source rows and verify one accessible link with the exact destination versus no link/action for the resolved row; verify source-resolution failure is a screen error.

### Tests for User Story 2

- [x] T008 [US2] Extend `apps/web/src/app/(app)/notifications/page.test.tsx` with source-resolution failure classification and resolved-row fallback/no-navigation assertions
- [x] T009 [US2] Extend `apps/web/src/app/(app)/notifications/_components/NotificationsList.test.tsx` with active source link, resolved exact fallback, no accept/decline controls, and no nested interactive control assertions

### Implementation for User Story 2

- [x] T010 [US2] Add active-source navigation and resolved/unavailable fallback branching to `apps/web/src/app/(app)/notifications/_components/NotificationsList.tsx` without duplicating Invitation actions or source queries

**Checkpoint**: Active and resolved rows preserve source-domain ownership and distinguish source absence from source read failure.

## Phase 5: User Story 3 - Read only what was rendered (Priority: P1)

**Goal**: Trigger the existing bounded read action after render with exact rendered snapshot IDs, converge locally only after success, and keep failed rows unread with retry feedback.

**Independent Test**: Control the server action mock and client effect, assert exact ID payload/order and post-render invocation, repeat safely, and verify failure retains unread semantics and exposes retry.

### Tests for User Story 3

- [x] T011 [US3] Add controlled rendered-snapshot tests for exact IDs, no snapshot-after IDs, duplicate effect safety, already-read/resolved-row inclusion, successful local read convergence, and failed-write retry/unread retention in `apps/web/src/app/(app)/notifications/_components/NotificationsList.test.tsx`

### Implementation for User Story 3

- [x] T012 [US3] Add the minimal client effect/action boundary to `apps/web/src/app/(app)/notifications/_components/NotificationsList.tsx`, passing only rendered row IDs to `markNotificationsReadAction` after render and retaining a retryable StatePanel error on failure

**Checkpoint**: Read transitions are exact, post-render, idempotent, and never optimistic on failure.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the complete vertical slice, finalize current product authority, and record the canary observation.

- [x] T013 [P] Add a focused authenticated Notifications user journey (reach `/notifications`, verify invitation title, follow active source to `/catalog/invitations`) in `apps/web/e2e/journeys/notifications.spec.ts` following existing E2E fixture/sign-in patterns
- [x] T014 Run focused web tests, accessibility assertions, typecheck, lint, format, and `git diff --check`; update implementation tests/paths in `apps/web/src/app/(app)/notifications/` as required by the results
- [x] T015 Run `pnpm run verify` where available and validate `quickstart.md`; record environment-only limitations without changing repository contracts in `specs/002-notifications-screen/quickstart.md`
- [x] T016 Finalize `specs/002-notifications-screen/spec.md` as `Status: Current behavior contract`, review the current/future fence, and keep only behavior landed by Issue #513
- [ ] T017 Record the concrete Spec Kit normal-feature/NEW TOPIC canary observation for Issue #513 in GitHub Issue #509, including friction, authority handoff, reusable boundaries, post-PR convergence, and why no Foundation mechanism was added

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 and Phase 2 are complete confirmations of existing infrastructure and block no code changes.
- Phase 3 tests (T003/T004) precede Phase 3 implementation (T005–T007).
- Phase 4 depends on the row/page types from Phase 3; tests precede T010.
- Phase 5 depends on the rendered row shape from Phase 3/4; T011 precedes T012.
- Phase 6 depends on the completed vertical slice; PR/post-PR convergence follows the repository runbook after the implementation commit and PR creation.

### User Story Dependencies

- US1 is the MVP and establishes the route/list shape.
- US2 depends on US1's row view model but adds only source-state presentation.
- US3 depends on US1/US2's rendered row list and uses the existing #512 action.

### Parallel Opportunities

- T003 and T004 can run in parallel because they initially target separate test files.
- T007 can run in parallel with T005/T006 after test expectations are recorded.
- T008 and T009 can run in parallel after the initial row/page types exist.
- T013 is independent of local unit/component test implementation and can be developed alongside polish.

## Parallel Example: User Story 1

```text
T003: route state tests in page.test.tsx
T004: row/accessibility tests in NotificationsList.test.tsx
T007: loading.tsx presentation
```

## Implementation Strategy

1. Preserve the current #512 data/action boundaries and validate the route/list contract.
2. Deliver US1 as the MVP vertical slice, then add source-state navigation and post-render read behavior.
3. Run focused verification before full repository verification.
4. Finalize the Notifications Living Spec only after behavior and tests are green.
5. Create one PR for Issue #513, then continue through `docs/runbooks/post-pr-convergence.md` to `MERGE_READY`; do not merge or close the Issue.

## Notes

- Every implementation task names its exact repository path.
- No task adds AppBar work for #514, future Notification kinds, pagination, a generic renderer, a new DB migration/RPC, or a client cache.
