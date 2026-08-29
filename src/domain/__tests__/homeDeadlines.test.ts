import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectHomeDeadlineRows } from '../homeDeadlines.ts';
import { ticketOpportunityDeadlineBadge } from '../ticketOpportunityFormatting.ts';
import type { EventOccurrence } from '../eventCatalog.ts';
import type { TicketOpportunityTimelineRow } from '../ticketOpportunityTimeline.ts';

function baseRow(
  overrides: Partial<TicketOpportunityTimelineRow> = {},
): TicketOpportunityTimelineRow {
  return {
    id: 'ms-1',
    opportunityId: 'opp-1',
    sortInstant: '2026-09-01T00:00:00.000Z',
    eventTitle: 'イベントA',
    eventVenue: '会場A',
    eventCanceled: false,
    opportunityDisplayName: '第1抽選',
    sourceUrl: null,
    targetScope: 'event_wide',
    targetOccurrences: [],
    targetOccurrenceIdCount: 0,
    milestoneType: 'application_close',
    temporalPrecision: 'date',
    dateValue: '2026-09-05',
    at: null,
    startsAt: null,
    endsAt: null,
    myState: 'planned',
    isFirstRowForOpportunity: false,
    ...overrides,
  };
}

function occurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: 'occ-1',
    eventId: 'event-1',
    doorsAt: null,
    startsAt: '2026-09-10T02:00:00.000Z',
    endsAt: null,
    canceledAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TODAY = '2026-09-01';

void test('selectHomeDeadlineRows keeps only planned + application_close + today/future rows', () => {
  const rows = [
    baseRow({ id: 'ok-planned-close', myState: 'planned', milestoneType: 'application_close' }),
    baseRow({ id: 'applied-excluded', myState: 'applied', milestoneType: 'application_close' }),
    baseRow({ id: 'no-state-excluded', myState: null, milestoneType: 'application_close' }),
    baseRow({ id: 'open-excluded', myState: 'planned', milestoneType: 'application_open' }),
    baseRow({ id: 'result-excluded', myState: 'planned', milestoneType: 'result_announcement' }),
    baseRow({ id: 'sale-excluded', myState: 'planned', milestoneType: 'sale_start' }),
    baseRow({ id: 'payment-excluded', myState: 'planned', milestoneType: 'payment_window' }),
    baseRow({
      id: 'past-excluded',
      myState: 'planned',
      milestoneType: 'application_close',
      dateValue: '2026-08-31',
    }),
  ];

  const selected = selectHomeDeadlineRows(rows, TODAY);
  assert.deepEqual(
    selected.map((row) => row.id),
    ['ok-planned-close'],
  );
});

void test('selectHomeDeadlineRows orders nearest deadline first', () => {
  const rows = [
    baseRow({ id: 'far', dateValue: '2026-09-20' }),
    baseRow({ id: 'near', dateValue: '2026-09-02' }),
    baseRow({ id: 'mid', dateValue: '2026-09-10' }),
  ];

  const selected = selectHomeDeadlineRows(rows, TODAY);
  assert.deepEqual(
    selected.map((row) => row.id),
    ['near', 'mid', 'far'],
  );
});

void test('selectHomeDeadlineRows orders a window-precision application_close by its end, not its start', () => {
  const rows = [
    // Opens first (earlier start) but closes *after* the other row's close -
    // must not sort ahead of it by window start.
    baseRow({
      id: 'opens-early-closes-late',
      temporalPrecision: 'window',
      dateValue: null,
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-15T23:59:00.000Z',
    }),
    baseRow({
      id: 'opens-late-closes-early',
      temporalPrecision: 'window',
      dateValue: null,
      startsAt: '2026-09-08T00:00:00.000Z',
      endsAt: '2026-09-09T23:59:00.000Z',
    }),
  ];

  const selected = selectHomeDeadlineRows(rows, TODAY);
  assert.deepEqual(
    selected.map((row) => row.id),
    ['opens-late-closes-early', 'opens-early-closes-late'],
  );
});

