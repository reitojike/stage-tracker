# Feature Specification: Occurrence Participation Current Behavior

**Feature Branch**: `001-occurrence-participation`

**Created**: 2026-09-15

**Status**: Current behavior contract

**Input**: GitHub Issue #487 and the current implementation, schema, and tests

## Authority Boundary

This document is the current product behavior authority for Occurrence Participation.
GitHub Issue #487 is the implementation contract for this initial authority cutover.
Architecture documents, database migrations, schema, and tests retain their respective
structural and mechanical responsibilities; they are not duplicated here.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Choose participation for an occurrence (Priority: P1)

As an authenticated user, I want to record whether I am interested in or attending a
specific occurrence so that my plans are represented without creating an event-level
participation object.

**Why this priority**: Participation is defined for each occurrence and is the primary
planning interaction.

**Independent Test**: Starting with no participation for an occurrence, a user can
choose either available status, see the selected status, change it, and withdraw it.

**Acceptance Scenarios**:

1. **Given** no participation exists, **when** the user chooses `considering`, **then**
   the occurrence shows `considering` for that user.
2. **Given** no participation exists, **when** the user chooses `attending`, **then**
   the occurrence shows `attending` for that user.
3. **Given** an existing participation, **when** the user chooses the other persisted
   status, **then** the status changes to that status.
4. **Given** an existing participation, **when** the user chooses the same status,
   **then** the result is a semantic no-op.
5. **Given** an existing participation, **when** the user chooses to withdraw, **then**
   the participation becomes absent and is no longer shown as a status.

---

### User Story 2 - Understand participation and cancellation state (Priority: P1)

As an authenticated user, I want the event detail screen to distinguish my current
participation from missing or failed data, and to retain valid corrections when an event
or occurrence is canceled.

**Why this priority**: A canceled occurrence must not create misleading new commitments,
but users must still be able to weaken or withdraw an existing commitment.

**Independent Test**: Exercise each status transition while the parent event, the
occurrence, or neither is canceled, and compare absence with a read failure.

**Acceptance Scenarios**:

1. **Given** an event or occurrence is effectively canceled, **when** a user without a
   participation chooses either persisted status, **then** the new participation is
   rejected.
2. **Given** an effectively canceled occurrence with `considering`, **when** the user
   chooses `attending`, **then** the transition is rejected.
3. **Given** an effectively canceled occurrence with `attending`, **when** the user
   chooses `considering`, **then** the transition remains available and succeeds.
4. **Given** an effectively canceled occurrence with an existing participation, **when**
   the user withdraws, **then** withdrawal remains available and succeeds.
5. **Given** an effectively canceled occurrence, **when** the user performs a same-status
   or visibility-only update allowed by the current behavior, **then** the existing
   participation is not rewritten or removed.
6. **Given** a participation read fails, **when** the event detail renders, **then** the
   UI presents a read failure rather than treating the participation as absent.
7. **Given** an event or occurrence is canceled, **when** the detail view renders, **then**
   it displays the canceled state while keeping valid downgrade and withdrawal paths
   reachable.

---

### User Story 3 - Respond to invitations and view personal calendar state (Priority: P2)

As an authenticated user, I want invitation responses and my calendar view to converge
on the same participation meaning without exposing another user's private state.

**Why this priority**: Invitations coordinate attendance, while the calendar is a key
place to consume the user's own participation state.

**Independent Test**: Receive, decline, and accept a pending invitation, then inspect the
event detail and the user's calendar independently of personal schedule entries.

**Acceptance Scenarios**:

1. **Given** a pending invitation is received, **when** the user has not yet responded,
   **then** no participation is created solely because the invitation exists.
2. **Given** a pending invitation and an existing `considering` participation, **when**
   the user declines, **then** the invitation is resolved and the existing
   `considering` intention is unchanged.
3. **Given** a pending invitation, **when** the user accepts, **then** the result is the
   same `attending` transition available through the normal participation interaction.
4. **Given** one or more pending invitations for an occurrence, **when** the invitee
   reaches `attending` through any supported path, **then** all pending invitations for
   that occurrence and invitee are resolved.
5. **Given** the user's own participation exists for an occurrence, **when** the user
   opens My Calendar, **then** that occurrence is represented from Participation and not
   from Personal Schedule.
6. **Given** no participation exists for an occurrence, **when** My Calendar renders,
   **then** it does not create a Participation calendar item.

### Edge Cases

The following boundaries are intentionally explicit:

- A canceled event and a canceled occurrence both make a new Participation invalid.
- A read failure is not the same state as an absent Participation.
- An invitation response does not create a `not_attending` status.
- A user can withdraw an existing Participation even while it is effectively canceled.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Participation MUST be scoped to exactly one occurrence and one
  authenticated user.
- **FR-002**: The product MUST NOT provide an event-level Participation object.
- **FR-003**: The only persistable statuses MUST be `considering` and `attending`.
- **FR-004**: `not_attending` MUST NOT be represented as a persisted Participation
  status.
