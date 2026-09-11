import { StatePanel } from "@stage-tracker/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { resolveScreenNow } from "@/app/_lib/now";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import {
  buildMonthGridDays,
  resolveCalendarMonthAndDate,
  tokyoYearMonthOf,
} from "@/app/_lib/calendar-grid";
import {
  loadCalendarOccurrences,
  loadCalendarSchedule,
} from "./_lib/calendar-loader";
import { CalendarView } from "./_components/CalendarView";

interface CalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `/calendar` (`docs/v2/oracle-routes-ui.md` §1 `/calendar`). Read-only - no
 * Server Action/mutation on this screen (this Task's scope).
 */
export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  const supabase = await createSupabaseServerClient();
  const userResult = await requireAuthenticatedUserId(supabase);

  if (!userResult.ok) {
    return userResult.error.kind === "unauthenticated" ? (
      <StatePanel variant="unavailable" title="サインインが必要です" />
    ) : (
      <StatePanel
        variant="error"
        title="カレンダーを読み込めませんでした"
        description={READ_FAILURE_RETRY_HINT_JA}
      />
    );
  }

  const now = resolveScreenNow();
  const params = await searchParams;
  const { month, selectedDate } = resolveCalendarMonthAndDate(
    firstValue(params.month),
    firstValue(params.date),
    tokyoYearMonthOf(now.todayTokyoDate),
  );

  const gridDays = buildMonthGridDays(month);
  const gridStart = gridDays[0];
  const gridEnd = gridDays[gridDays.length - 1];
  if (gridStart === undefined || gridEnd === undefined) {
    // Unreachable: `buildMonthGridDays` always returns a non-empty (multiple
    // of 7) array. Guarded only to satisfy `noUncheckedIndexedAccess`.
    return (
      <StatePanel variant="error" title="カレンダーを読み込めませんでした" />
    );
  }

  const [occurrenceState, scheduleState] = await Promise.all([
    loadCalendarOccurrences(supabase, userResult.value, gridStart, gridEnd),
    loadCalendarSchedule(supabase, gridStart, gridEnd),
  ]);

  return (
    <CalendarView
      month={month}
      today={now.todayTokyoDate}
      selectedDate={selectedDate}
      userId={userResult.value}
      occurrenceState={occurrenceState}
      scheduleState={scheduleState}
    />
  );
}
