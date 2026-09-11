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
  loadCatalogEntryGroupNames,
  loadCatalogEvents,
  loadCatalogFilterOptions,
} from "./_lib/catalog-loader";
import { CatalogView } from "./_components/CatalogView";

interface CatalogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `/catalog` (`docs/v2/oracle-routes-ui.md` §1 `/catalog`,
 * `docs/v2/oracle-domain.md` §2.10 "Catalog navigation"). Read-only - no
 * Server Action/mutation on this screen (this Task's scope).
 *
 * `month`/`date` resolution reuses `/calendar`'s own
 * `resolveCalendarMonthAndDate` (`@/app/_lib/calendar-grid.ts`) rather than
 * re-deriving it: the oracle's malformed-value fallback and
 * "date が勝つ" precedence rule are identical for both screens (both port
 * the same legacy `resolveCatalogParams`/`resolveMyCalendarParams`
 * contract), and `/catalog` previously ignored `date` entirely (a confirmed
 * gap this Task fixes - see this Task's report).
 */
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const supabase = await createSupabaseServerClient();
  const userResult = await requireAuthenticatedUserId(supabase);

  if (!userResult.ok) {
    return userResult.error.kind === "unauthenticated" ? (
      <StatePanel variant="unavailable" title="サインインが必要です" />
    ) : (
      <StatePanel
        variant="error"
        title="カタログを読み込めませんでした"
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

  // The read covers the whole *displayed grid* (including lead/trail days
  // from adjacent months the month calendar renders - `MonthCalendar.tsx`),
  // not just the calendar month itself - matching legacy's own
  // `tokyoCalendarDateRangeUtc(grid.gridFirstDate, grid.gridLastDate)`
  // (`apps/legacy-web/src/app/catalog/page.tsx`) and this app's own
  // `/calendar` (`(app)/calendar/page.tsx`'s `gridStart`/`gridEnd`). Without
  // this, a lead/trail cell's band/dot would always render empty even when
  // an adjacent-month Event's range actually covers that date.
  const gridDays = buildMonthGridDays(month);
  const gridStart = gridDays[0];
  const gridEnd = gridDays[gridDays.length - 1];
  if (gridStart === undefined || gridEnd === undefined) {
    // Unreachable: `buildMonthGridDays` always returns a non-empty (multiple
    // of 7) array for a month `resolveCalendarMonthAndDate` already
    // constrained to `isRenderableMonth`. Guarded only to satisfy
    // `noUncheckedIndexedAccess` (mirrors `/calendar/page.tsx`'s same guard).
    return (
      <StatePanel
        variant="error"
        title="カタログを読み込めませんでした"
        description={READ_FAILURE_RETRY_HINT_JA}
      />
    );
  }
  const range = { startsOn: gridStart, endsOn: gridEnd };

  const [eventsState, filterOptionsResult] = await Promise.all([
    loadCatalogEvents(supabase, range),
    loadCatalogFilterOptions(supabase),
  ]);

  // genre facet の有無に関わらず group バッジを解決するため、event 一覧が
  // 読めた場合のみ別読み取りを行う（`loadCatalogEntryGroupNames` のコメント
  // 参照）。events 自体が読めていない場合は groupIds も存在しないので、
  // 失敗ではなく正当な空として扱う。
  const groupNamesResult =
    eventsState.variant === "populated"
      ? await loadCatalogEntryGroupNames(supabase, eventsState.data)
      : { ok: true as const, byId: new Map() };

  return (
    <CatalogView
      month={month}
      today={now.todayTokyoDate}
      selectedDate={selectedDate}
      eventsState={eventsState}
      filterOptionsResult={filterOptionsResult}
      groupNamesResult={groupNamesResult}
    />
  );
}
