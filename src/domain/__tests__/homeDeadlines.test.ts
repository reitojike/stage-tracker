import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectHomeDeadlineRows } from '../homeDeadlines.ts';
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
    }),
    baseRow({
      id: 'partially-canceled',
      targetScope: 'selected_occurrences',
      targetOccurrences: [
        occurrence({ id: 'occ-1', canceledAt: '2026-08-01T00:00:00.000Z' }),
        occurrence({ id: 'occ-2', canceledAt: null }),
      ],
    }),
  ];
  const selected = selectHomeDeadlineRows(rows, TODAY);
  assert.deepEqual(
    selected.map((row) => row.id),
    ['partially-canceled'],
    'a live target remains actionable even though a sibling target is canceled',
  );
});
