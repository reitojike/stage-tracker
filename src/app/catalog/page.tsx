import { ActionRow } from '@/ui/ActionRow';
import { LinkButton } from '@/ui/LinkButton';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session';
import { listEventCatalogInRange } from '@/infrastructure/supabase/eventCatalogRead';
import { isDesignatedCatalogCreator } from '@/infrastructure/supabase/eventCatalogWrite';
import {
  buildMonthCalendarViewModel,
  buildMonthGrid,
  selectDayOccurrences,
} from '@/domain/calendarMonth';
import { tokyoCalendarDateRangeUtc, type EventWithOccurrences } from '@/domain/eventCatalog';
import { resolveCatalogReadState } from '@/domain/catalogReadState';
import {
  catalogInvitationsHref,
  catalogNewEventHref,
  resolveCatalogParams,
} from '@/domain/catalogNavigation';
import { currentTokyoDate } from './_lib/today.ts';
import { MonthCalendar } from './_components/MonthCalendar.tsx';
import { RangeOnlyEventList } from './_components/RangeOnlyEventList.tsx';
import { SelectedDayList } from './_components/SelectedDayList.tsx';

interface CatalogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isEmptyCatalog = (data: EventWithOccurrences[]) => data.length === 0;

/**
 * Authenticated shared Event catalog, month view (Issue #20). Reachability
 * is enforced by the existing default-deny boundary (src/proxy.ts) - this
 * page adds no auth logic of its own. Data comes entirely through the #12
 * typed read layer (listEventCatalogInRange) over a #11 server Supabase
 * client; RLS is what actually decides who may read what.
 *
 * One read covers the whole displayed grid (including lead/trail days from
 * adjacent months), so both the month markers and the selected-day list
 * (derived from the same result, see selectDayOccurrences) are consistent
 * with a single round trip.
 */
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const rawParams = await searchParams;
  const today = currentTokyoDate();
  const { yearMonth, selectedDate } = resolveCatalogParams(rawParams, today);

  const grid = buildMonthGrid(yearMonth);
  const client = await createSupabaseServerClient();
  const result = await listEventCatalogInRange(
    client,
    tokyoCalendarDateRangeUtc(grid.gridFirstDate, grid.gridLastDate),
  );
  const state = resolveCatalogReadState(result, isEmptyCatalog);

  // The create affordance is shown only to designated catalog creators
  // (Issue #29). A failed or indeterminate membership check hides the
  // link rather than showing one that would only lead to a denial - the
  // shared catalog read above is unaffected either way, so this never
  // degrades what a non-creator can see.
  const user = await getAuthenticatedUser();
  const creatorCheck = user === null ? null : await isDesignatedCatalogCreator(client, user.id);
  const canCreateEvent = creatorCheck !== null && creatorCheck.ok && creatorCheck.data;

  return (
    <>
      <PageHeading>Event Catalog</PageHeading>

      <ActionRow>
        {canCreateEvent ? (
          <LinkButton href={catalogNewEventHref({ yearMonth, selectedDate })}>
            + イベントを登録
          </LinkButton>
        ) : null}
        <LinkButton href={catalogInvitationsHref()} variant="secondary">
          招待一覧を見る
        </LinkButton>
      </ActionRow>

      {state === 'error' ? (
        <StatePanel
          variant="error"
          title="カレンダーを読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      ) : null}

      {result.ok ? (
        <>
          <MonthCalendar
            viewModel={buildMonthCalendarViewModel(yearMonth, result.data)}
            selectedDate={selectedDate}
            todayDate={today}
          />

          {/* Issue #88: a 0-occurrence event (or one with no occurrence in
              this month specifically) never appears in MonthCalendar,
              which is entirely occurrence-driven (bands/badges) - without
              this, such an event would make result.data non-empty (no
              "この月に登録されている公演はありません" below) while still
              rendering nothing at all. Shown unconditionally on the month
              landing view, not gated behind selecting a day. */}
          <RangeOnlyEventList events={result.data} context={{ yearMonth, selectedDate }} />

          {state === 'empty' && selectedDate === null ? (
            <StatePanel variant="empty" title="この月に登録されている公演はありません" />
          ) : null}

          {selectedDate !== null ? (
            <SelectedDayList
              date={selectedDate}
              occurrences={selectDayOccurrences(result.data, selectedDate)}
              context={{ yearMonth, selectedDate }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
