import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listCatalogGenres,
  listCatalogGroups,
  listCatalogVenues,
  listEventCatalogInRange,
  toReadErrorVariant,
  type EventCatalogEntry,
  type TokyoCalendarDateRange,
} from "@/lib/data";
import { classifyBlock1, type BlockState } from "@/app/_lib/read-state";
import type { CatalogFilterOptions } from "./catalog-filters";

/**
 * `/catalog`'s data layer (`docs/v2/oracle-routes-ui.md` §1 `/catalog`).
 *
 * 2 independent things are loaded, matching the oracle's own §2 distinction
 * between "list read failure blocks everything" (the events list) and
 * "filter read failure only degrades the filter UI, the list still renders"
 * (the genre/group/venue option chain) - these are 2 separate exported
 * loaders for exactly that reason, never combined into one `BlockState`.
 */

export async function loadCatalogEvents(
  supabase: SupabaseClient,
  range: TokyoCalendarDateRange,
): Promise<BlockState<readonly EventCatalogEntry[]>> {
  const result = await listEventCatalogInRange(supabase, range);
  return classifyBlock1(
    result,
    (entries) => entries,
    (entries) => entries.length === 0,
  );
}

export interface CatalogFilterOptionsFailure {
  readonly ok: false;
  readonly variant: "unavailable" | "error";
}

export type CatalogFilterOptionsResult =
  | { readonly ok: true; readonly options: CatalogFilterOptions }
  | CatalogFilterOptionsFailure;

/**
 * "フィルタ機能自体が利用不能" (oracle §2 「イベントカタログ一覧」) -
 * unlike `BlockState`, this has no `empty` variant: 0 known genres/groups/
 * venues just means the filter UI has nothing to offer, which is not a
 * failure (AGENTS.md never treats an empty lookup table as an error state).
 * `ok: false` covers exactly the 2 real failure kinds
 * (`unavailable`/`error`), using `@/lib/data`'s `toReadErrorVariant` (the
 * single canonical failure-kind mapping, PR #381 review finding 3) - kept
 * independent from `BlockState<T>` since this type deliberately excludes
 * `empty`/`populated`, so reusing `BlockState<T>` directly would let a
 * caller mistakenly branch on an `empty` case that can never occur here.
 *
 * Deliberately has no `message` (PR #381 review finding 2): the raw
 * PostgREST/network detail never leaves `@/lib/data`'s read boundary in the
 * first place (`readError()` no longer even accepts one), and the screen
 * (`CatalogView`) owns its own display copy per `variant`.
 */
export async function loadCatalogFilterOptions(
  supabase: SupabaseClient,
): Promise<CatalogFilterOptionsResult> {
  const [genresResult, groupsResult, venuesResult] = await Promise.all([
    listCatalogGenres(supabase),
    listCatalogGroups(supabase),
    listCatalogVenues(supabase),
  ]);

  if (!genresResult.ok) {
    return { ok: false, variant: toReadErrorVariant(genresResult.error.kind) };
  }
  if (!groupsResult.ok) {
    return { ok: false, variant: toReadErrorVariant(groupsResult.error.kind) };
  }
  if (!venuesResult.ok) {
    return { ok: false, variant: toReadErrorVariant(venuesResult.error.kind) };
  }

  return {
    ok: true,
    options: {
      genres: genresResult.value,
      groups: groupsResult.value,
      venues: venuesResult.value,
    },
  };
}
