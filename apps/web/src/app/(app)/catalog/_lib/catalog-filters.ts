import type { EventCatalogEntry } from "@/lib/data";
import type { Genre, Group, GroupId } from "@stage-tracker/domain";

/**
 * Client-local catalog filter state (`docs/v2/oracle-routes-ui.md` §2
 * 「イベントカタログ一覧」, AGENTS.md "Catalog classification / venue
 * boundary"). Genre is single-select (including "すべて" = `null`); group/
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
 * group/venue option は genre ごとにスコープする（AGENTS.md「Group」:
 * 「この genre に関連する group」は、その genre の Event に実際に
 * associate されている group から動的に導出する）。genre の `key` を index
 * にする（M8 で確定した v2 の不具合の修正 - 旧実装は genre 非依存の flat
 * list を全 genre で共有しており、例えば宝塚選択時にアイドルの group まで
 * 選択肢に混ざっていた）。
 */
export interface CatalogFilterOptions {
  readonly genres: readonly Genre[];
  readonly groupsByGenreKey: Readonly<Record<string, readonly Group[]>>;
  readonly venuesByGenreKey: Readonly<Record<string, readonly string[]>>;
}

/** The 1 secondary facet active for a given genre (AGENTS.md "Facet model
 * (genreごとに有効なsecondary facet)"). `null` for "すべて" or a genre this
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
 * (AGENTS.md "Filter semantics": "何も選択していない場合と...全選択している
 * 場合は、どちらも「その facet では絞り込まない」と解釈"). This assumes
 * `selectedIds` is always a subset of `knownIds` (true for any selection the
 * UI itself can produce, since it only ever toggles from the known option
 * list) - `>=` therefore back-stops the well-formed "size" comparison
 * without needing a full set-equality check.
 */
function isFacetFilterActive(
  selectedIds: readonly string[],
  knownIds: readonly string[],
): boolean {
  return selectedIds.length > 0 && selectedIds.length < knownIds.length;
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
    if (isFacetFilterActive(selection.groupIds, knownGroupIds)) {
      const selected = new Set(selection.groupIds);
      if (!entry.classification.groupIds.some((id) => selected.has(id))) {
        return false;
      }
    }
  }

  if (facet === "venue" && selection.genreKey !== null) {
    const knownVenues = options.venuesByGenreKey[selection.genreKey] ?? [];
    if (isFacetFilterActive(selection.venues, knownVenues)) {
      if (
        entry.event.venue === null ||
        !selection.venues.includes(entry.event.venue)
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
