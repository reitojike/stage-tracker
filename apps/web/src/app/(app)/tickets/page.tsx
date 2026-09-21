import { StatePanel } from "@stage-tracker/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { resolveScreenNow } from "@/app/_lib/now";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { loadTicketsTimeline } from "./_lib/tickets-loader";
import { TicketsView } from "./_components/TicketsView";

/**
 * `/tickets` (`specs/008-ticket-opportunity-planning/spec.md` `/tickets`). Read-only - no
 * Server Action/mutation on this screen (this Task's scope; the current contract's
 * per-row planning-state controls are not rendered - see
 * `./_components/TicketsView.tsx`'s own header).
 */
export default async function TicketsPage() {
  const supabase = await createSupabaseServerClient();
  const userResult = await requireAuthenticatedUserId(supabase);

  if (!userResult.ok) {
    return userResult.error.kind === "unauthenticated" ? (
      <StatePanel variant="unavailable" title="サインインが必要です" />
    ) : (
      <StatePanel
        variant="error"
        title="チケット情報を読み込めませんでした"
        description={READ_FAILURE_RETRY_HINT_JA}
      />
    );
  }

  const now = resolveScreenNow();
  const state = await loadTicketsTimeline(supabase, userResult.value, now);

  return <TicketsView state={state} today={now.todayTokyoDate} />;
}
