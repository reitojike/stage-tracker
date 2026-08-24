import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attachOccurrencesToEvents,
  compareOccurrencesByStartsAt,
  groupOccurrencesByEvent,
  mapEventRow,
  mapOccurrenceRow,
  mapPostgrestError,
  sortOccurrences,
  tokyoCalendarDateFromInstant,
  tokyoCalendarDateRangeUtc,
  tokyoCalendarDayRangeUtc,
  type EventCatalogEvent,
  type EventOccurrence,
  type RawEventOccurrenceRow,
  type RawEventRow,
} from '../eventCatalog.ts';

// event()/occurrence() overrides intentionally take the raw (snake_case)
// row shape, not the mapped domain shape: they build fixtures by
// round-tripping through mapEventRow/mapOccurrenceRow (the functions under
// test), which also means these helpers exercise mapping on every call
// rather than needing a separate identity assumption.

// Pure domain-level tests for the event catalog read model (Issue #12).
// These exercise mapping/grouping/ordering/date-range logic directly with
// plain fixture data - no Supabase client, real or fake, is needed since
// none of this module touches the DB. The actual query wiring is instead
// verified against a real local Supabase instance in
// test/rls/eventCatalogRead.test.ts.

function rawEventRow(overrides: Partial<RawEventRow> = {}): RawEventRow {
  return {
    id: 'event-1',
    owner_id: 'owner-1',
    title: 'Sample event',
    venue: 'Sample venue',
    source_url: null,
    memo: null,
    starts_on: '2026-01-01',
    ends_on: '2026-12-31',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function rawOccurrenceRow(overrides: Partial<RawEventOccurrenceRow> = {}): RawEventOccurrenceRow {
  return {
    id: 'occurrence-1',
    event_id: 'event-1',
    doors_at: null,
    starts_at: '2026-01-10T10:00:00Z',
    ends_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function event(overrides: Partial<RawEventRow> = {}): EventCatalogEvent {
  return mapEventRow(rawEventRow(overrides));
}

function occurrence(overrides: Partial<RawEventOccurrenceRow> = {}): EventOccurrence {
  return mapOccurrenceRow(rawOccurrenceRow(overrides));
}

// --- Mapping ---

void test('mapEventRow maps snake_case persistence fields to the domain shape', () => {
  const row = rawEventRow({
    id: 'e1',
    owner_id: 'u1',
    title: '宝塚 千秋楽',
    venue: '会場A',
    source_url: 'https://example.test/e1',
    memo: 'memo text',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-02T00:00:00Z',
  });
  assert.deepEqual(mapEventRow(row), {
    id: 'e1',
    ownerId: 'u1',
    title: '宝塚 千秋楽',
    venue: '会場A',
    sourceUrl: 'https://example.test/e1',
    memo: 'memo text',
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-02T00:00:00Z',
  });
});

void test('mapOccurrenceRow maps snake_case persistence fields to the domain shape', () => {
  const row = rawOccurrenceRow({
    id: 'o1',
    event_id: 'e1',
    starts_at: '2026-02-01T10:00:00Z',
    ends_at: '2026-02-01T12:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  });
  assert.deepEqual(mapOccurrenceRow(row), {
    id: 'o1',
    eventId: 'e1',
    doorsAt: null,
    startsAt: '2026-02-01T10:00:00Z',
    endsAt: '2026-02-01T12:00:00Z',
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  });
});

// --- Nullable ends_at ---

void test('an unknown end time (null ends_at) is preserved as null, not defaulted', () => {
  const row = rawOccurrenceRow({ ends_at: null });
  assert.equal(mapOccurrenceRow(row).endsAt, null);
});

// --- Deterministic occurrence ordering ---

void test('compareOccurrencesByStartsAt orders by starts_at ascending', () => {
  const earlier = occurrence({ id: 'a', starts_at: '2026-01-01T00:00:00Z' });
  const later = occurrence({ id: 'b', starts_at: '2026-01-02T00:00:00Z' });
  assert.ok(compareOccurrencesByStartsAt(earlier, later) < 0);
  assert.ok(compareOccurrencesByStartsAt(later, earlier) > 0);
});

void test('compareOccurrencesByStartsAt breaks ties on the same starts_at by id, deterministically', () => {
  const a = occurrence({ id: 'aaa', starts_at: '2026-01-01T10:00:00Z' });
  const b = occurrence({ id: 'bbb', starts_at: '2026-01-01T10:00:00Z' });
  assert.ok(compareOccurrencesByStartsAt(a, b) < 0);
  assert.ok(compareOccurrencesByStartsAt(b, a) > 0);
  assert.equal(compareOccurrencesByStartsAt(a, a), 0);
});

void test('sortOccurrences does not mutate its input and returns a stable ascending order', () => {
  const input = [
    occurrence({ id: 'c', starts_at: '2026-01-03T00:00:00Z' }),
    occurrence({ id: 'a', starts_at: '2026-01-01T00:00:00Z' }),
    occurrence({ id: 'b', starts_at: '2026-01-01T00:00:00Z' }),
  ];
  const before = [...input];
  const sorted = sortOccurrences(input);
  assert.deepEqual(input, before, 'input array must not be mutated');
  assert.deepEqual(
    sorted.map((occ) => occ.id),
    ['a', 'b', 'c'],
  );
});

// --- attachOccurrencesToEvents: one event / one occurrence, multiple, empty ---

void test('attachOccurrencesToEvents: one event with one occurrence', () => {
  const events = [event({ id: 'e1' })];
  const occurrences = [occurrence({ id: 'o1', event_id: 'e1' })];
  const result = attachOccurrencesToEvents(events, occurrences);
  assert.equal(result.length, 1);
  const [group] = result;
  assert.ok(group);
  assert.equal(group.event.id, 'e1');
  assert.deepEqual(
    group.occurrences.map((occ) => occ.id),
    ['o1'],
  );
});

void test('attachOccurrencesToEvents: one event with multiple occurrences, ordered', () => {
  const events = [event({ id: 'e1' })];
  const occurrences = [
    occurrence({ id: 'o2', event_id: 'e1', starts_at: '2026-01-02T00:00:00Z' }),
    occurrence({ id: 'o1', event_id: 'e1', starts_at: '2026-01-01T00:00:00Z' }),
  ];
  const result = attachOccurrencesToEvents(events, occurrences);
  assert.equal(result.length, 1);
  const [group] = result;
  assert.ok(group);
  assert.deepEqual(
    group.occurrences.map((occ) => occ.id),
    ['o1', 'o2'],
  );
});

void test('attachOccurrencesToEvents: same-day multiple occurrences are not lost', () => {
  const events = [event({ id: 'e1' })];
  const occurrences = [
    occurrence({ id: 'matinee', event_id: 'e1', starts_at: '2026-03-01T02:00:00Z' }),
    occurrence({ id: 'evening', event_id: 'e1', starts_at: '2026-03-01T10:00:00Z' }),
  ];
  const result = attachOccurrencesToEvents(events, occurrences);
  const [group] = result;
  assert.ok(group);
  assert.equal(group.occurrences.length, 2);
  assert.deepEqual(
    group.occurrences.map((occ) => occ.id),
    ['matinee', 'evening'],
  );
});

void test('attachOccurrencesToEvents: an event with no matching occurrences gets an empty array, not omission', () => {
  const events = [event({ id: 'e1' }), event({ id: 'e2' })];
  const occurrences = [occurrence({ id: 'o1', event_id: 'e1' })];
  const result = attachOccurrencesToEvents(events, occurrences);
  assert.equal(result.length, 2);
  assert.deepEqual(result.find((r) => r.event.id === 'e2')?.occurrences, []);
});

void test('attachOccurrencesToEvents: empty input produces an empty result', () => {
  assert.deepEqual(attachOccurrencesToEvents([], []), []);
});

// --- groupOccurrencesByEvent: period/day scoped grouping ---

void test('groupOccurrencesByEvent: an event with no occurrences in the given set is absent, not fabricated', () => {
  const events = [event({ id: 'e1' }), event({ id: 'e2' })];
  // Only e1 has an occurrence in this (already period-filtered) set.
  const occurrences = [occurrence({ id: 'o1', event_id: 'e1' })];
  const result = groupOccurrencesByEvent(events, occurrences);
  assert.equal(result.length, 1);
  const [group] = result;
  assert.ok(group);
  assert.equal(group.event.id, 'e1');
});

void test('groupOccurrencesByEvent: empty occurrence set produces an empty result (no day fabricated as having a show)', () => {
  const events = [event({ id: 'e1' })];
  assert.deepEqual(groupOccurrencesByEvent(events, []), []);
});

void test('groupOccurrencesByEvent: same-day multiple occurrences for the same event are not lost', () => {
  const events = [event({ id: 'e1' })];
  const occurrences = [
    occurrence({ id: 'matinee', event_id: 'e1', starts_at: '2026-03-01T02:00:00Z' }),
    occurrence({ id: 'evening', event_id: 'e1', starts_at: '2026-03-01T10:00:00Z' }),
  ];
  const result = groupOccurrencesByEvent(events, occurrences);
  assert.equal(result.length, 1);
  const [group] = result;
  assert.ok(group);
  assert.deepEqual(
    group.occurrences.map((occ) => occ.id),
    ['matinee', 'evening'],
  );
});

void test('groupOccurrencesByEvent: events ordered by their earliest occurrence', () => {
  const events = [event({ id: 'later-event' }), event({ id: 'sooner-event' })];
  const occurrences = [
    occurrence({ id: 'o-later', event_id: 'later-event', starts_at: '2026-05-02T00:00:00Z' }),
    occurrence({ id: 'o-sooner', event_id: 'sooner-event', starts_at: '2026-05-01T00:00:00Z' }),
  ];
  const result = groupOccurrencesByEvent(events, occurrences);
  assert.deepEqual(
    result.map((r) => r.event.id),
    ['sooner-event', 'later-event'],
  );
});

void test('groupOccurrencesByEvent: an occurrence referencing an event missing from `events` is dropped defensively, not crashing', () => {
  const events = [event({ id: 'e1' })];
  const occurrences = [
    occurrence({ id: 'o1', event_id: 'e1' }),
    occurrence({ id: 'orphan', event_id: 'unknown-event' }),
  ];
  const result = groupOccurrencesByEvent(events, occurrences);
  assert.equal(result.length, 1);
  const [group] = result;
  assert.ok(group);
  assert.equal(group.event.id, 'e1');
});

// --- Asia/Tokyo date/range boundary semantics ---

void test('tokyoCalendarDayRangeUtc: 2026-08-21 is [2026-08-20T15:00:00Z, 2026-08-21T15:00:00Z)', () => {
  const range = tokyoCalendarDayRangeUtc('2026-08-21');
  assert.equal(range.startUtc, '2026-08-20T15:00:00.000Z');
  assert.equal(range.endUtcExclusive, '2026-08-21T15:00:00.000Z');
});

void test('tokyoCalendarDayRangeUtc: adjacent days are contiguous with no gap or overlap', () => {
  const day1 = tokyoCalendarDayRangeUtc('2026-08-21');
  const day2 = tokyoCalendarDayRangeUtc('2026-08-22');
  assert.equal(day1.endUtcExclusive, day2.startUtc);
});

void test('tokyoCalendarDayRangeUtc: an instant exactly at the day boundary belongs to the next day, not both', () => {
  const day1 = tokyoCalendarDayRangeUtc('2026-08-21');
  const boundaryInstant = new Date(day1.endUtcExclusive).getTime();
  // A half-open range excludes its own end: boundaryInstant is not < endUtcExclusive.
  assert.equal(boundaryInstant < new Date(day1.endUtcExclusive).getTime(), false);
  assert.ok(boundaryInstant >= new Date(day1.startUtc).getTime());
});

void test('tokyoCalendarDayRangeUtc rejects a non "YYYY-MM-DD" input rather than silently misparsing', () => {
  assert.throws(() => tokyoCalendarDayRangeUtc('2026/08/21'));
  assert.throws(() => tokyoCalendarDayRangeUtc('21-08-2026'));
});

void test('tokyoCalendarDayRangeUtc rejects a shape-valid but calendar-invalid date rather than silently rolling over', () => {
  // Date.UTC normalizes out-of-range components (Feb 30 -> Mar 2, month 13
  // -> next January, month 00/day 00 -> the previous month/day) instead of
  // erroring; each of these must be rejected, not silently answer for a
  // different day than the caller wrote.
  assert.throws(() => tokyoCalendarDayRangeUtc('2026-02-30'));
  assert.throws(() => tokyoCalendarDayRangeUtc('2026-13-01'));
  assert.throws(() => tokyoCalendarDayRangeUtc('2026-00-15'));
  assert.throws(() => tokyoCalendarDayRangeUtc('2026-08-00'));
  assert.throws(() => tokyoCalendarDayRangeUtc('2026-08-32'));
});

void test('tokyoCalendarDayRangeUtc accepts the Feb 29 leap day in a leap year but rejects it otherwise', () => {
  assert.doesNotThrow(() => tokyoCalendarDayRangeUtc('2028-02-29'));
  assert.throws(() => tokyoCalendarDayRangeUtc('2026-02-29'));
});

void test('tokyoCalendarDateRangeUtc: a full month range has no overlap with the next month', () => {
  const august = tokyoCalendarDateRangeUtc('2026-08-01', '2026-08-31');
  const september = tokyoCalendarDateRangeUtc('2026-09-01', '2026-09-30');
  assert.equal(august.endUtcExclusive, september.startUtc);
});

void test('tokyoCalendarDateRangeUtc: a single-day range matches tokyoCalendarDayRangeUtc', () => {
  const asRange = tokyoCalendarDateRangeUtc('2026-08-21', '2026-08-21');
  const asDay = tokyoCalendarDayRangeUtc('2026-08-21');
  assert.deepEqual(asRange, asDay);
});

void test('tokyoCalendarDateFromInstant: inverts tokyoCalendarDayRangeUtc at the day boundary', () => {
  const { startUtc } = tokyoCalendarDayRangeUtc('2026-08-21');
  assert.equal(tokyoCalendarDateFromInstant(startUtc), '2026-08-21');
  // One millisecond before Tokyo midnight still belongs to the previous day.
  const justBefore = new Date(new Date(startUtc).getTime() - 1).toISOString();
  assert.equal(tokyoCalendarDateFromInstant(justBefore), '2026-08-20');
});

void test('tokyoCalendarDateFromInstant: a UTC evening instant can fall on the next Tokyo calendar day', () => {
  // 2026-08-20T16:00:00Z is 2026-08-21T01:00:00+09:00.
  assert.equal(tokyoCalendarDateFromInstant('2026-08-20T16:00:00.000Z'), '2026-08-21');
});

void test('tokyoCalendarDateFromInstant: rejects an unparseable instant', () => {
  assert.throws(() => tokyoCalendarDateFromInstant('not-an-instant'));
});

// --- Empty result semantics ---

void test('attachOccurrencesToEvents and groupOccurrencesByEvent both return [] for no events at all', () => {
  assert.deepEqual(attachOccurrencesToEvents([], []), []);
  assert.deepEqual(groupOccurrencesByEvent([], []), []);
});

// --- DB error mapping ---

void test('mapPostgrestError maps a raw Postgrest error to the domain error shape without leaking extra fields', () => {
  const raw = {
    message: 'permission denied for table events',
    code: '42501',
    details: 'internal detail that should not leak',
    hint: null,
  };
  assert.deepEqual(mapPostgrestError(raw), {
    message: 'permission denied for table events',
    code: '42501',
  });
});