- **FR-005**: Absence of a Participation MUST mean that the user is not participating;
  it MUST NOT be displayed as a third persisted status.

### Lifecycle Requirements

- **FR-006**: A user MUST be able to create either persistable status when no
  Participation exists and the occurrence is not effectively canceled.
- **FR-007**: A user MUST be able to update their own existing status when the transition
  is allowed by the current cancellation rules.
- **FR-008**: Selecting the already persisted status MUST be a semantic no-op.
- **FR-009**: A user MUST be able to withdraw their own Participation, including while
  the occurrence is effectively canceled.
- **FR-010**: Withdrawal MUST result in absence and MUST NOT create `not_attending`.
- **FR-011**: Existing Participation MUST NOT be automatically deleted or rewritten when
  the event or occurrence becomes canceled.

### Cancellation Requirements

- **FR-012**: Effective cancellation MUST apply when the parent event is canceled, when
  the occurrence is canceled, or when both are canceled.
- **FR-013**: Effective cancellation MUST reject creation of a new Participation for
  either persistable status.
- **FR-014**: Effective cancellation MUST reject `considering → attending`.
- **FR-015**: Effective cancellation MUST continue to allow `attending → considering`
  and withdrawal.
- **FR-016**: The UI MUST show the canceled state without hiding the valid downgrade and
  withdrawal actions.

### Invitation Requirements

- **FR-017**: Receiving an invitation MUST NOT create or change Participation by itself.
- **FR-018**: Declining an invitation MUST resolve the invitation without creating
  `not_attending`.
- **FR-019**: Declining an invitation MUST NOT change a separate existing `considering`
  Participation.
- **FR-020**: Accepting an invitation MUST converge on `attending` without a distinct
  persisted invitation-origin status.
- **FR-021**: Reaching `attending` through any supported path MUST resolve all pending
  invitations for the same occurrence and invitee.

### Visibility and Ownership Requirements

- **FR-022**: Participation visibility MUST default to private.
- **FR-023**: Private Participation MUST be readable only by its owner.
- **FR-024**: Public Participation MUST be readable by authenticated users and MUST NOT
  be readable by anonymous users.
- **FR-025**: Only the Participation owner MUST be able to create, update, or withdraw
  that Participation.
- **FR-026**: Event ownership MUST NOT grant access to another user's private
  Participation.
- **FR-027**: The current first-party UI MUST NOT expose a public participant browse or
  Participation visibility toggle.
- **FR-028**: The data-access capability for public Participation and the UI capability
  for browsing or changing visibility MUST remain separate concepts.

### Presentation Requirements

- **FR-029**: Event detail MUST label `attending` as 「参加する」 and `considering` as
  「気になる」.
- **FR-030**: Event detail MUST label withdrawal of an existing Participation as
  「参加をやめる」.
- **FR-031**: Absence MUST be distinguishable from a Participation read failure.
- **FR-032**: My Calendar MUST show only the caller's Participation-derived occurrence
  items and MUST keep Personal Schedule as a separate source.
- **FR-033**: An absent Participation MUST NOT create a Participation calendar item.
- **FR-034**: The current immediate-choice Participation interaction reflects a successful
  choice and closes its Sheet without a standalone success notification. This records the
  current runtime behavior for this authority cutover; it does not relax the global
  success-notice requirement, and a follow-up UI task is required to restore conformity.

### Key Entities

- **Occurrence Participation**: A user's current participation state for one occurrence,
  with either `considering`, `attending`, or no record.
- **Pending Invitation**: A temporary invitation awaiting a response; it does not itself
  represent Participation and is resolved when declined or when the invitee reaches
  `attending`.
- **Event / Occurrence**: The event catalog object and its specific scheduled occurrence;
  cancellation may exist independently at either level.

## Scope Boundaries

- This specification covers current Occurrence Participation behavior and its direct
  invitation, cancellation, presentation, and calendar boundaries.
- It does not define ticket planning, Personal Schedule semantics, event creation,
  moderation, public participant discovery UX, or future participation statuses.
- Mechanical database enforcement and regression-test implementation remain in the
  current migrations, schema, tests, and CI rather than in this document.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every lifecycle scenario in User Story 1 has one observable result for
  create, update, no-op, and withdrawal.
- **SC-002**: Every cancellation transition in User Story 2 has an unambiguous allowed
  or rejected outcome, with no automatic deletion or rewrite of an existing
  Participation.
- **SC-003**: Invitation receive, decline, accept, and attending convergence produce the
  same user-visible Participation meaning regardless of the entry path.
- **SC-004**: Private, public, and anonymous visibility outcomes are distinguishable in
  access scenarios, while the absence of a first-party public browse/toggle UI remains
  explicit.
- **SC-005**: Event detail and My Calendar consistently distinguish absent data from
  failed reads and keep Participation separate from Personal Schedule.

## Assumptions

- Users have authenticated accounts and an occurrence belongs to an existing event.
- The current product does not offer offline Participation mutation.
- A Participation record represents current state only; it does not retain accepted or
  declined invitation history.
- Product date/time display follows the repository's existing Asia/Tokyo behavior.
