import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import {
  listCatalogGenres,
  listEventCatalogInRange,
} from '@/infrastructure/supabase/eventCatalogRead';
import { buildMonthGrid } from '@/domain/calendarMonth';
import { tokyoCalendarDateRangeUtc, type EventWithOccurrences } from '@/domain/eventCatalog';
import { resolveCatalogReadState } from '@/domain/catalogReadState';
import { resolveCatalogParams } from '@/domain/catalogNavigation';
import { currentTokyoDate } from './_lib/today.ts';
import { loadCatalogFilterData, startCatalogFilterFacetOptions } from './_lib/catalogFilterData.ts';
import { CatalogReloadButton } from './_components/CatalogReloadButton.tsx';
import { CatalogView } from './_components/CatalogView.tsx';

interface CatalogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isEmptyCatalog = (data: EventWithOccurrences[]) => data.length === 0;

/**
 * Authenticated shared Event catalog, month view (Issue #20, genre/facet
 * filtering added by Issue #145). Reachability is enforced by the existing
 * default-deny boundary (src/proxy.ts) - this page adds no auth logic of its
 * own. Data comes entirely through the #12 typed read layer
 * (listEventCatalogInRange) over a #11 server Supabase client, composed with
 * #167's catalog-wide genre/group/venue/classification reads (see
 * ./_lib/catalogFilterData.ts); RLS is what actually decides who may read
 * what.
 *
 * One read covers the whole displayed grid (including lead/trail days from
 * adjacent months), so both the month markers and the selected-day list
 * (derived from the same result) are consistent with a single round trip.
 * Everything downstream of that read - filter application, and handing the
 * *same* filtered set to every rendered surface - is ./_components/
 * CatalogView.tsx's responsibility (Issue #145's canonical addendum: the
 * applied filter selection only exists client-side, via #147's FilterSheet
 * browser-local persistence, so this server component cannot pre-filter its
 * own read).
 *
 * Issue #195: the "+ 追加" / "招待一覧" ActionRow this screen used to render
 * between the heading and the body is removed - Issue #193's My Page
 * "予定とイベント" section is now the reachable destination for both (creator
 * gating and the invitation route themselves are untouched, only this
 * screen's own duplicate entry point is gone).
 */
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const rawParams = await searchParams;
  const today = currentTokyoDate();
  const { yearMonth, selectedDate } = resolveCatalogParams(rawParams, today);

  const grid = buildMonthGrid(yearMonth);
  const client = await createSupabaseServerClient();
  // #167's catalog-wide genre list -> per-genre group/venue option chain
  // starts immediately, not after the range read below - it only ever
  // depends on genres, never on the catalog range read, so gating it behind
  // that read (typically this page's slowest query) would delay it until
  // the slowest of the two finished for no reason. See
  // startCatalogFilterFacetOptions's own doc comment.
  const facetOptionsPromise = startCatalogFilterFacetOptions(client, listCatalogGenres(client));
  const result = await listEventCatalogInRange(
    client,
    tokyoCalendarDateRangeUtc(grid.gridFirstDate, grid.gridLastDate),
  );
  const state = resolveCatalogReadState(result, isEmptyCatalog);

  if (!result.ok) {
    // A failed catalog read leaves nothing to filter - the filter icon is
    // omitted entirely here (CatalogView is never mounted), same "error
    // blocks everything else" shape the pre-#145 page had. Issue #195/#187
    // canonical read-failure copy + retry action.
    return (
      <>
        <PageHeading>イベント</PageHeading>
        <StatePanel
          variant="error"
          title="読み込めませんでした"
          description="通信状況を確認して、もう一度お試しください"
          action={<CatalogReloadButton />}
        />
      </>
    );
  }

  const events = result.data;
  const eventIds = events.map((group) => group.event.id);
  const filterData = await loadCatalogFilterData(client, eventIds, facetOptionsPromise);

  return (
    <CatalogView
      yearMonth={yearMonth}
      selectedDate={selectedDate}
      todayDate={today}
      events={events}
      isEmptyRange={state === 'empty'}
      context={{ yearMonth, selectedDate }}
      filterData={filterData}
    />
  );
}
