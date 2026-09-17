# Feature Specification: Notifications screen

**Feature Branch**: `002-notifications-screen`

**Created**: 2026-09-17

**Status**: Current behavior contract

**Input**: GitHub Issue #513, under the final product contract in Issue #231.

## Authority Boundary

This is the bounded current product behavior authority for the Notifications
topic implemented by Issue #513. Issue #513 remains the canonical change intent;
architecture documents, database migrations, tests, CI, and post-PR procedures
retain their own responsibilities and are not duplicated here.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Review received notices (Priority: P1)

As an authenticated user, I want to open an お知らせ screen and review my
received invitation notices in newest-first order so that I can catch up on
important changes without exposing another user's private information.

**Why this priority**: The screen is the first user-visible in-app surface for
the persisted Notification inbox.

**Independent Test**: With a populated recipient-owned inbox, navigate to
`/notifications` and verify the heading, bounded newest-first rows, exact
invitation copy, timestamp, and non-destructive unread distinction.

**Acceptance Scenarios**:

1. **Given** persisted invitation notices for the authenticated recipient,
   **when** the user opens `/notifications`, **then** the page shows `お知らせ`
   and the supplied first window in `created_at` descending order with `id` as
   the deterministic tie-breaker.
2. **Given** an `invitation_received` notice, **when** it is shown, **then** its
   title is exactly `参加への招待が届いています` and its Notification timestamp
   is visible without copying event, occurrence, inviter, or participation details.
3. **Given** a notice with no read timestamp, **when** it is shown, **then** it
   has a visible non-destructive unread cue and an accessible `未読` indication;
   read notices do not use that cue.
4. **Given** notices belonging to another recipient, **when** the user opens the
   screen, **then** those notices are not shown.

---

### User Story 2 - Follow an available source safely (Priority: P1)

As an authenticated user, I want an active invitation notice to lead me to the
existing invitation surface so that invitation response remains owned by the
source domain.

**Why this priority**: Notifications surface changes; they do not become a second
place to perform invitation actions or a history ledger.

**Independent Test**: Render active and unavailable source rows independently and
verify that only the active row exposes keyboard-accessible navigation to
`/catalog/invitations`.

**Acceptance Scenarios**:

1. **Given** an invitation source lookup succeeds and the recipient can see the
   source, **when** the user activates the notice navigation, **then** the app
   navigates to `/catalog/invitations`.
2. **Given** the source lookup succeeds but the invitation is absent or invisible
   to the recipient, **when** the row is shown, **then** it displays exactly
   `この招待はすでに終了しています。` and exposes no action or navigation.
3. **Given** the source lookup itself fails, **when** the page renders, **then**
   the screen shows a read error with retry guidance and does not present the
   resolved-source message as if the source were normally resolved.
4. **Given** an invitation notice, **when** the user reviews the row, **then** no
   accept or decline control is present.

---

### User Story 3 - Read only what was rendered (Priority: P1)

As an authenticated user, I want notices that were actually rendered in my screen
snapshot to become read while newly arriving notices remain unread, so that read
state is accurate across devices and does not silently mark unseen notices.

**Why this priority**: `read_at IS NULL` is the sole unread authority and the
screen must preserve the race-safe bounded transition defined by Issue #512.

**Independent Test**: Supply a controlled rendered snapshot, observe the read
request after rendering, and verify that only its exact IDs are submitted; repeat
execution and a failed write without treating the items as successfully read.

**Acceptance Scenarios**:

1. **Given** a successful list read, **when** the first window is rendered,
   **then** only the exact rendered Notification IDs are passed to the existing
   bounded read operation after render.
2. **Given** a notice arriving after the rendered snapshot was obtained, **when**
   the read operation runs, **then** the new ID is not submitted.
3. **Given** a read operation is invoked more than once for the same snapshot,
   **when** the server handles it, **then** the result remains safe and idempotent.
4. **Given** the read operation fails, **when** the page receives that result,
   **then** the unread cue is not removed as a false success and the user-visible
   failure remains retryable.

### Edge Cases

- A successful list read with zero rows uses the canonical empty state: title
  `お知らせはありません` and description `新しいお知らせが届くとここに表示されます。`.
- A list read failure is an error state, not an empty state; unknown causes use
  `しばらくしてから再度お試しください。` and only a confirmed network cause
  may use the network-specific guidance.
- A source read failure is distinct from a successful source read with no row.
- The bounded first window remains bounded; this feature does not add pagination,
  load more, infinite scroll, filtering, grouping, bulk read, or dismissal.
