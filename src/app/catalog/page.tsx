import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { listEventCatalogInRange } from '@/infrastructure/supabase/eventCatalogRead';
import {
  buildMonthCalendarViewModel,
  buildMonthGrid,
  selectDayOccurrences,
} from '@/domain/calendarMonth';
import { tokyoCalendarDateRangeUtc, type EventWithOccurrences } from '@/domain/eventCatalog';
import { resolveCatalogReadState } from '@/domain/catalogReadState';
import { resolveCatalogParams } from '@/domain/catalogNavigation';
import { currentTokyoDate } from './_lib/today.ts';
import { MonthCalendar } from './_components/MonthCalendar.tsx';
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

  return (
    <main>
      <h1>Event Catalog</h1>

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
    </main>
  );
}
