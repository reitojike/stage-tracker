# Feature Specification: Calendar Month-Grid Cancellation Semantics

**Feature Branch**: `004-calendar-month-grid`

**Created**: 2026-09-18

**Status**: Current behavior contract

**Input**: GitHub Issue #505 and the settled Catalog / My Calendar product
decision recorded under Issue #493.

## Authority Boundary

This document is the current product behavior authority for cancellation meaning
in the Catalog and My Calendar month grids. Issue #505 remains the canonical
change intent. Architecture documents, implementation, tests, data schemas, and
CI retain their respective responsibilities and are not duplicated here.

The My Calendar participation boundary and effective-cancellation lifecycle
remain owned by [`specs/001-occurrence-participation/spec.md`](../001-occurrence-participation/spec.md).
This topic records only the month-grid projection and its detail visibility
boundary.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Browse published Catalog information (Priority: P1)

As a user browsing the Catalog, I want the month grid to represent published
Event information so that cancellation does not make an Event silently
disappear from the catalog.

**Independent Test**: Show a canceled single-day Event, a single-day Event with
a canceled occurrence, and a canceled multi-day Event, then compare the month
count, band, and cancellation cues.

**Acceptance Scenarios**:

1. **Given** a canceled single-day Event, **when** its month is shown, **then**
   it remains included in the Catalog publication count.
2. **Given** an active Event with a canceled occurrence, **when** its month is
   shown, **then** the Event remains included in the Catalog publication count;
   the count is per Event, not per occurrence.
3. **Given** a canceled multi-day Event, **when** its range is shown, **then**
   its band remains visible and is identifiable as canceled.
4. **Given** a canceled Event or occurrence is available in selected-day detail,
   **when** the user opens that detail, **then** the canceled state remains
   identifiable.

### User Story 2 - Plan active participation in My Calendar (Priority: P1)

As a user checking My Calendar, I want month markers and counts to represent
active planning so that canceled participation does not look like an active
commitment.

**Independent Test**: Project event-level and occurrence-level cancellation
through the month marker/count projection, then open the corresponding selected
day detail.

**Acceptance Scenarios**:

1. **Given** an event-level or occurrence-level effectively canceled occurrence,
   **when** My Calendar is shown, **then** it contributes neither an active dot
   nor an active participation count.
2. **Given** a canceled occurrence remains in the source/detail data, **when**
   its selected day is shown, **then** the detail remains available and the
   canceled state is identifiable.
3. **Given** a non-canceled occurrence or personal schedule item, **when** the
   month is shown, **then** its established active marker/count meaning remains
   unchanged.

### Shared Product Boundary

Cancellation is not deletion. Catalog publication and My Calendar active
planning are intentionally different surfaces and therefore intentionally use
different month-grid count semantics.

## Requirements _(mandatory)_

- **FR-001**: The Catalog month grid MUST represent published Events, including
  canceled Events and Events related to canceled occurrences.
- **FR-002**: A Catalog single-day count MUST count Events once per Event and
  MUST NOT apply an active-only cancellation filter or become an occurrence
  count.
- **FR-003**: A canceled Catalog multi-day Event MUST remain represented by its
  range and MUST expose an identifiable canceled state.
- **FR-004**: Catalog selected-day detail MUST remain independently available
  from month-grid count or band projection and MUST identify cancellation when
  applicable.
- **FR-005**: My Calendar month participation markers and counts MUST represent
  active planning only.
- **FR-006**: My Calendar MUST exclude event-level and occurrence-level
  effectively canceled occurrences from active participation markers and counts.
- **FR-007**: Excluding a canceled occurrence from My Calendar month markers or
  counts MUST NOT remove it from selected-day source/detail data.
- **FR-008**: My Calendar selected-day detail MUST identify the canceled state
  when the selected item is effectively canceled.
- **FR-009**: Catalog and My Calendar MUST retain their intentionally asymmetric
  cancellation count semantics; cancellation MUST NOT be treated as deletion
  across both surfaces.

## Scope Boundaries

This specification covers only user-visible month-grid publication, active
planning markers/counts, cancellation cues, and the relationship between month
projection and selected-day detail on Catalog and My Calendar.

It does not define Event or Occurrence schemas, cancellation writes, the
Participation lifecycle, Personal Schedule semantics, calendar navigation,
weekday conventions, or implementation structure.

## Success Criteria _(mandatory)_

- **SC-001**: Canceled Catalog Events remain observable in their publication
  count or range band in all representative month-grid cases.
- **SC-002**: Effectively canceled My Calendar occurrences contribute zero active
  participation dot/count while remaining reachable in selected-day detail.
- **SC-003**: Catalog and My Calendar preserve their different cancellation
  meanings without either surface silently adopting the other's filter.
- **SC-004**: Canceled state remains distinguishable in the representative
  Catalog band and selected-day detail, and in My Calendar selected-day detail.

## Assumptions

- Product calendar dates follow the existing Asia/Tokyo convention.
- Existing effective-cancellation rules continue to be authoritative for My
  Calendar participation projection.
- The month grid remains a bounded tap-target calendar; this specification does
  not add keyboard grid navigation or a new calendar interaction model.
