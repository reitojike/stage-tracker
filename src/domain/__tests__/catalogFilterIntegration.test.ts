import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classificationsByEventId,
  catalogFilterOptionUniverseForGenre,
  filterCatalogEvents,
} from '../catalogFilterIntegration.ts';
import type {
  EventCatalogEvent,
  EventClassification,
  EventWithOccurrences,
  Genre,
  Group,
} from '../eventCatalog.ts';

// Pure integration-layer tests (Issue #145): this module composes #167's
// EventClassification projection with #167's matchesCatalogFilter predicate
// against a fetched EventWithOccurrences[] set - it does not re-derive
// filtering semantics itself, so these tests exercise the composition
// (lookup wiring, "missing = unclassified", "one filtered set for every
// surface"), not the OR/AND/none-all semantics themselves (already covered
// by src/domain/__tests__/eventCatalog.test.ts's matchesCatalogFilter
// tests).

function genre(overrides: Partial<Genre> = {}): Genre {
  return {
    id: 'genre-takarazuka',
    key: 'takarazuka',
    displayName: '宝塚',
    sortOrder: 1,
    ...overrides,
  };
}

function group(overrides: Partial<Group> = {}): Group {
  return { id: 'group-hana', key: 'hana', displayName: '花組', ...overrides };
}

function classification(overrides: Partial<EventClassification> = {}): EventClassification {
  return { eventId: 'event-1', genre: null, groups: [], ...overrides };
}

