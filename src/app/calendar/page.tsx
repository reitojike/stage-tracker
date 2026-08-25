import { ActionRow } from '@/ui/ActionRow';
import { LinkButton } from '@/ui/LinkButton';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { requireAuthenticatedUserId } from '@/infrastructure/supabase/planningAuth.ts';
import { listMyParticipations } from '@/infrastructure/supabase/participation.ts';
import { listVisiblePersonalSchedule } from '@/infrastructure/supabase/personalSchedule.ts';
import { listMyAcquisitions } from '@/infrastructure/supabase/ticketAcquisition.ts';
import { getEventsByIds, getOccurrencesByIds } from '@/infrastructure/supabase/eventCatalogRead.ts';
import { groupOccurrencesByEvent } from '@/domain/eventCatalog.ts';
import { buildMonthGrid } from '@/domain/calendarMonth.ts';
import {
  buildMyCalendarDayMarkers,
  buildMyCalendarOccurrenceEntries,
  isOccurrenceStartUtcDateInGridSuperset,
  selectMyCalendarOccurrenceEntries,
  selectMyCalendarScheduleEntries,
} from '@/domain/myCalendar.ts';
import { resolveMyCalendarParams } from '@/domain/myCalendarNavigation.ts';
import type { Participation } from '@/domain/participation.ts';
import type { TicketAcquisition } from '@/domain/ticketAcquisition.ts';
import type { PlanningError } from '@/domain/planningError.ts';
import { currentTokyoDate } from './_lib/today.ts';
import { MyMonthCalendar } from './_components/MyMonthCalendar.tsx';
import { MySelectedDayList } from './_components/MySelectedDayList.tsx';

interface MyCalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const AUTH_FAILURE_PANEL: Record<
  'unauthenticated' | 'failure',
  { title: string; description: string }
> = {
  unauthenticated: {
    title: 'ログインが必要です',
    description: 'セッションの有効期限が切れている可能性があります。再度ログインしてください。',
  },
  failure: {
    title: 'マイカレンダーを読み込めませんでした',
    description: '通信状況を確認し、もう一度お試しください。',
  },
};

function authOrReadErrorPanel(error: PlanningError) {
  const key = error.kind === 'unauthenticated' ? 'unauthenticated' : 'failure';
  return (
    <StatePanel
      variant="error"
      title={AUTH_FAILURE_PANEL[key].title}
      description={AUTH_FAILURE_PANEL[key].description}
    />
  );
}

/**
 * My Calendar (Issue #34): merges participation-registered occurrences,
 * event-independent personal schedule (own + shared), and ticket
 * acquisition state into one month view + selected-day detail, following
 * the same "month calendar -> selected-day list" pattern
 * src/app/catalog/page.tsx already established (docs/ux-ui.md primary
 * interaction pattern).
 *
 * Every read here goes through a typed src/infrastructure/supabase/
 * module; RLS is what actually enforces who may see what (see each
 * module's own header). This page adds no permission judgment of its own -
 * it only composes what those reads return via src/domain/myCalendar.ts.
 *
 * Auth/read failures are surfaced as a distinct `error` StatePanel, never
 * silently collapsed into the same "no data" empty state a genuinely
 * empty calendar would show (docs/ux-ui.md "Common states": "RLS等の
 * silent failureをempty UIとして誤表示する設計を避ける").
 */
