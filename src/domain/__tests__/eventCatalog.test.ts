import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attachOccurrencesToEvents,
  compareOccurrencesByStartsAt,
  groupOccurrencesByEvent,
  mapEventRow,
  mapGenreRow,
  mapGroupRow,
  mapOccurrenceRow,
  mapPostgrestError,
  matchesCatalogFilter,
  sortGenres,
  sortGroups,
  sortOccurrences,
  tokyoCalendarDateFromInstant,
  tokyoCalendarDateRangeUtc,
  tokyoCalendarDayRangeUtc,
  type CatalogFilterOptionUniverse,
  type CatalogFilterSelection,
  type EventCatalogEvent,
  type EventClassification,
  type EventOccurrence,
  type Genre,
  type Group,
  type RawEventOccurrenceRow,
  type RawEventRow,
  type RawGenreRow,
  type RawGroupRow,
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
    canceled_at: null,
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
    canceled_at: null,
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
    canceledAt: null,
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
    canceledAt: null,
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

// --- Genre/group classification (Issue #167, PO decision #158) ---

function rawGenreRow(overrides: Partial<RawGenreRow> = {}): RawGenreRow {
  return { id: 'genre-1', key: 'takarazuka', display_name: '宝塚', sort_order: 1, ...overrides };
}

function rawGroupRow(overrides: Partial<RawGroupRow> = {}): RawGroupRow {
  return { id: 'group-1', key: 'takarazuka-tsuki', display_name: '月組', ...overrides };
}

function genre(overrides: Partial<Genre> = {}): Genre {
  return mapGenreRow(rawGenreRow(overridesToRawGenre(overrides)));
}

function overridesToRawGenre(overrides: Partial<Genre>): Partial<RawGenreRow> {
  const raw: Partial<RawGenreRow> = {};
  if (overrides.id !== undefined) raw.id = overrides.id;
  if (overrides.key !== undefined) raw.key = overrides.key;
  if (overrides.displayName !== undefined) raw.display_name = overrides.displayName;
  if (overrides.sortOrder !== undefined) raw.sort_order = overrides.sortOrder;
  return raw;
}

function group(overrides: Partial<Group> = {}): Group {
  const raw: Partial<RawGroupRow> = {};
  if (overrides.id !== undefined) raw.id = overrides.id;
  if (overrides.key !== undefined) raw.key = overrides.key;
  if (overrides.displayName !== undefined) raw.display_name = overrides.displayName;
  return mapGroupRow(rawGroupRow(raw));
}

void test('mapGenreRow/mapGroupRow map snake_case rows to the domain shape', () => {
  assert.deepEqual(mapGenreRow(rawGenreRow()), {
    id: 'genre-1',
    key: 'takarazuka',
    displayName: '宝塚',
    sortOrder: 1,
  });
  assert.deepEqual(mapGroupRow(rawGroupRow()), {
    id: 'group-1',
    key: 'takarazuka-tsuki',
    displayName: '月組',
  });
});

void test('sortGenres orders by sort_order ascending, id as tie-breaker', () => {
  const idol = genre({ id: 'g-idol', key: 'idol', displayName: 'アイドル', sortOrder: 3 });
  const kabuki = genre({ id: 'g-kabuki', key: 'kabuki', displayName: '歌舞伎', sortOrder: 2 });
  const takarazuka = genre({ id: 'g-tz', key: 'takarazuka', displayName: '宝塚', sortOrder: 1 });
  assert.deepEqual(sortGenres([idol, kabuki, takarazuka]), [takarazuka, kabuki, idol]);

  const tieA = genre({ id: 'b', sortOrder: 1 });
  const tieB = genre({ id: 'a', sortOrder: 1 });
  assert.deepEqual(sortGenres([tieA, tieB]), [tieB, tieA]);
});

