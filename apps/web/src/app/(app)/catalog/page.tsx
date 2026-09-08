import { StatePanel } from "@stage-tracker/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { resolveScreenNow } from "@/app/_lib/now";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import {
  firstDayOfMonth,
  lastDayOfMonth,
  parseMonthParam,
  tokyoYearMonthOf,
} from "@/app/_lib/calendar-grid";
import {
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
 * `/catalog` (`docs/v2/oracle-routes-ui.md` §1 `/catalog`). Read-only - no
 * Server Action/mutation on this screen (this Task's scope). The `date`
 * search param the oracle's route inventory lists for this path has no
 * described UI behavior in oracle §2 「イベントカタログ一覧」 (unlike
 * `/calendar`'s explicit selected-day feature) - this Task therefore does
 * not wire up day-level selection here (see this Task's report).
 */
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const supabase = await createSupabaseServerClient();
  const userResult = await requireAuthenticatedUserId(supabase);

  if (!userResult.ok) {
    return userResult.error.kind === "unauthenticated" ? (
      <StatePanel variant="unavailable" title="ログインが必要です" />
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
  const month = parseMonthParam(
    firstValue(params.month),
    tokyoYearMonthOf(now.todayTokyoDate),
  );
  const range = {
    startsOn: firstDayOfMonth(month),
    endsOn: lastDayOfMonth(month),
  };

  const [eventsState, filterOptionsResult] = await Promise.all([
    loadCatalogEvents(supabase, range),
    loadCatalogFilterOptions(supabase),
  ]);

  return (
    <CatalogView
      month={month}
      eventsState={eventsState}
      filterOptionsResult={filterOptionsResult}
    />
  );
}
