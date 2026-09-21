import { StatePanel } from "@stage-tracker/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { resolveScreenNow } from "@/app/_lib/now";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import {
  loadHomeTicketDeadlines,
  loadHomeUpcomingSchedule,
} from "./_lib/home-loader";
import { HomeView } from "./_components/HomeView";

/**
 * `/` home. Read-only - no Server Action/mutation on this screen (this
 * Task's scope); cross-screen independent-read semantics are documented in
 * `docs/ux-ui.md`.
 */
export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const userResult = await requireAuthenticatedUserId(supabase);

  if (!userResult.ok) {
    // Page-level 二次チェック。認証されていない状態と、セッションを解決
    // できなかった状態を区別し、どちらも redirect ではなく画面内の状態
    // パネルとして表示する。
    return userResult.error.kind === "unauthenticated" ? (
      <StatePanel variant="unavailable" title="サインインが必要です" />
    ) : (
      <StatePanel
        variant="error"
        title="ホームを読み込めませんでした"
        description={READ_FAILURE_RETRY_HINT_JA}
      />
    );
  }

  const now = resolveScreenNow();
  const [ticketState, scheduleState] = await Promise.all([
    loadHomeTicketDeadlines(supabase, userResult.value, now),
    loadHomeUpcomingSchedule(supabase, userResult.value, now),
  ]);

  return (
    <HomeView
      ticketState={ticketState}
      scheduleState={scheduleState}
      today={now.todayTokyoDate}
    />
  );
}
