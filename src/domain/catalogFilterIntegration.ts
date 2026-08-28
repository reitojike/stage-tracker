// Catalog filter <-> Event set integration (Issue #145, canonical addendum
// "client/server integration boundary after #147 landing").
//
// This module is the one place #145 composes #167's typed classification
// projection (EventClassification) with #167's own pure filter predicate
// (matchesCatalogFilter) against a fetched EventWithOccurrences[] set. It
// reimplements none of matchesCatalogFilter's OR/AND/none-all semantics -
// every function here is either a lookup composition or a thin `.filter`
// wrapper around that predicate, kept pure/framework-free (no React/Supabase
// import) so it is directly unit-testable, same convention as the rest of
// src/domain.
//
// The point of pulling this out of the client component (rather than
// inlining these three operations in CatalogView.tsx) is that "same filtered
// Event set reaches MonthCalendar/EventLevelFallbackList/SelectedDayList" -
// the split-brain #145's Issue body explicitly forbids - is easiest to keep
// true by construction when it is produced by one pure, tested function
// rather than re-derived inline in a component body.

import {
  matchesCatalogFilter,
  type CatalogFilterOptionUniverse,
  type CatalogFilterSelection,
  type EventClassification,
  type EventWithOccurrences,
  type Group,
} from './eventCatalog.ts';

/**
 * Keys #167's getEventClassificationsByIds result by event id, for O(1)
 * lookup while filtering/rendering. An event id absent from `classifications`
 * (never fetched, or the read failed for it) is simply absent from the
 * returned map - callers must treat a missing entry the same as an event
 * with no classification (`classification: null`), never as an error on its
 * own; see filterCatalogEvents below.
 */
export function classificationsByEventId(
  classifications: readonly EventClassification[],
): Map<string, EventClassification> {
  return new Map(classifications.map((classification) => [classification.eventId, classification]));
}

/**
 * The catalog-wide known-option universe for whichever genre is currently
 * selected (#167 "Catalog-wide filter options"), derived from the same
 * genre-keyed group/venue option maps the caller also hands to #147's
 * FilterSheet - never a second, independently-fetched source. `genreKey ===
 * null` (すべて) has no active secondary facet, so its universe is empty on
 * both axes; matchesCatalogFilter never consults either axis in that case
 * since `selection.groups`/`selection.venues` are also empty for すべて (see
 * domain/catalogFilterSheet.ts's toCatalogFilterSelection).
 */
export function catalogFilterOptionUniverseForGenre(
  genreKey: string | null,
  groupOptionsByGenreKey: Readonly<Record<string, readonly Group[]>>,
  venueOptionsByGenreKey: Readonly<Record<string, readonly string[]>>,
): CatalogFilterOptionUniverse {
  if (genreKey === null) {
    return { groupKeys: [], venues: [] };
  }
  return {
    groupKeys: (groupOptionsByGenreKey[genreKey] ?? []).map((group) => group.key),
    venues: venueOptionsByGenreKey[genreKey] ?? [],
  };
}

/**
 * The one filtered Event set every Catalog surface (MonthCalendar via
 * buildMonthCalendarViewModel, EventLevelFallbackList via
 * selectEventLevelFallback, SelectedDayList via selectDayOccurrences) is
 * built from - callers must pass this same result to all three rather than
 * filtering independently per surface, which is what #145's Issue body's
 * "split-brain" prohibition actually requires in code. An event id with no
 * entry in `classificationByEventId` (never classified, or that id's
 * classification failed to load) is treated as `classification: null` - the
 * same "unclassified" state #158 defines as valid, never as a reason to drop
 * the event from every genre including すべて.
 */
export function filterCatalogEvents(
  events: readonly EventWithOccurrences[],
  classificationByEventId: ReadonlyMap<string, EventClassification>,
  selection: CatalogFilterSelection,
  universe: CatalogFilterOptionUniverse,
): EventWithOccurrences[] {
  return events.filter(({ event }) =>
    matchesCatalogFilter(
      { classification: classificationByEventId.get(event.id) ?? null, venue: event.venue },
      selection,
      universe,
    ),
  );
}
