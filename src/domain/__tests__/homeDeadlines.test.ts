import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectHomeDeadlineRows } from '../homeDeadlines.ts';
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
