# Feature Specification: TicketOpportunity Timeline Current Behavior

**Feature Branch**: `003-ticket-opportunity-timeline`

**Created**: 2026-09-18

**Status**: Current behavior contract

**Input**: Current TicketOpportunity timeline behavior and the settled product
decision that a window belongs to the month of its deadline.

## Authority Boundary

This document is the current product behavior authority for the TicketOpportunity
timeline. It describes only what users should see and how milestone dates are
understood. Architecture documents, data schemas, implementation, tests, and CI
retain their respective responsibilities and are not duplicated here.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Understand when a ticket opportunity matters (Priority: P1)

As a user reviewing ticket opportunities, I want each milestone's relevant date to
reflect its precision so that deadlines and current status are understandable.

**Why this priority**: The relevant date is the basis for deadline communication,
past status, retained history, and timeline month placement.

**Independent Test**: Review date, datetime, same-month window, and month-crossing
window milestones and compare their displayed date, month, and status boundaries.

**Acceptance Scenarios**:

1. **Given** a date milestone, **when** it is shown, **then** its relevant date is
   that calendar day.
2. **Given** a datetime milestone, **when** it is shown, **then** its relevant date
   is the Tokyo calendar date containing that datetime.
3. **Given** a window milestone, **when** its deadline or final date is evaluated,
   **then** the window end is the relevant date and the window remains current until
   that end is reached.
4. **Given** a window begins in one month and ends in the next, **when** the timeline
   is displayed, **then** the window appears in the month containing its end date.

### User Story 2 - Read the timeline in chronological order (Priority: P1)

As a user scanning ticket opportunities, I want the timeline order to remain stable
while month labels communicate deadline ownership.

**Why this priority**: Month placement explains the relevant deadline, while the
timeline sequence still needs to preserve the established chronological reading
order.

**Independent Test**: Compare a month-crossing window with milestones beginning
around it and verify that changing its month placement does not move its row in the
timeline.

**Acceptance Scenarios**:

1. **Given** a month-crossing window and other milestones, **when** the timeline is
   displayed, **then** rows retain their established chronological order.
2. **Given** rows whose month labels are not contiguous after applying relevant
   dates, **when** the timeline is displayed, **then** row order is preserved and
   later rows are not merged into an earlier month section solely because the month
   key matches.

### Edge Cases

The following boundaries are intentionally explicit:

- A same-month window remains in that same month.
- A window may be shown under a later month than the month in which it begins.
- A month label may recur later when the preserved row sequence makes that month
  non-contiguous.
- A datetime near midnight is assigned to its Tokyo calendar date.

## Requirements _(mandatory)_

### Milestone Date Semantics

- **FR-001**: A date milestone MUST use its own calendar day as its relevant date.
- **FR-002**: A datetime milestone MUST use the Tokyo calendar date containing its
  datetime as its relevant date.
- **FR-003**: A window milestone MUST use the Tokyo calendar date containing its
  ending side as its product-relevant deadline and final date.
- **FR-004**: A window milestone MUST remain non-past until its ending side has
  elapsed.
- **FR-005**: Deadline display, past status, retained history, and final-date
  behavior MUST remain consistent with the applicable precision-specific date
  semantics.

### Timeline Month Placement

- **FR-006**: A timeline month section MUST be determined from the milestone's
  product-relevant Tokyo calendar date.
- **FR-007**: A month-crossing window MUST appear in the month containing its end
  date.
- **FR-008**: Date and datetime milestones, and windows that begin and end in one
  month, MUST retain their existing month placement.

### Ordering Boundary

- **FR-009**: Changing a window's month placement MUST NOT change the established
  chronological order of timeline rows.
- **FR-010**: The month in which a row is displayed and the order in which rows are
  read MUST remain separate product concepts.
- **FR-011**: When applying relevant dates produces non-contiguous month labels, the
  timeline MUST preserve row order rather than merging separated sections solely by
  month name.

## Scope Boundaries

- This specification covers current TicketOpportunity milestone date semantics and
  timeline month placement.
- It covers the user-visible full timeline and the deadline meaning shared by
  TicketOpportunity surfaces.
- It does not define TicketOpportunity data modeling, import behavior, personal
  planning state, cancellation rules, retention duration, or calendar/catalog
  presentation outside TicketOpportunity milestones.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All four milestone precision cases—date, datetime, same-month window,
  and month-crossing window—show the expected relevant date and month.
- **SC-002**: A month-crossing window is displayed under its deadline month in every
  TicketOpportunity timeline surface.
- **SC-003**: Existing timeline row order is unchanged when a window crosses a month
  boundary.
- **SC-004**: Deadline, past, retained-history, and final-date outcomes agree on the
  same precision-specific product meaning.

## Assumptions

- User-facing calendar dates follow the product's existing Asia/Tokyo convention.
- The timeline continues to preserve its established row sequence when month
  membership does not form one globally monotonic sequence.
