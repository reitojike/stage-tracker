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

import { activeSecondaryFacet } from './catalogFilterSheet.ts';
import {
  matchesCatalogFilter,
  sortGroups,
  type CatalogFilterOptionUniverse,
  type CatalogFilterSelection,
  type EventClassification,
  type EventWithOccurrences,
  type Genre,
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

/**
 * `genre / lower` badge text (Issue #195), reusing #158/#167's canonical
 * genre->facet mapping (activeSecondaryFacet) rather than inventing a
 * per-component notion of "lower" - the same dispatch FilterSheet's own
 * secondary facet section already goes through. `null` for an unclassified
 * Event (no genre), same "unclassified = no badge" contract every existing
 * caller already applies before rendering a Badge at all.
 *
 * The lower dimension is never inferred from title/venue text: a group
 * genre reads its lower value from the Event's own classification.groups
 * (first in #167's canonical sortGroups ordering - "multiple groups"未定義
 * のcopyを作らない), a venue genre reads it from the Event's own `venue`
 * field (venue is Event-level data, not a classification concept - see
 * product-rules.md "Event と公演回の情報境界"). A genre with no configured
 * facet yet, or one whose lower value is absent for this Event, collapses to
 * genre-only rather than a synthetic placeholder.
 */
export function classificationBadgeLabel(
  classification: EventClassification | null,
  venue: string | null,
): string | null {
  if (classification === null || classification.genre === null) {
    return null;
  }
  const genre = classification.genre;

  const facet = activeSecondaryFacet(genre.key);
  const lower =
    facet === null
      ? null
      : facet.kind === 'group'
        ? (sortGroups(classification.groups)[0]?.displayName ?? null)
        : venue;

  return lower === null ? genre.displayName : `${genre.displayName} / ${lower}`;
}

/** The applied-filter summary row's own display data (Issue #195: "絞り込み
 * 中: 宝塚 / 花組・雪組"). `null` when the applied selection has no active
 * genre (すべて) - #158's own "genre自体がfilterである" rule, same condition
 * CatalogView's isFilterActive already checks. */
export interface CatalogFilterSummary {
  genreLabel: string;
  /** Selected secondary values, canonically ordered and joined for display -
   * `null` when the active facet has no selection (すべて/no-op, or a facet
   * with nothing selected), never an empty string. */
  lowerLabel: string | null;
}

/**
 * Derives the summary row's display text from #167's applied
 * CatalogFilterSelection plus the same catalog-wide genre/group/venue option
 * data the caller already holds (never a second, independently-derived
 * source). Secondary values render in the option list's own canonical order
 * (listCatalogGroupOptions/listCatalogVenueOptions already return
 * sortGroups/alphabetical order - see infrastructure/supabase/
 * eventCatalogRead.ts), not `selection.groups`/`selection.venues`' raw
 * (click-order) sequence.
 */
export function catalogFilterSummary(
  selection: CatalogFilterSelection,
  genres: readonly Genre[],
  groupOptionsByGenreKey: Readonly<Record<string, readonly Group[]>>,
  venueOptionsByGenreKey: Readonly<Record<string, readonly string[]>>,
): CatalogFilterSummary | null {
  if (selection.genre === null) {
    return null;
  }
  const genre = genres.find((candidate) => candidate.key === selection.genre) ?? null;
  if (genre === null) {
    return null;
  }

  const facet = activeSecondaryFacet(genre.key);
  let lowerLabel: string | null = null;
  if (facet?.kind === 'group') {
    const selectedKeys = new Set(selection.groups);
    const labels = (groupOptionsByGenreKey[genre.key] ?? [])
      .filter((group) => selectedKeys.has(group.key))
      .map((group) => group.displayName);
    lowerLabel = labels.length > 0 ? labels.join('・') : null;
  } else if (facet?.kind === 'venue') {
    const selectedVenues = new Set(selection.venues);
    const labels = (venueOptionsByGenreKey[genre.key] ?? []).filter((venue) =>
      selectedVenues.has(venue),
    );
    lowerLabel = labels.length > 0 ? labels.join('・') : null;
  }

  return { genreLabel: genre.displayName, lowerLabel };
}
