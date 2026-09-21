import { StatePanel } from "@stage-tracker/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { resolveScreenNow } from "@/app/_lib/now";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { loadTicketsTimeline } from "./_lib/tickets-loader";
import { TicketsView } from "./_components/TicketsView";

/**
 * `/tickets` route and exact composition are runtime-owned. TicketOpportunity
 * planning semantics are in Spec 008 and timeline date/month semantics in
 * Spec 003. This page performs the authenticated read and delegates the
 * rendered surface to `TicketsView`.
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
