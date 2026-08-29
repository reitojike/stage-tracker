import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classificationBadgeLabel,
  classificationsByEventId,
  catalogFilterOptionUniverseForGenre,
  catalogFilterSummary,
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

// --- classificationBadgeLabel (Issue #195: "genre / lower") ---

void test('classificationBadgeLabel returns null for an unclassified event (no classification at all)', () => {
  assert.equal(classificationBadgeLabel(null, null), null);
});

void test('classificationBadgeLabel returns null when classification exists but genre is null', () => {
  assert.equal(classificationBadgeLabel(classification({ genre: null }), null), null);
});

void test('classificationBadgeLabel returns genre-only for a group-facet genre with no groups', () => {
  const label = classificationBadgeLabel(classification({ genre: genre(), groups: [] }), null);
  assert.equal(label, '宝塚');
});

void test('classificationBadgeLabel appends the first canonically-ordered group for a group-facet genre', () => {
  const label = classificationBadgeLabel(
    classification({
      genre: genre(),
      groups: [
        group({ id: 'group-yuki', key: 'yuki', displayName: '雪組' }),
        group({ id: 'group-hana', key: 'hana', displayName: '花組' }),
      ],
    }),
    null,
  );
  // sortGroups orders by displayName then id - 花組 sorts before 雪組
  // regardless of the input array's own order, and never both are joined.
  assert.equal(label, '宝塚 / 花組');
});

void test('classificationBadgeLabel reads the venue-facet lower value from the Event.venue field, never classification.groups', () => {
  const kabuki = genre({ id: 'genre-kabuki', key: 'kabuki', displayName: '歌舞伎' });
  const label = classificationBadgeLabel(
    classification({ genre: kabuki, groups: [group()] }),
    '歌舞伎座',
  );
  assert.equal(label, '歌舞伎 / 歌舞伎座');
});

void test('classificationBadgeLabel collapses to genre-only when a venue-facet genre has no Event venue', () => {
  const kabuki = genre({ id: 'genre-kabuki', key: 'kabuki', displayName: '歌舞伎' });
  const label = classificationBadgeLabel(classification({ genre: kabuki }), null);
  assert.equal(label, '歌舞伎');
});

// --- catalogFilterSummary (Issue #195: applied-filter summary row text) ---

void test('catalogFilterSummary returns null for すべて (no active genre)', () => {
  const summary = catalogFilterSummary({ genre: null, groups: [], venues: [] }, [genre()], {}, {});
  assert.equal(summary, null);
});

void test('catalogFilterSummary returns null when the selected genre key is not among the known genres', () => {
  const summary = catalogFilterSummary(
    { genre: 'unknown-genre', groups: [], venues: [] },
    [genre()],
    {},
    {},
  );
  assert.equal(summary, null);
});

void test('catalogFilterSummary returns genreLabel with a null lowerLabel when no secondary value is selected', () => {
  const summary = catalogFilterSummary(
    { genre: 'takarazuka', groups: [], venues: [] },
    [genre()],
    { takarazuka: [group()] },
    {},
  );
  assert.deepEqual(summary, { genreLabel: '宝塚', lowerLabel: null });
});

void test('catalogFilterSummary joins multiple selected groups in the catalog-wide canonical option order, not selection click order', () => {
  const hana = group({ key: 'hana', displayName: '花組' });
  const yuki = group({ id: 'group-yuki', key: 'yuki', displayName: '雪組' });
  const summary = catalogFilterSummary(
    // Selected in click order 雪組 then 花組 - the option list itself
    // (already sorted, per listCatalogGroupOptions) decides display order.
    { genre: 'takarazuka', groups: ['yuki', 'hana'], venues: [] },
    [genre()],
    { takarazuka: [hana, yuki] },
    {},
  );
  assert.deepEqual(summary, { genreLabel: '宝塚', lowerLabel: '花組・雪組' });
});

void test('catalogFilterSummary joins selected venue text for a venue-facet genre', () => {
  const kabuki = genre({ id: 'genre-kabuki', key: 'kabuki', displayName: '歌舞伎' });
  const summary = catalogFilterSummary(
    { genre: 'kabuki', groups: [], venues: ['歌舞伎座'] },
    [kabuki],
    {},
    { kabuki: ['歌舞伎座', '南座'] },
  );
  assert.deepEqual(summary, { genreLabel: '歌舞伎', lowerLabel: '歌舞伎座' });
});
