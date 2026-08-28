// Catalog Filter Sheet state model (Issue #147, product semantics #158).
//
// This module owns the *local UI state* a Filter Sheet needs on top of
// eventCatalog.ts's already-landed (#167) CatalogFilterSelection contract:
// which genre is active, and each genre's own remembered secondary
// (group/venue) selection, so switching genre and back restores it. It
// never reimplements matchesCatalogFilter's OR/AND/none-all semantics -
// toCatalogFilterSelection below only *derives* a CatalogFilterSelection
// from this richer local state; the actual filtering predicate stays
// eventCatalog.ts's alone.
//
// Framework-free (no React/Supabase import) so it is directly unit-testable
// - same convention as domain/triState.ts and domain/eventCatalog.ts.

import { deriveTriState, type TriState } from './triState.ts';
import type { CatalogFilterSelection } from './eventCatalog.ts';

export type CatalogFilterSecondaryFacetKind = 'group' | 'venue';

/**
 * Gate A's fixed genre-key -> active secondary facet mapping (#158 "宝塚 →
 * 組 / 歌舞伎 → 会場 / アイドル → グループ", product-rules.md "Facet model").
 * Keyed by genre.key - the stable canonical identity #167's
 * CatalogFilterSelection.genre itself uses - not the DB id, so this needs no
 * lookup against whatever genre rows a given environment happens to have.
 *
 * Not a schema-level closed world (#158 "この3genreを永久closed worldとして
 * 固定しない"): a genre key absent from this map (a future genre) simply has
 * no active secondary facet yet, rather than the UI inventing one.
 */
const GENRE_FACET_KIND: Readonly<Record<string, CatalogFilterSecondaryFacetKind>> = {
  takarazuka: 'group',
  kabuki: 'venue',
  idol: 'group',
};

/** UI label for each Gate A genre's active facet (product-rules.md "Facet
 * model" table). Separate from GENRE_FACET_KIND's identity mapping so a
 * future genre with, say, a group facet but a different label does not have
 * to fight this table's assumption that facet kind implies label. */
const GENRE_FACET_LABEL: Readonly<Record<string, string>> = {
  takarazuka: '組',
  kabuki: '会場',
  idol: 'グループ',
};

export function secondaryFacetKindForGenreKey(
  genreKey: string | null,
): CatalogFilterSecondaryFacetKind | null {
  if (genreKey === null) {
    return null;
  }
  return GENRE_FACET_KIND[genreKey] ?? null;
}

export function secondaryFacetLabelForGenreKey(genreKey: string | null): string | null {
  if (genreKey === null) {
    return null;
  }
  return GENRE_FACET_LABEL[genreKey] ?? null;
}

/** One selectable secondary-facet row: `value` is the exact-identity value
 * matchesCatalogFilter compares (a group's key, or raw venue text) -
 * `label` is display-only and never itself compared. */
export interface CatalogFilterSecondaryOption {
  value: string;
  label: string;
}

/**
 * Local Filter Sheet state (Issue #147): which genre is active, plus each
 * genre's own remembered secondary selection - richer than
 * eventCatalog.ts's CatalogFilterSelection, which only ever carries the
 * single currently-active facet. Keeping every genre's own selection here
 * (rather than collapsing to just the active one) is what lets switching
 * genre and back restore the prior selection, and what browser-local
 * persistence saves/restores across reload.
 */
export interface CatalogFilterState {
  /** `null` = すべて (no genre filter) - never a synthetic "all" genre key. */
  genre: string | null;
  /** genre key -> that genre's own selected secondary option values. A
   * genre's entry is retained here even while a different genre is active,
   * so it survives being switched away from and back. */
  secondarySelections: Readonly<Record<string, readonly string[]>>;
}

export const EMPTY_CATALOG_FILTER_STATE: CatalogFilterState = {
  genre: null,
  secondarySelections: {},
};

export function selectedSecondaryValues(
  state: CatalogFilterState,
  genreKey: string,
): readonly string[] {
  return state.secondarySelections[genreKey] ?? [];
}

export function withGenre(state: CatalogFilterState, genreKey: string | null): CatalogFilterState {
  return { ...state, genre: genreKey };
}

export function withSecondarySelection(
  state: CatalogFilterState,
  genreKey: string,
  values: readonly string[],
): CatalogFilterState {
  return {
    ...state,
    secondarySelections: { ...state.secondarySelections, [genreKey]: values },
  };
}

export function toggleSecondaryValue(selected: readonly string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((existing) => existing !== value)
    : [...selected, value];
}

/**
 * Aggregate "すべて" control state for a secondary facet section (#147
 * "TriStateCheckboxの扱い": none selected → unchecked, some → indeterminate,
 * all → checked). Reuses domain/triState.ts's deriveTriState over one
 * synthetic checked/unchecked child per known option, rather than
 * re-deriving the same three-way comparison here.
 */