void test('selectHomeDeadlineRows: today-precision deadline still counts as actionable', () => {
  const rows = [baseRow({ id: 'today', dateValue: TODAY })];
  const selected = selectHomeDeadlineRows(rows, TODAY);
  assert.deepEqual(
    selected.map((row) => row.id),
    ['today'],
  );
});

void test('selectHomeDeadlineRows: empty input yields an empty list', () => {
  assert.deepEqual(selectHomeDeadlineRows([], TODAY), []);
});

// --- Issue #191: Home and /tickets must classify the identical row
// identically - both call ticketOpportunityDeadlineBadge, the same shared
// domain authority, rather than either screen holding its own threshold. ---

void test('a row Home selects classifies via ticketOpportunityDeadlineBadge exactly as /tickets would for the same row (shared authority, not two derivations)', () => {
  const row = baseRow({ id: 'shared', dateValue: '2026-09-03' }); // day 2 - red
  const [selected] = selectHomeDeadlineRows([row], TODAY);
  assert.ok(selected !== undefined);
  // This is the exact call TicketOpportunityRow.tsx makes for the same row
  // shape - asserting it here (not just "some badge exists") pins the
  // actual classification, so this test would fail if Home and Tickets
  // ever diverged onto separate threshold logic.
  assert.deepEqual(ticketOpportunityDeadlineBadge(selected, TODAY), {
    variant: 'deadline',
    label: '残り2日',
  });
});

// --- Issue #172 root cause B: a whole-Opportunity-canceled target must
// never surface as an actionable Home deadline ---

void test('selectHomeDeadlineRows excludes an Event-canceled Opportunity even when otherwise actionable', () => {
  const rows = [baseRow({ id: 'canceled-event', eventCanceled: true }), baseRow({ id: 'live' })];
  const selected = selectHomeDeadlineRows(rows, TODAY);
  assert.deepEqual(
    selected.map((row) => row.id),
    ['live'],
  );
});

void test('selectHomeDeadlineRows excludes a selected_occurrences target only when every target is canceled', () => {
  const rows = [
    baseRow({
      id: 'all-canceled',
      targetScope: 'selected_occurrences',
      targetOccurrences: [occurrence({ canceledAt: '2026-08-01T00:00:00.000Z' })],
      targetOccurrenceIdCount: 1,
    }),
    baseRow({
      id: 'partially-canceled',
      targetScope: 'selected_occurrences',
      targetOccurrences: [
        occurrence({ id: 'occ-1', canceledAt: '2026-08-01T00:00:00.000Z' }),
        occurrence({ id: 'occ-2', canceledAt: null }),
      ],
      targetOccurrenceIdCount: 2,
    }),
  ];
  const selected = selectHomeDeadlineRows(rows, TODAY);
  assert.deepEqual(
    selected.map((row) => row.id),
    ['partially-canceled'],
    'a live target remains actionable even though a sibling target is canceled',
  );
});

void test('selectHomeDeadlineRows keeps a target actionable when its target set is only partially resolved (Codex targeted-closure finding on PR #173)', () => {
  const rows = [
    baseRow({
      id: 'partially-resolved',
      targetScope: 'selected_occurrences',
      // Only 1 of 3 originally-requested targets resolved, and that one
      // happens to be canceled - the other 2 are unknown, not confirmed
      // canceled, so the Opportunity must not be read as terminal.
      targetOccurrences: [occurrence({ id: 'occ-1', canceledAt: '2026-08-01T00:00:00.000Z' })],
      targetOccurrenceIdCount: 3,
    }),
  ];
  const selected = selectHomeDeadlineRows(rows, TODAY);
  assert.deepEqual(
    selected.map((row) => row.id),
    ['partially-resolved'],
    'an incomplete target resolution must not be read as "all targets canceled"',
  );
});
