import type { EventCatalogEntry } from "@/lib/data";
import type { Genre, Group, GroupId } from "@stage-tracker/domain";

/**
 * Client-local catalog filter state. Filter semantics belong to
 * `specs/011-catalog-classification-filter/spec.md`; this module owns the
 * client state mechanics. Genre is single-select (including "すべて" = `null`); group/
 * venue are OR-within-facet multi-select. Persisted to `localStorage` by the
 * caller (`../_components/CatalogView.tsx`) - this module is pure and has
 * no I/O of its own.
 */
export interface CatalogFilterSelection {
  readonly genreKey: string | null;
  readonly groupIds: readonly GroupId[];
  readonly venues: readonly string[];
}

export const DEFAULT_CATALOG_FILTER_SELECTION: CatalogFilterSelection = {
  genreKey: null,
  groupIds: [],
  venues: [],
};

/**
 * group/venue options are scoped by genre under Spec 011's classification
 * semantics: a genre's related groups are derived from the groups actually
 * associated with Events of that genre. The genre `key` is the index
 * にする（M8 で確定した v2 の不具合の修正 - 旧実装は genre 非依存の flat
 * list を全 genre で共有しており、例えば宝塚選択時にアイドルの group まで
 * 選択肢に混ざっていた）。
 */
export interface CatalogFilterOptions {
  readonly genres: readonly Genre[];
  readonly groupsByGenreKey: Readonly<Record<string, readonly Group[]>>;
  readonly venuesByGenreKey: Readonly<Record<string, readonly string[]>>;
}

/** The one secondary facet active for a given genre under Spec 011's current
 * facet topology. `null` for "すべて" or a genre this
 * Task's Gate-A facet table does not name. */
export type CatalogFacet = "group" | "venue" | null;

const GENRE_ACTIVE_FACET: Readonly<Record<string, CatalogFacet>> = {
  takarazuka: "group",
  kabuki: "venue",
  idol: "group",
};

export function activeFacetForGenre(genreKey: string | null): CatalogFacet {
  if (genreKey === null) {
    return null;
  }
  return GENRE_ACTIVE_FACET[genreKey] ?? null;
}

/**
 * Selecting every known option in a facet means "don't filter by this facet"
 * (Spec 011's filter-matching semantics treat no selection and all-known
 * selection as no filtering for that facet).
 *
 * `selectedIds` may contain ids that are not in `knownIds` - most commonly a
 * stale `localStorage`-persisted selection saved before the known-option set
 * for this genre existed in its current (genre-scoped) shape (M8 review
 * finding on this same fix: a pre-fix build's flat, genre-independent
 * option list let a user's saved selection carry ids belonging to a
 * *different* genre). Such a stale id must not count as "still actively
 * narrowing this facet" - it can never match a real entry's classification
 * either way, but if left uncorrected it silently inflates the numerator in
 * the "is every known option selected" comparison below, incorrectly
 * treating a real, intentional partial selection (e.g. 2 of this genre's 3
 * known groups) as if every known option were selected (falsely disabling
 * the filter). Only ids that are still known are counted, both for this
 * "is the facet active" decision and for the actual match below.
 */
export function activeKnownSelection(
  selectedIds: readonly string[],
  knownIds: readonly string[],
): { readonly ids: readonly string[]; readonly isActive: boolean } {
  const known = new Set(knownIds);
  const ids = selectedIds.filter((id) => known.has(id));
  return { ids, isActive: ids.length > 0 && ids.length < knownIds.length };
}

export function matchesCatalogFilter(
  entry: EventCatalogEntry,
  selection: CatalogFilterSelection,
  options: CatalogFilterOptions,
): boolean {
  if (selection.genreKey !== null) {
    if (
      entry.classification.genre === null ||
      entry.classification.genre.key !== selection.genreKey
    ) {
      return false;
    }
  }

  const facet = activeFacetForGenre(selection.genreKey);

  if (facet === "group" && selection.genreKey !== null) {
    const knownGroupIds = (
      options.groupsByGenreKey[selection.genreKey] ?? []
    ).map((group) => group.id);
    const active = activeKnownSelection(selection.groupIds, knownGroupIds);
    if (active.isActive) {
      const selected = new Set(active.ids);
      if (!entry.classification.groupIds.some((id) => selected.has(id))) {
        return false;
      }
    }
  }

  if (facet === "venue" && selection.genreKey !== null) {
    const knownVenues = options.venuesByGenreKey[selection.genreKey] ?? [];
    const active = activeKnownSelection(selection.venues, knownVenues);
    if (active.isActive) {
      if (
        entry.event.venue === null ||
        !active.ids.includes(entry.event.venue)
      ) {
        return false;
      }
    }
  }

  return true;
}

export function filterCatalogEntries(
  entries: readonly EventCatalogEntry[],
  selection: CatalogFilterSelection,
  options: CatalogFilterOptions,
): readonly EventCatalogEntry[] {
  return entries.filter((entry) =>
    matchesCatalogFilter(entry, selection, options),
  );
}

export function isCatalogFilterSelectionActive(
  selection: CatalogFilterSelection,
): boolean {
  return (
    selection.genreKey !== null ||
    selection.groupIds.length > 0 ||
    selection.venues.length > 0
  );
}
