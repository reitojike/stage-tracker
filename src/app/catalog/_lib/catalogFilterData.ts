import type {
  EventCatalogReadResult,
  EventClassification,
  Genre,
  Group,
} from '@/domain/eventCatalog.ts';
import { activeSecondaryFacet } from '@/domain/catalogFilterSheet.ts';
import {
  getEventClassificationsByIds,
  listCatalogGroupOptions,
  listCatalogVenueOptions,
  type EventCatalogQueryClient,
} from '@/infrastructure/supabase/eventCatalogRead.ts';

/**
 * Everything #147's `FilterSheet` and #145's own filtering need beyond the
 * already-fetched Event/Occurrence range read (Issue #145's canonical
 * addendum): catalog-wide genres, each Gate A genre's own catalog-wide
 * secondary (group/venue) options, and the current range's own Event
 * classifications.
 *
 * `ok: false` on *any* constituent read failing (genres, a facet's own
 * option read, or classifications) - a partially-loaded filter is still an
 * unavailable one (Issue #145 "filter unavailable/incomplete であることを
 * 明示"), never silently downgraded to "0 options"/"all unclassified".
 */
export type CatalogFilterData =
  | {
      ok: true;
      genres: Genre[];
      groupOptionsByGenreKey: Record<string, Group[]>;
      venueOptionsByGenreKey: Record<string, string[]>;
      classifications: EventClassification[];
    }
  | { ok: false };

type CatalogFilterFacetOptions =
  | {
      ok: true;
      genres: Genre[];
      groupOptionsByGenreKey: Record<string, Group[]>;
      venueOptionsByGenreKey: Record<string, string[]>;
    }
  | { ok: false };

/**
 * The genre-dependent half of CatalogFilterData - catalog-wide genres plus
 * each Gate A genre's own group/venue options - deliberately split out from
 * classification loading (loadCatalogFilterData below) so a caller can start
 * this the moment it has a `genresResult`, without waiting on anything
 * `eventIds`-shaped first. `genresResult` is caller-supplied (typically
 * `listCatalogGenres(client).then(...)` chained directly, run concurrently
 * with whatever produces the range read this page also needs) rather than
 * issued here, for the same reason: forcing this function to fetch its own
 * genres would serialize it behind whatever the caller awaits before calling
 * it. `activeSecondaryFacet` (domain/catalogFilterSheet.ts) decides, per
 * genre, which of listCatalogGroupOptions/listCatalogVenueOptions applies -
 * Gate A's genre->facet mapping is not re-derived here.
 */
async function loadCatalogFilterFacetOptions(
  client: EventCatalogQueryClient,
  genresResult: EventCatalogReadResult<Genre[]>,
): Promise<CatalogFilterFacetOptions> {
  if (!genresResult.ok) {
    return { ok: false };
  }
  const genres = genresResult.data;

  const facetResults = await Promise.all(
    genres.map(async (genre) => {
      const facet = activeSecondaryFacet(genre.key);
      if (facet === null) {
        return { genreKey: genre.key, kind: null };
      }
      if (facet.kind === 'group') {
        return {
          genreKey: genre.key,
          kind: 'group' as const,
          result: await listCatalogGroupOptions(client, genre.id),
        };
      }
      return {
        genreKey: genre.key,
        kind: 'venue' as const,
        result: await listCatalogVenueOptions(client, genre.id),
      };
    }),
  );

  const groupOptionsByGenreKey: Record<string, Group[]> = {};
  const venueOptionsByGenreKey: Record<string, string[]> = {};
  for (const facetResult of facetResults) {
    if (facetResult.kind === null) {
      continue;
    }
    if (!facetResult.result.ok) {
      return { ok: false };
    }
    if (facetResult.kind === 'group') {
      groupOptionsByGenreKey[facetResult.genreKey] = facetResult.result.data;
    } else {
      venueOptionsByGenreKey[facetResult.genreKey] = facetResult.result.data;
    }
  }

  return { ok: true, genres, groupOptionsByGenreKey, venueOptionsByGenreKey };
}

/**
 * Starts the genre-dependent facet-option chain (listCatalogGenres ->
 * listCatalogGroupOptions/listCatalogVenueOptions per genre) immediately,
 * without waiting for anything else - a caller passes this straight through
 * to loadCatalogFilterData below once it also has `eventIds`. Exists so
 * page.tsx can kick this off before (not after) its own
 * `Promise.all([listEventCatalogInRange(...), ...])`: awaiting `genresResult`
 * only once that whole Promise.all had already settled would delay this
 * chain until the *slowest* of those unrelated reads finished, even though
 * it only ever depended on genres.
 */
export function startCatalogFilterFacetOptions(
  client: EventCatalogQueryClient,
  genresResult: Promise<EventCatalogReadResult<Genre[]>>,
): Promise<CatalogFilterFacetOptions> {
  return genresResult.then((resolved) => loadCatalogFilterFacetOptions(client, resolved));
}

/**
 * Combines an already-started facet-options chain (startCatalogFilterFacetOptions)
 * with the current range read's own Event classifications
 * (getEventClassificationsByIds, which does need `eventIds` and therefore
 * cannot start until the range read itself has resolved) into the full
 * CatalogFilterData the client integration boundary consumes. Both reads run
 * concurrently here - `facetOptions` is often already resolved by the time a
 * caller reaches this point (see startCatalogFilterFacetOptions's own doc
 * comment for why it was started earlier).
 */
export async function loadCatalogFilterData(
  client: EventCatalogQueryClient,
  eventIds: readonly string[],
  facetOptionsPromise: Promise<CatalogFilterFacetOptions>,
): Promise<CatalogFilterData> {
  const [facetOptions, classificationsResult] = await Promise.all([
    facetOptionsPromise,
    getEventClassificationsByIds(client, eventIds),
  ]);
  if (!facetOptions.ok || !classificationsResult.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    genres: facetOptions.genres,
    groupOptionsByGenreKey: facetOptions.groupOptionsByGenreKey,
    venueOptionsByGenreKey: facetOptions.venueOptionsByGenreKey,
    classifications: classificationsResult.data,
  };
}