- Loading presentation keeps the `お知らせ` heading chrome consistent with the
  production page and avoids an unbounded layout shift.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST provide an authenticated `/notifications` route
  using the existing authenticated route ownership.
- **FR-002**: The page MUST use the shared `PageHeading` with the exact heading
  `お知らせ`, including in its loading presentation.
- **FR-003**: The page MUST consume the existing recipient-owned, bounded
  Notification list boundary and preserve newest-first ordering without issuing
  a duplicate direct Notification query in the route.
- **FR-004**: The page MUST render only the MVP `invitation_received` title
  `参加への招待が届いています`, the Notification timestamp, unread/read cue,
  and source navigation state; it MUST NOT copy source-domain details.
- **FR-005**: An active invitation source MUST navigate to
  `/catalog/invitations`; the Notifications page MUST NOT render accept or
  decline controls.
- **FR-006**: A successfully resolved but unavailable source MUST show only
  `この招待はすでに終了しています。` with no action or navigation.
- **FR-007**: A failed Notification list or source-resolution read MUST render
  the appropriate canonical error semantics and MUST NOT be converted to empty
  or resolved fallback.
- **FR-008**: A normal empty list MUST use the shared canonical StatePanel with
  the exact title and description specified above.
- **FR-009**: The only unread authority MUST be the absence of a read timestamp;
  the cue MUST be distinguishable without relying on color alone or a
  destructive/error semantic.
- **FR-010**: After render, the system MUST submit only the exact IDs in the
  rendered snapshot to the existing bounded read action; it MUST not mark all
  unread rows or snapshot-after rows as read.
- **FR-011**: A failed read-state write MUST remain visibly/notionally unread and
  retryable; the UI MUST NOT claim canonical read success before the write
  succeeds.
- **FR-012**: The feature MUST preserve recipient privacy and MUST NOT turn
  Notifications into an Invitation history ledger.
- **FR-013**: Authenticated AppBar actions MUST expose the bell as a
  keyboard-accessible link to `/notifications` regardless of unread state;
  the bell MUST NOT be disabled when the inbox is empty or its unread read
  fails.
- **FR-014**: The authenticated `(app)` layout MUST read the canonical
  boolean unread existence result using the shared server client and pass only
  that presentation boolean to AppShell/AppBar. A failed unread read MUST
  render the bell with no dot and MUST NOT be cached or persisted as a product
  fact.
- **FR-015**: The AppBar unread cue MUST remain a boolean, use the existing
  non-destructive primary semantic, and converge through the existing
  Notifications/read-surface revalidation contract after rendered rows become
  read. No numeric count, global store, polling, or client-side unread cache
  is part of this behavior.

## Scope Boundaries

The current surface includes the authenticated `/notifications` route and its
authenticated AppBar bell entry point, the persisted recipient-owned
`invitation_received` inbox rows, exact unread/read semantics, Notification
timestamps, active Invitation source navigation, resolved/unavailable fallback,
loading, empty, read-error behavior, and the boolean unread projection
described above.

The following are not current behavior of this topic: unread count, direct
accept/decline, other Notification kinds, Push, email, preferences, filters,
grouping, pagination/load-more, mark-all-read, dismiss/delete, or an Invitation
history ledger.

### Key Entities _(include if feature involves data)_

- **Notification**: A persisted recipient-owned record of a surfaced change,
  identified by its kind, source identity, creation timestamp, and nullable read
  timestamp. It is not a copy of source-domain state or an Invitation history.
- **Invitation source**: The soft-referenced pending invitation that may remain
  available for navigation or may be absent/invisible and therefore use the
  generic resolved fallback.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In the populated, empty, loading, and error journeys, 100% of
  screen-level checks show the required heading and state-specific copy.
- **SC-002**: In 100% of controlled rendered-snapshot tests, no ID outside the
  rendered snapshot is submitted to the read operation.
- **SC-003**: In 100% of active-source journey checks, the user can reach
  `/catalog/invitations` by keyboard-accessible navigation, while resolved rows
  expose zero navigation/actions.
- **SC-004**: In 100% of recipient-privacy checks, notices belonging to another
  recipient and source-domain private details are absent from the screen.

## Assumptions

- The existing authenticated route group, Supabase client boundary, Notification
  list/read action, PageHeading, StatePanel, and Tokyo date/time utilities are
  available and remain authoritative.
- The first Notification window is the existing explicit bound of 50 rows; no
  paging UI is needed for this feature.
- MVP contains only `invitation_received`; the AppBar bell is the authenticated
  entry point and its unread cue is boolean-only as described above.
- The app supports mobile and desktop widths through the existing design system;
  no new design-system primitive is required.