void test('sortGroups orders by displayName ascending, id as tie-breaker', () => {
  const hoshi = group({ id: 'g-hoshi', key: 'hoshi', displayName: '星組' });
  const tsuki = group({ id: 'g-tsuki', key: 'tsuki', displayName: '月組' });
  // '星組' < '月組' by UTF-16 code unit (星 U+661F < 月 U+6708).
  assert.deepEqual(sortGroups([tsuki, hoshi]), [hoshi, tsuki]);

  const tieA = group({ id: 'b', displayName: '同名' });
  const tieB = group({ id: 'a', displayName: '同名' });
  assert.deepEqual(sortGroups([tieA, tieB]), [tieB, tieA]);
});

const TAKARAZUKA = genre({ id: 'genre-takarazuka', key: 'takarazuka', sortOrder: 1 });
const KABUKI = genre({
  id: 'genre-kabuki',
  key: 'kabuki',
  displayName: '歌舞伎',
  sortOrder: 2,
});
const TSUKI = group({ id: 'group-tsuki', key: 'tsuki', displayName: '月組' });
const HOSHI = group({ id: 'group-hoshi', key: 'hoshi', displayName: '星組' });

function classification(overrides: Partial<EventClassification> = {}): EventClassification {
  return { eventId: 'event-1', genre: null, groups: [], ...overrides };
}

function emptySelection(overrides: Partial<CatalogFilterSelection> = {}): CatalogFilterSelection {
  return { genre: null, groups: [], venues: [], ...overrides };
}

function universe(
  overrides: Partial<CatalogFilterOptionUniverse> = {},
): CatalogFilterOptionUniverse {
  return { groupKeys: [], venues: [], ...overrides };
}

void test('matchesCatalogFilter: no selection at all matches every event', () => {
  const classified = { classification: classification({ genre: TAKARAZUKA }), venue: null };
  const unclassified = { classification: null, venue: null };
  assert.equal(matchesCatalogFilter(classified, emptySelection(), universe()), true);
  assert.equal(matchesCatalogFilter(unclassified, emptySelection(), universe()), true);
});

void test('matchesCatalogFilter: genre is single-select exact match, unclassified never matches a specific genre', () => {
  const takarazukaEvent = { classification: classification({ genre: TAKARAZUKA }), venue: null };
  const kabukiEvent = { classification: classification({ genre: KABUKI }), venue: null };
  const unclassifiedEvent = { classification: null, venue: null };
  const selection = emptySelection({ genre: 'takarazuka' });

  assert.equal(matchesCatalogFilter(takarazukaEvent, selection, universe()), true);
  assert.equal(matchesCatalogFilter(kabukiEvent, selection, universe()), false);
  assert.equal(matchesCatalogFilter(unclassifiedEvent, selection, universe()), false);
});

void test('matchesCatalogFilter: unclassified is visible when no genre filter is active (すべて)', () => {
  const unclassifiedEvent = { classification: null, venue: null };
  assert.equal(matchesCatalogFilter(unclassifiedEvent, emptySelection(), universe()), true);
});

void test('matchesCatalogFilter: group facet is OR within the facet', () => {
  const tsukiEvent = {
    classification: classification({ genre: TAKARAZUKA, groups: [TSUKI] }),
    venue: null,
  };
  const hoshiEvent = {
    classification: classification({ genre: TAKARAZUKA, groups: [HOSHI] }),
    venue: null,
  };
  const noGroupEvent = { classification: classification({ genre: TAKARAZUKA }), venue: null };
  const selection = emptySelection({ groups: ['tsuki', 'hoshi'] });
  const opts = universe({ groupKeys: ['tsuki', 'hoshi', 'other'] });

  assert.equal(matchesCatalogFilter(tsukiEvent, selection, opts), true);
  assert.equal(matchesCatalogFilter(hoshiEvent, selection, opts), true);
  assert.equal(matchesCatalogFilter(noGroupEvent, selection, opts), false);
});

