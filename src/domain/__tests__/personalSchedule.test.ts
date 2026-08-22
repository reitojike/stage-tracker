import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  comparePersonalScheduleEntriesByStart,
  mapPersonalScheduleEntryRow,
  sortPersonalScheduleEntries,
  temporalToColumns,
  type RawPersonalScheduleEntryRow,
} from '../personalSchedule.ts';

function rawAllDayRow(
  overrides: Partial<RawPersonalScheduleEntryRow> = {},
): RawPersonalScheduleEntryRow {
  return {
    id: 'entry-1',
    owner_id: 'owner-1',
    schedule_type: 'other',
    memo: null,
    is_all_day: true,
    starts_on: '2026-02-01',
    ends_on: '2026-02-01',
    starts_at: null,
    ends_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function rawTimedRow(
  overrides: Partial<RawPersonalScheduleEntryRow> = {},
): RawPersonalScheduleEntryRow {
  return {
    id: 'entry-2',
    owner_id: 'owner-1',
    schedule_type: 'work',
    memo: null,
    is_all_day: false,
    starts_on: null,
    ends_on: null,
    starts_at: '2026-02-01T09:00:00Z',
    ends_at: '2026-02-01T18:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

void test('mapPersonalScheduleEntryRow maps an all-day row to the all-day shape', () => {
  const mapped = mapPersonalScheduleEntryRow(
    rawAllDayRow({ starts_on: '2026-02-01', ends_on: '2026-02-03', memo: 'trip' }),
  );
  assert.equal(mapped.scheduleType, 'other');
  assert.equal(mapped.memo, 'trip');
  assert.deepEqual(mapped.temporal, {
    kind: 'all-day',
    startsOn: '2026-02-01',
    endsOn: '2026-02-03',
  });
});

void test('mapPersonalScheduleEntryRow maps a time-bounded row, endsAt may be null', () => {
  const mapped = mapPersonalScheduleEntryRow(rawTimedRow({ ends_at: null }));
  assert.deepEqual(mapped.temporal, {
    kind: 'time-bounded',
    startsAt: '2026-02-01T09:00:00Z',
    endsAt: null,
  });
});

void test('mapPersonalScheduleEntryRow rejects an unrecognized schedule_type', () => {
  assert.throws(() => mapPersonalScheduleEntryRow(rawAllDayRow({ schedule_type: 'vacation' })));
});

void test('mapPersonalScheduleEntryRow rejects an all-day row missing starts_on/ends_on', () => {
  assert.throws(() => mapPersonalScheduleEntryRow(rawAllDayRow({ starts_on: null })));
});

void test('mapPersonalScheduleEntryRow rejects a time-bounded row missing starts_at', () => {
  assert.throws(() => mapPersonalScheduleEntryRow(rawTimedRow({ starts_at: null })));
});

void test('temporalToColumns round-trips an all-day shape with the other shape nulled out', () => {
  const columns = temporalToColumns({
    kind: 'all-day',
    startsOn: '2026-02-01',
    endsOn: '2026-02-03',
  });
  assert.deepEqual(columns, {
    is_all_day: true,
    starts_on: '2026-02-01',
    ends_on: '2026-02-03',
    starts_at: null,
    ends_at: null,
  });
});

void test('temporalToColumns round-trips a time-bounded shape with the other shape nulled out', () => {
  const columns = temporalToColumns({
    kind: 'time-bounded',
    startsAt: '2026-02-01T09:00:00Z',
    endsAt: null,
  });
  assert.deepEqual(columns, {
    is_all_day: false,
    starts_on: null,
    ends_on: null,
    starts_at: '2026-02-01T09:00:00Z',
    ends_at: null,
  });
});

void test('comparePersonalScheduleEntriesByStart orders all-day and time-bounded entries by their own start field', () => {
  const allDay = mapPersonalScheduleEntryRow(
    rawAllDayRow({ id: 'all-day', starts_on: '2026-02-05', ends_on: '2026-02-05' }),
  );
  const timed = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'timed', starts_at: '2026-02-01T09:00:00Z' }),
  );
  assert.ok(comparePersonalScheduleEntriesByStart(timed, allDay) < 0);
});

void test('sortPersonalScheduleEntries does not mutate its input array', () => {
  const later = mapPersonalScheduleEntryRow(rawAllDayRow({ id: 'later', starts_on: '2026-02-10' }));
  const earlier = mapPersonalScheduleEntryRow(
    rawAllDayRow({ id: 'earlier', starts_on: '2026-02-01' }),
  );
  const input = [later, earlier];
  const sorted = sortPersonalScheduleEntries(input);
  assert.deepEqual(
    input.map((e) => e.id),
    ['later', 'earlier'],
  );
  assert.deepEqual(
    sorted.map((e) => e.id),
    ['earlier', 'later'],
  );
});