export default async function MyCalendarPage({ searchParams }: MyCalendarPageProps) {
  const rawParams = await searchParams;
  const today = currentTokyoDate();
  const { yearMonth, selectedDate } = resolveMyCalendarParams(rawParams, today);
  const grid = buildMonthGrid(yearMonth);
  const gridDates = grid.weeks.flat();

  const client = await createSupabaseServerClient();
  const callerResult = await requireAuthenticatedUserId(client);

  if (!callerResult.ok) {
    return (
      <>
        <PageHeading>マイカレンダー</PageHeading>
        {authOrReadErrorPanel(callerResult.error)}
      </>
    );
  }
  const callerId = callerResult.data;

  const [participationsResult, scheduleResult, acquisitionsResult] = await Promise.all([
    listMyParticipations(client),
    listVisiblePersonalSchedule(client),
    listMyAcquisitions(client),
  ]);

  const firstError = !participationsResult.ok
    ? participationsResult.error
    : !scheduleResult.ok
      ? scheduleResult.error
      : !acquisitionsResult.ok
        ? acquisitionsResult.error
        : null;
  if (
    firstError !== null ||
    !participationsResult.ok ||
    !scheduleResult.ok ||
    !acquisitionsResult.ok
  ) {
    return (
      <>
        <PageHeading>マイカレンダー</PageHeading>
        {firstError !== null ? authOrReadErrorPanel(firstError) : null}
      </>
    );
  }

  const participations: Participation[] = participationsResult.data;
  const acquisitions: TicketAcquisition[] = acquisitionsResult.data;

  const occurrenceIds = [...new Set(participations.map((p) => p.occurrenceId))];
  const occurrencesResult =
    occurrenceIds.length === 0
      ? { ok: true as const, data: [] }
      : await getOccurrencesByIds(client, occurrenceIds);
  if (!occurrencesResult.ok) {
    return (
      <>
        <PageHeading>マイカレンダー</PageHeading>
        <StatePanel
          variant="error"
          title="マイカレンダーを読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      </>
    );
  }

  // Only occurrences that actually fall within the displayed grid
  // (including lead/trail days) - matching listEventCatalogInRange's own
  // "only what's in range is attached" convention. Plain string
  // comparison is safe here: both sides are "YYYY-MM-DD" calendar dates
  // derived the same way calendarMonth.ts derives grid dates.
  const gridFirstDate = grid.gridFirstDate;
  const gridLastDate = grid.gridLastDate;
  // A coarse pre-filter only (see isOccurrenceStartUtcDateInGridSuperset's
  // own header for why this needs to be a safe superset, not exact) - the
  // authoritative per-day membership used for rendering is always
  // tokyoCalendarDateFromInstant, applied inside
  // selectMyCalendarOccurrenceEntries/buildMyCalendarDayMarkers below.
  const occurrencesInGrid = occurrencesResult.data.filter((occurrence) =>
    isOccurrenceStartUtcDateInGridSuperset(occurrence.startsAt, gridFirstDate, gridLastDate),
  );

  const eventIds = [...new Set(occurrencesInGrid.map((occurrence) => occurrence.eventId))];
  const eventsResult =
    eventIds.length === 0
      ? { ok: true as const, data: [] }
      : await getEventsByIds(client, eventIds);
  if (!eventsResult.ok) {
    return (
      <>
        <PageHeading>マイカレンダー</PageHeading>
        <StatePanel
          variant="error"
          title="マイカレンダーを読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      </>
    );
  }

  const eventsWithOccurrences = groupOccurrencesByEvent(eventsResult.data, occurrencesInGrid);

  const participationsByOccurrenceId = new Map(
    participations.map((p) => [p.occurrenceId, p] as const),
  );
  const acquisitionsByOccurrenceId = new Map<string, TicketAcquisition[]>();
  for (const acquisition of acquisitions) {
    const bucket = acquisitionsByOccurrenceId.get(acquisition.occurrenceId);
    if (bucket) {
      bucket.push(acquisition);
    } else {
      acquisitionsByOccurrenceId.set(acquisition.occurrenceId, [acquisition]);
    }
  }

  const occurrenceEntries = buildMyCalendarOccurrenceEntries(
    eventsWithOccurrences,
    participationsByOccurrenceId,
    acquisitionsByOccurrenceId,
  );

  const dayMarkers = buildMyCalendarDayMarkers(
    gridDates,
    occurrenceEntries,
    scheduleResult.data,
    callerId,
  );
  const markersByDate = new Map(dayMarkers.map((m) => [m.date, m] as const));

  // Emptiness is judged only over dates actually inside the displayed
  // month, not the lead/trail adjacent-month cells `dayMarkers` also
  // carries (see buildMyCalendarDayMarkers's own header - it spans the
  // whole grid, including days outside `yearMonth`). A marker on an
  // adjacent-month lead/trail cell must not suppress "この月に登録され
  // ている予定はありません" for an otherwise-empty displayed month.
  const isEmpty = dayMarkers
    .filter((m) => m.date.startsWith(yearMonth))
    .every(
      (m) =>
        m.attendingCount === 0 &&
        m.consideringCount === 0 &&
        m.ownScheduleCount === 0 &&
        m.sharedScheduleCount === 0,
    );

  // Same displayed-month scoping as isEmpty above (not the lead/trail
  // adjacent-month cells): true when any date actually inside `yearMonth`
  // falls outside the Japanese-holiday snapshot's confirmed coverage, so
  // MyMonthCalendar can show a non-color "holiday status unconfirmed"
  // notice rather than silently rendering those dates as ordinary/
  // confirmed-non-holiday days (PO adjudication, Issue #34).
  const hasUnconfirmedHolidayCoverage = dayMarkers
    .filter((m) => m.date.startsWith(yearMonth))
    .some((m) => !m.holidayDataConfirmed);

  return (
    <>
      <PageHeading>マイカレンダー</PageHeading>
      <ActionRow>
        <LinkButton href="/schedule" variant="secondary">
          個人予定を管理
        </LinkButton>
      </ActionRow>

      <MyMonthCalendar
        yearMonth={yearMonth}
        gridWeeks={grid.weeks}
        markersByDate={markersByDate}
        selectedDate={selectedDate}
        todayDate={today}
        hasUnconfirmedHolidayCoverage={hasUnconfirmedHolidayCoverage}
      />

      {isEmpty && selectedDate === null ? (
        <StatePanel variant="empty" title="この月に登録されている予定はありません" />
      ) : null}

      {selectedDate !== null ? (
        <MySelectedDayList
          date={selectedDate}
          occurrenceEntries={selectMyCalendarOccurrenceEntries(occurrenceEntries, selectedDate)}
          scheduleEntries={selectMyCalendarScheduleEntries(
            scheduleResult.data,
            callerId,
            selectedDate,
            gridFirstDate,
            gridLastDate,
          )}
          eventDetailContext={{ yearMonth, selectedDate }}
        />
      ) : null}
    </>
  );
}
