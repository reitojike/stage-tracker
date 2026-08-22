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

// Regression (Codex review on PR #52): naive string comparison of an
// all-day entry's bare "YYYY-MM-DD" against a full ISO timestamp gets the
// order backwards whenever they fall close together, because Asia/Tokyo's
// UTC+9 offset means a UTC afternoon/evening instant already belongs to the
// *next* Tokyo calendar day. All-day "2026-01-01" begins at the UTC instant
// 2025-12-31T15:00:00Z; a time-bounded entry at 2025-12-31T16:00:00Z is one
// hour *later* than that, so the all-day entry must sort first - but
// comparing the raw strings "2026-01-01" vs "2025-12-31T16:00:00Z" would
// rank the all-day entry *after* the timed one (since "2026-..." >
// "2025-..." lexicographically), the reverse of the correct order.
void test('comparePersonalScheduleEntriesByStart converts an all-day startsOn to its Tokyo-day UTC instant before comparing', () => {
  const allDay = mapPersonalScheduleEntryRow(
    rawAllDayRow({ id: 'all-day', starts_on: '2026-01-01', ends_on: '2026-01-01' }),
  );
  const timed = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'timed', starts_at: '2025-12-31T16:00:00Z' }),
  );
  assert.ok(
    comparePersonalScheduleEntriesByStart(allDay, timed) < 0,
    'all-day 2026-01-01 (starts 2025-12-31T15:00:00Z in Tokyo) must sort before the 16:00Z timed entry',
  );
  assert.deepEqual(
    sortPersonalScheduleEntries([timed, allDay]).map((e) => e.id),
    ['all-day', 'timed'],
  );
});

// Follow-up regression (Codex review on PR #52, after the fix above):
// startsOn's conversion still compared as a *string* against startsAt,
// which is not safe either - PostgREST returns a persisted timestamptz as
// e.g. "+00:00" with a variable number of fractional-second digits, not the
// "Z"-suffixed, fixed millisecond-precision format `.toISOString()`
// produces. Two instants a single microsecond apart, in those two different
// string shapes, do not necessarily string-compare in chronological order.
void test('comparePersonalScheduleEntriesByStart compares startsAt in PostgREST’s own timestamp format correctly against a converted startsOn', () => {
  const allDay = mapPersonalScheduleEntryRow(
    rawAllDayRow({ id: 'all-day', starts_on: '2026-01-01', ends_on: '2026-01-01' }),
  );
  // One microsecond after the all-day entry's instant (2025-12-31T15:00:00.000000Z),
  // in PostgREST's own "+00:00"-suffixed, microsecond-precision shape - not
  // the "Z"-suffixed, millisecond-only shape toISOString() produces. A
  // plain `Date.parse` comparison would round both to the same epoch
  // millisecond and fall through to the (here, wrong-direction) `id`
  // tie-breaker; only reading the sub-millisecond digits from the string
  // itself preserves this difference.
  const timed = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'timed', starts_at: '2025-12-31T15:00:00.000001+00:00' }),
  );
  assert.ok(
    comparePersonalScheduleEntriesByStart(allDay, timed) < 0,
    'the all-day entry must sort before a timed entry one microsecond later, regardless of timestamp string format or Date precision',
  );
});

// Second follow-up regression (Codex review on PR #52, after the fix
// above): the sort key's zero-padding width was hand-picked ("13 digits"),
// not derived from Date's actual representable range, so it silently
// stopped being monotonic once the epoch millisecond count grew past that
// guessed width - which happens in the year 2286, not the far future the
// original comment assumed. 2286-11-20T17:46:39.999Z is the exact instant
// where a 13-digit epoch millisecond count rolls over to 14 digits
// (9999999999999 -> 10000000000000).
void test('comparePersonalScheduleEntriesByStart stays monotonic across the old (hand-picked) 13-digit epoch-millisecond width', () => {
  const before = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'before', starts_at: '2286-11-20T17:46:39.999Z' }),
  );
  const after = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'after', starts_at: '2286-11-20T17:46:40.000Z' }),
  );
  assert.ok(
    comparePersonalScheduleEntriesByStart(before, after) < 0,
    'a 1ms-later instant must still sort after, even across an epoch-millisecond digit-count rollover',
  );
});

// Confirms the sort key also stays monotonic at the actual boundary that
// matters: the full range Date.parse can represent at all (ECMA-262's
// ±100,000,000-day limit), in both directions - not merely "far enough
// in the future to seem safe".
void test('comparePersonalScheduleEntriesByStart stays monotonic at the extremes of what Date.parse can represent', () => {
  const nearMax = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'near-max', starts_at: '+275760-09-12T23:59:59.999Z' }),
  );
  const atMax = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'at-max', starts_at: '+275760-09-13T00:00:00.000Z' }),
  );
  assert.ok(comparePersonalScheduleEntriesByStart(nearMax, atMax) < 0);

  const atMin = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'at-min', starts_at: '-271821-04-20T00:00:00.000Z' }),
  );
  const afterMin = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'after-min', starts_at: '-271821-04-20T00:00:00.001Z' }),
  );
  assert.ok(comparePersonalScheduleEntriesByStart(atMin, afterMin) < 0);
  assert.ok(comparePersonalScheduleEntriesByStart(atMin, atMax) < 0);
});

// Third follow-up regression (Codex review on PR #52, after the fix
// above): personal_schedule_entries.starts_at carries no CHECK constraint
// bounding it to a range Date.parse can represent (PostgreSQL's own
// timestamptz range extends to 294276 AD, and PostgREST serializes a
// 5+-digit year without the leading "+" Date.parse's ISO grammar requires
// - e.g. "10000-01-01T00:00:00+00:00" - which Date.parse cannot read at
// all). Comparing such a row must not throw past this function - a value
// outside what this product's Asia/Tokyo-scoped personal-schedule feature
// could ever realistically produce sorts last instead of crashing the
// read path.
void test('comparePersonalScheduleEntriesByStart does not throw for a starts_at Date.parse cannot read, and sorts it last', () => {
  const ordinary = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'ordinary', starts_at: '2026-02-01T09:00:00Z' }),
  );
  // PostgREST's own serialization of a valid PostgreSQL timestamptz whose
  // year has 5+ digits omits the leading "+" ISO 8601 (and Date.parse)
  // requires for such years.
  const farFuture = mapPersonalScheduleEntryRow(
    rawTimedRow({ id: 'far-future', starts_at: '10000-01-01T00:00:00+00:00' }),
  );
  assert.doesNotThrow(() => comparePersonalScheduleEntriesByStart(ordinary, farFuture));
  assert.ok(comparePersonalScheduleEntriesByStart(ordinary, farFuture) < 0);
  assert.deepEqual(
    sortPersonalScheduleEntries([farFuture, ordinary]).map((e) => e.id),
    ['ordinary', 'far-future'],
  );
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
