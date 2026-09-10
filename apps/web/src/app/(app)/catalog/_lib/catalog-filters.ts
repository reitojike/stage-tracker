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
 * 場合は、どちらも「その facet では絞り込まない」と解釈").
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
function activeKnownSelection(
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

/**
 * Flattens `CatalogFilterOptions.groupsByGenreKey` into a single
 * `GroupId -> displayName` lookup, for displaying an entry's own
 * `classification.groupIds` on its card (this Task's confirmed-gap fix -
 * `EventCatalogEntry.classification` only carries `groupIds` (plain ids,
 * 0..N), not resolved `Group` rows, matching `@stage-tracker/domain`'s
 * `EventClassification` doc comment: "the caller joins against a
 * separately-read catalog-wide Group lookup...to get display names,
 * mirroring how the Group lookup itself is genre-independent").
 *
 * A `Group`'s canonical identity is genre-independent (AGENTS.md "Group":
 * "group は特定 genre へ hard-bind されません"), so flattening across every
 * genre key and de-duplicating by id is correct - the same group can only
 * ever resolve to the same displayName regardless of which genre's option
 * chain it was reached through.
 *
 * Coverage caveat (documented, not fixed here - out of this Task's scope):
 * `groupsByGenreKey` is itself derived from `listCatalogGroups(genreId)`,
 * which only returns groups actually associated with an Event of that
 * genre (`../../_lib`'s own "Filter option universe" contract). An Event
 * with a group but *no* genre (classification-wise possible per AGENTS.md
 * "Group", even if the current operator-import flow does not produce this
 * combination) would not resolve here - the same limitation the existing
 * genre-scoped filter option chain already has.
 */
export function groupDisplayNameById(
  options: CatalogFilterOptions,
): ReadonlyMap<GroupId, string> {
  const byId = new Map<GroupId, string>();
  for (const groups of Object.values(options.groupsByGenreKey)) {
    for (const group of groups) {
      byId.set(group.id, group.displayName);
    }
  }
  return byId;
}
