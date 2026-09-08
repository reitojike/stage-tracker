import { StatePanel } from "@stage-tracker/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { resolveScreenNow } from "@/app/_lib/now";
import {
  loadHomeTicketDeadlines,
  loadHomeUpcomingSchedule,
} from "./_lib/home-loader";
import { HomeView } from "./_components/HomeView";

/**
 * `/` home (`docs/v2/oracle-routes-ui.md` §1 `/`). Read-only - no Server
 * Action/mutation on this screen (this Task's scope).
 */
export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const userResult = await requireAuthenticatedUserId(supabase);

  if (!userResult.ok) {
    // Page-level 二次チェック (oracle §1 `/`: "失敗時は redirect せず error
    // パネル表示"). Distinguishes "not signed in" from a genuine failure to
    // even resolve the session (oracle §2: "unauthenticated と failure を
    // 区別").
    return userResult.error.kind === "unauthenticated" ? (
      <StatePanel variant="unavailable" title="ログインが必要です" />
    ) : (
      <StatePanel
        variant="error"
        title="ホームを読み込めませんでした"
        description={userResult.error.message}
      />
    );
  }

  const now = resolveScreenNow();
  const [ticketState, scheduleState] = await Promise.all([
    loadHomeTicketDeadlines(supabase, userResult.value, now),
    loadHomeUpcomingSchedule(supabase, userResult.value, now),
  ]);

  return <HomeView ticketState={ticketState} scheduleState={scheduleState} />;
}
