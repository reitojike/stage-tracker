import type { SupabaseClient } from "@supabase/supabase-js";
import type { Group } from "@stage-tracker/domain";
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
import {
  activeFacetForGenre,
  type CatalogFilterOptions,
} from "./catalog-filters";

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
 *
 * group/venue はそれぞれの genre にスコープして読む（M8 で確定した v2 の
 * 不具合の修正、`catalog-filters.ts`「CatalogFilterOptions」参照）。genre
 * 一覧を先に読み、`activeFacetForGenre` が返す facet（宝塚/アイドル=group、
 * 歌舞伎=venue）に応じて genre ごとに 1 回だけ group か venue のどちらかを
 * 読む。facet を持たない genre は追加の読み取りを発生させない。
 */
export async function loadCatalogFilterOptions(
  supabase: SupabaseClient,
): Promise<CatalogFilterOptionsResult> {
  const genresResult = await listCatalogGenres(supabase);
  if (!genresResult.ok) {
    return { ok: false, variant: toReadErrorVariant(genresResult.error.kind) };
  }
  const genres = genresResult.value;

  const facetResults = await Promise.all(
    genres.map(async (genre) => {
      const facet = activeFacetForGenre(genre.key);
      if (facet === "group") {
        return {
          genre,
          kind: "group" as const,
          result: await listCatalogGroups(supabase, genre.id),
        };
      }
      if (facet === "venue") {
        return {
          genre,
          kind: "venue" as const,
          result: await listCatalogVenues(supabase, genre.id),
        };
      }
      return { genre, kind: null };
    }),
  );

  const groupsByGenreKey: Record<string, Group[]> = {};
  const venuesByGenreKey: Record<string, string[]> = {};
  for (const facetResult of facetResults) {
    if (facetResult.kind === null) {
      continue;
    }
    if (!facetResult.result.ok) {
      return {
        ok: false,
        variant: toReadErrorVariant(facetResult.result.error.kind),
      };
    }
    if (facetResult.kind === "group") {
      groupsByGenreKey[facetResult.genre.key] = [...facetResult.result.value];
    } else {
      venuesByGenreKey[facetResult.genre.key] = [...facetResult.result.value];
    }
  }

  return {
    ok: true,
    options: { genres, groupsByGenreKey, venuesByGenreKey },
  };
}