function event(overrides: Partial<EventCatalogEvent> = {}): EventCatalogEvent {
  return {
    id: 'event-1',
    ownerId: 'owner-1',
    title: 'Sample event',
    venue: null,
    sourceUrl: null,
    memo: null,
    startsOn: '2026-01-01',
    endsOn: '2026-01-01',
    canceledAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function eventWithOccurrences(overrides: Partial<EventCatalogEvent> = {}): EventWithOccurrences {
  return { event: event(overrides), occurrences: [] };
}

// --- classificationsByEventId ---

void test('classificationsByEventId keys the classification list by eventId', () => {
  const a = classification({ eventId: 'a', genre: genre() });
  const b = classification({ eventId: 'b', genre: null });
  const map = classificationsByEventId([a, b]);
  assert.equal(map.get('a'), a);
  assert.equal(map.get('b'), b);
  assert.equal(map.size, 2);
});

void test('classificationsByEventId returns an empty map for an empty input', () => {
  assert.equal(classificationsByEventId([]).size, 0);
});

// --- catalogFilterOptionUniverseForGenre ---

void test('catalogFilterOptionUniverseForGenre returns an empty universe for すべて (null genre)', () => {
  const universe = catalogFilterOptionUniverseForGenre(
    null,
    { takarazuka: [group()] },
    { kabuki: ['歌舞伎座'] },
  );
  assert.deepEqual(universe, { groupKeys: [], venues: [] });
});

void test('catalogFilterOptionUniverseForGenre projects a group-facet genre to its group keys', () => {
  const universe = catalogFilterOptionUniverseForGenre(
    'takarazuka',
    { takarazuka: [group({ key: 'hana' }), group({ id: 'group-tsuki', key: 'tsuki' })] },
    {},
  );
  assert.deepEqual(universe, { groupKeys: ['hana', 'tsuki'], venues: [] });
});

void test('catalogFilterOptionUniverseForGenre projects a venue-facet genre to its venue text', () => {
  const universe = catalogFilterOptionUniverseForGenre(
    'kabuki',
    {},
    { kabuki: ['歌舞伎座', '南座'] },
  );
  assert.deepEqual(universe, { groupKeys: [], venues: ['歌舞伎座', '南座'] });
});

void test('catalogFilterOptionUniverseForGenre treats a genre absent from either map as an empty (not-loaded) universe, never throwing', () => {
  const universe = catalogFilterOptionUniverseForGenre('idol', {}, {});
  assert.deepEqual(universe, { groupKeys: [], venues: [] });
});

// --- filterCatalogEvents ---

void test('filterCatalogEvents keeps every event under すべて (no genre selection)', () => {
  const events = [eventWithOccurrences({ id: 'a' }), eventWithOccurrences({ id: 'b' })];
  const result = filterCatalogEvents(
    events,
    new Map(),
    { genre: null, groups: [], venues: [] },
    {
      groupKeys: [],
      venues: [],
    },
  );
  assert.deepEqual(
    result.map((group_) => group_.event.id),
    ['a', 'b'],
  );
});

void test('filterCatalogEvents drops an unclassified event (missing map entry) under a specific genre filter', () => {
  const events = [eventWithOccurrences({ id: 'a' })];
  const result = filterCatalogEvents(
    events,
    new Map(),
    { genre: 'takarazuka', groups: [], venues: [] },
    {
      groupKeys: [],
      venues: [],
    },
  );
  assert.deepEqual(result, []);
});

void test('filterCatalogEvents keeps only events whose classification genre matches the selection', () => {
  const takarazukaEvent = eventWithOccurrences({ id: 'a' });
  const kabukiEvent = eventWithOccurrences({ id: 'b' });
  const byId = classificationsByEventId([
    classification({ eventId: 'a', genre: genre({ key: 'takarazuka' }) }),
    classification({
      eventId: 'b',
      genre: genre({ id: 'genre-kabuki', key: 'kabuki', displayName: '歌舞伎' }),
    }),
  ]);
  const result = filterCatalogEvents(
    [takarazukaEvent, kabukiEvent],
    byId,
    { genre: 'takarazuka', groups: [], venues: [] },
    { groupKeys: [], venues: [] },
  );
  assert.deepEqual(
    result.map((group_) => group_.event.id),
    ['a'],
  );
});

void test('filterCatalogEvents applies group OR selection only within the active genre facet', () => {
  const hana = eventWithOccurrences({ id: 'a' });
  const tsuki = eventWithOccurrences({ id: 'b' });
  const byId = classificationsByEventId([
    classification({ eventId: 'a', genre: genre(), groups: [group({ key: 'hana' })] }),
    classification({
      eventId: 'b',
      genre: genre(),
      groups: [group({ id: 'group-tsuki', key: 'tsuki', displayName: '月組' })],
    }),
  ]);
  const result = filterCatalogEvents(
    [hana, tsuki],
    byId,
    { genre: 'takarazuka', groups: ['hana'], venues: [] },
    { groupKeys: ['hana', 'tsuki'], venues: [] },
  );
  assert.deepEqual(
    result.map((group_) => group_.event.id),
    ['a'],
  );
});

void test('filterCatalogEvents applies venue OR selection from event.venue, independent of classification', () => {
  const venueA = eventWithOccurrences({ id: 'a', venue: '歌舞伎座' });
  const venueB = eventWithOccurrences({ id: 'b', venue: '南座' });
  const byId = classificationsByEventId([
    classification({ eventId: 'a', genre: genre({ key: 'kabuki' }) }),
    classification({ eventId: 'b', genre: genre({ key: 'kabuki' }) }),
  ]);
  const result = filterCatalogEvents(
    [venueA, venueB],
    byId,
    { genre: 'kabuki', groups: [], venues: ['歌舞伎座'] },
    { groupKeys: [], venues: ['歌舞伎座', '南座'] },
  );
  assert.deepEqual(
    result.map((group_) => group_.event.id),
    ['a'],
  );
});

void test('filterCatalogEvents never mutates its input array', () => {
  const events = [eventWithOccurrences({ id: 'a' }), eventWithOccurrences({ id: 'b' })];
  const before = [...events];
  filterCatalogEvents(
    events,
    new Map(),
    { genre: 'takarazuka', groups: [], venues: [] },
    {
      groupKeys: [],
      venues: [],
    },
  );
  assert.deepEqual(events, before);
});