export function secondaryAggregateState(
  selected: readonly string[],
  known: readonly string[],
): TriState {
  return deriveTriState(known.map((value) => (selected.includes(value) ? 'checked' : 'unchecked')));
}

/** What the aggregate control's own onChange (checked/unchecked - it never
 * receives 'indeterminate', see TriStateCheckbox's own contract) should set
 * the facet's full selection to. */
export function applyAggregateToggle(
  known: readonly string[],
  next: 'checked' | 'unchecked',
): string[] {
  return next === 'checked' ? [...known] : [];
}

/**
 * Derives the effective #167 CatalogFilterSelection from local state (Issue
 * #147). Only the *currently active* genre's own facet selection is ever
 * carried into groups/venues - a different genre's remembered selection
 * (kept in `state.secondarySelections` purely so switching back restores
 * it) must never leak into the applied filter while its facet isn't even
 * shown, or matchesCatalogFilter would silently filter by a facet the UI
 * doesn't currently display.
 */
export function toCatalogFilterSelection(state: CatalogFilterState): CatalogFilterSelection {
  const facetKind = secondaryFacetKindForGenreKey(state.genre);
  const selected = state.genre !== null ? selectedSecondaryValues(state, state.genre) : [];
  return {
    genre: state.genre,
    groups: facetKind === 'group' ? selected : [],
    venues: facetKind === 'venue' ? selected : [],
  };
}

/**
 * Drops selected genres/values no longer valid against the current known
 * option universe (Issue #147 "stale saved optionを安全にignore/pruneでき
 * る"), applied independently per genre since each genre's own option
 * universe changes independently:
 *
 * - a saved genre key absent from `knownGenreKeys` falls back to `null`
 *   (すべて) rather than keeping a filter pinned to a genre that no longer
 *   exists.
 * - a genre entirely absent from `knownSecondaryValuesByGenre` (no option
 *   data loaded for it yet) is left untouched - a transient "options still
 *   loading" state must never be misread as "every saved value for this
 *   genre is now stale".
 * - a genre present in `knownSecondaryValuesByGenre` has its saved
 *   selection filtered down to values still in that known set.
 */
export function pruneStaleCatalogFilterState(
  state: CatalogFilterState,
  knownGenreKeys: readonly string[],
  knownSecondaryValuesByGenre: Readonly<Record<string, readonly string[]>>,
): CatalogFilterState {
  const genre = state.genre !== null && knownGenreKeys.includes(state.genre) ? state.genre : null;

  const secondarySelections: Record<string, readonly string[]> = {};
  for (const [genreKey, selected] of Object.entries(state.secondarySelections)) {
    const known = knownSecondaryValuesByGenre[genreKey];
    if (known === undefined) {
      secondarySelections[genreKey] = selected;
      continue;
    }
    const knownSet = new Set(known);
    secondarySelections[genreKey] = selected.filter((value) => knownSet.has(value));
  }

  return { genre, secondarySelections };
}

// ---------------------------------------------------------------------
// Browser-local persistence (Issue #147: "server-side preference
// table/RLSを作らない" - localStorage only). Serialization is deliberately
// defensive: any shape mismatch (foreign data, a future incompatible
// version) falls back to EMPTY_CATALOG_FILTER_STATE rather than throwing -
// a corrupt/foreign stored value must never break the Filter Sheet.

export const CATALOG_FILTER_STORAGE_KEY = 'stage-tracker.catalogFilterSheet.v1';

const STORAGE_VERSION = 1;

export function serializeCatalogFilterState(state: CatalogFilterState): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    genre: state.genre,
    secondarySelections: state.secondarySelections,
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecordOfStringArrays(value: unknown): value is Record<string, readonly string[]> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  for (const entry of Object.values(value)) {
    if (!isStringArray(entry)) {
      return false;
    }
  }
  return true;
}

/**
 * Parses a serializeCatalogFilterState payload back into CatalogFilterState,
 * narrowing the untrusted `JSON.parse` result via type guards (never a type
 * assertion - this repo's lint profile forbids `as`/`<T>` assertions,
 * "narrow unknown instead"). Any parse failure, a missing/mismatched
 * `version`, or a malformed field individually falls back to
 * EMPTY_CATALOG_FILTER_STATE - the caller (FilterSheet) treats "nothing
 * usable was ever saved" and "what was saved doesn't parse" identically.
 */
export function parseCatalogFilterState(raw: string): CatalogFilterState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_CATALOG_FILTER_STATE;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return EMPTY_CATALOG_FILTER_STATE;
  }
  if (!('version' in parsed) || parsed.version !== STORAGE_VERSION) {
    return EMPTY_CATALOG_FILTER_STATE;
  }
  const genre = 'genre' in parsed && typeof parsed.genre === 'string' ? parsed.genre : null;
  const secondarySelections =
    'secondarySelections' in parsed && isRecordOfStringArrays(parsed.secondarySelections)
      ? parsed.secondarySelections
      : {};
  return { genre, secondarySelections };
}
