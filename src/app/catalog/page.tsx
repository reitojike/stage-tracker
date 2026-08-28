import { ActionRow } from '@/ui/ActionRow';
import { LinkButton } from '@/ui/LinkButton';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session';
import {
  listCatalogGenres,
  listEventCatalogInRange,
  type EventCatalogQueryClient,
} from '@/infrastructure/supabase/eventCatalogRead';
import { isDesignatedCatalogCreator } from '@/infrastructure/supabase/eventCatalogWrite';
import { buildMonthGrid } from '@/domain/calendarMonth';
import { tokyoCalendarDateRangeUtc, type EventWithOccurrences } from '@/domain/eventCatalog';
import { resolveCatalogReadState } from '@/domain/catalogReadState';
import {
  catalogInvitationsHref,
  catalogNewEventHref,
  resolveCatalogParams,
} from '@/domain/catalogNavigation';
import { currentTokyoDate } from './_lib/today.ts';
import { loadCatalogFilterData, startCatalogFilterFacetOptions } from './_lib/catalogFilterData.ts';
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
 */
/**
 * The create affordance is shown only to designated catalog creators (Issue
 * #29). A failed or indeterminate membership check hides the link rather
 * than showing one that would only lead to a denial. Kept as its own
 * function so it can run concurrently with the other reads below via
 * Promise.all - getAuthenticatedUser() is React-cache()'d per request (it is
 * already called once from AppShell's AppBar), but isDesignatedCatalogCreator
 * is its own Supabase round trip that must not add sequential latency on top
 * of the catalog range/genre reads.
 */
async function resolveCanCreateEvent(client: EventCatalogQueryClient): Promise<boolean> {
  const user = await getAuthenticatedUser();
  const creatorCheck = user === null ? null : await isDesignatedCatalogCreator(client, user.id);
  return creatorCheck !== null && creatorCheck.ok && creatorCheck.data;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const rawParams = await searchParams;
  const today = currentTokyoDate();
  const { yearMonth, selectedDate } = resolveCatalogParams(rawParams, today);

  const grid = buildMonthGrid(yearMonth);
  const client = await createSupabaseServerClient();
  // #167's catalog-wide genre list -> per-genre group/venue option chain
  // starts immediately, not after the Promise.all below - it only ever
  // depends on genres, never on the catalog range read, so gating it behind
  // that Promise.all (which also awaits the range read, typically this
  // page's slowest query) would delay it until the *slowest* of those
  // unrelated reads finished for no reason. See
  // startCatalogFilterFacetOptions's own doc comment.
  const facetOptionsPromise = startCatalogFilterFacetOptions(client, listCatalogGenres(client));
  // The catalog range read and the creator-permission check are themselves
  // mutually independent of each other and of the facet chain above -
  // running all three concurrently (rather than #145 bolting the new genre
  // read on as an extra sequential `await` after the others) keeps this
  // page's total round-trip depth close to what it was before Issue #145,
  // instead of pushing page render latency past Next's streaming-fallback
  // threshold (this page's own loading.tsx would otherwise start being
  // served as the actual response more often - see
  // test/auth/catalogAccess.test.ts, which asserts on the fully-resolved
  // HTML).
  const [result, canCreateEvent] = await Promise.all([
    listEventCatalogInRange(
      client,
      tokyoCalendarDateRangeUtc(grid.gridFirstDate, grid.gridLastDate),
    ),
    resolveCanCreateEvent(client),
  ]);
  const state = resolveCatalogReadState(result, isEmptyCatalog);

  const actionRow = (
    <ActionRow>
      {canCreateEvent ? (
        <LinkButton href={catalogNewEventHref({ yearMonth, selectedDate })}>+ 追加</LinkButton>
      ) : null}
      <LinkButton href={catalogInvitationsHref()} variant="secondary">
        招待一覧
      </LinkButton>
    </ActionRow>
  );

  if (!result.ok) {
    // A failed catalog read leaves nothing to filter - the filter icon is
    // omitted entirely here (CatalogView is never mounted), same "error
    // blocks everything else" shape the pre-#145 page had.
    return (
      <>
        <PageHeading>イベント</PageHeading>
        {actionRow}
        <StatePanel
          variant="error"
          title="カレンダーを読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
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
      actionRow={actionRow}
      context={{ yearMonth, selectedDate }}
      filterData={filterData}
    />
  );
}