void test('matchesCatalogFilter: an Event with multiple groups matches when any selected group matches', () => {
  const jointEvent = {
    classification: classification({ genre: TAKARAZUKA, groups: [TSUKI, HOSHI] }),
    venue: null,
  };
  const selection = emptySelection({ groups: ['hoshi'] });
  const opts = universe({ groupKeys: ['tsuki', 'hoshi'] });
  assert.equal(matchesCatalogFilter(jointEvent, selection, opts), true);
});

void test('matchesCatalogFilter: venue facet is OR, exact text match', () => {
  const kabukiza = { classification: classification({ genre: KABUKI }), venue: '歌舞伎座' };
  const heiseiNakamuraza = {
    classification: classification({ genre: KABUKI }),
    venue: '平成中村座',
  };
  const noVenue = { classification: classification({ genre: KABUKI }), venue: null };
  const selection = emptySelection({ venues: ['歌舞伎座'] });
  const opts = universe({ venues: ['歌舞伎座', '平成中村座'] });

  assert.equal(matchesCatalogFilter(kabukiza, selection, opts), true);
  assert.equal(matchesCatalogFilter(heiseiNakamuraza, selection, opts), false);
  assert.equal(matchesCatalogFilter(noVenue, selection, opts), false);
  // Not a substring/fuzzy match.
  assert.equal(
    matchesCatalogFilter(
      { classification: classification({ genre: KABUKI }), venue: '新歌舞伎座' },
      selection,
      opts,
    ),
    false,
  );
});

void test('matchesCatalogFilter: active facets combine with AND', () => {
  const opts = universe({ groupKeys: ['tsuki', 'hoshi'], venues: ['東京宝塚劇場', '宝塚大劇場'] });
  const selection = emptySelection({
    genre: 'takarazuka',
    groups: ['hoshi'],
    venues: ['東京宝塚劇場'],
  });

  const matchesAll = {
    classification: classification({ genre: TAKARAZUKA, groups: [HOSHI] }),
    venue: '東京宝塚劇場',
  };
  const wrongVenue = {
    classification: classification({ genre: TAKARAZUKA, groups: [HOSHI] }),
    venue: '宝塚大劇場',
  };
  const wrongGroup = {
    classification: classification({ genre: TAKARAZUKA, groups: [TSUKI] }),
    venue: '東京宝塚劇場',
  };

  assert.equal(matchesCatalogFilter(matchesAll, selection, opts), true);
  assert.equal(matchesCatalogFilter(wrongVenue, selection, opts), false);
  assert.equal(matchesCatalogFilter(wrongGroup, selection, opts), false);
});

void test('matchesCatalogFilter: selecting every known group option is a no-op for that facet', () => {
  const noGroupEvent = { classification: classification({ genre: TAKARAZUKA }), venue: null };
  const selection = emptySelection({ groups: ['tsuki', 'hoshi'] });
  const opts = universe({ groupKeys: ['tsuki', 'hoshi'] });
  // Every known option selected -> no filtering by this facet, so even an
  // event with zero groups still matches (#158 "全optionを選択している ...
  // そのfacetでは絞り込まない").
  assert.equal(matchesCatalogFilter(noGroupEvent, selection, opts), true);
});

void test('matchesCatalogFilter: selecting every known venue option is a no-op for that facet', () => {
  const noVenueEvent = { classification: classification({ genre: KABUKI }), venue: null };
  const selection = emptySelection({ venues: ['歌舞伎座', '平成中村座'] });
  const opts = universe({ venues: ['歌舞伎座', '平成中村座'] });
  assert.equal(matchesCatalogFilter(noVenueEvent, selection, opts), true);
});

void test('matchesCatalogFilter: an empty selection with a non-empty universe is still a no-op (not "select none")', () => {
  const anyEvent = { classification: classification({ genre: TAKARAZUKA }), venue: null };
  const selection = emptySelection({ groups: [] });
  const opts = universe({ groupKeys: ['tsuki', 'hoshi'] });
  assert.equal(matchesCatalogFilter(anyEvent, selection, opts), true);
});
