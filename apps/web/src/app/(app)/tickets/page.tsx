import { LinkButton, StatePanel } from "@stage-tracker/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { resolveScreenNow } from "@/app/_lib/now";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { loadTicketsTimeline } from "./_lib/tickets-loader";
import { parseTicketsView } from "./_lib/tickets-view";
import { TicketsView } from "./_components/TicketsView";
import {
  loadSelectedTicket,
  parseTicketSelection,
} from "./_lib/selected-ticket";
import { SelectedTicketView } from "./_components/SelectedTicketView";

interface TicketsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/tickets` route and exact composition are runtime-owned. TicketOpportunity
 * planning semantics are in Spec 008 and timeline date/month semantics in
 * Spec 003. This page performs the authenticated read and delegates the
 * rendered surface to `TicketsView`.
 */
export default async function TicketsPage({ searchParams }: TicketsPageProps) {
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
  const params = await searchParams;
  const selection = parseTicketSelection(params.opportunity);
  if (selection.kind === "invalid") {
    return (
      <div className="flex flex-col gap-md">
        <StatePanel
          variant="unavailable"
          title="受付の指定が正しくありません"
        />
        <LinkButton href="/tickets" variant="link">
          受付一覧
        </LinkButton>
      </div>
    );
  }
  if (selection.kind === "selected") {
    const state = await loadSelectedTicket(
      supabase,
      userResult.value,
      selection.id,
      now,
    );
    return <SelectedTicketView state={state} />;
  }
  const state = await loadTicketsTimeline(supabase, userResult.value, now);

  return (
    <TicketsView
      state={state}
      today={now.todayTokyoDate}
      view={parseTicketsView(params.view)}
    />
  );
}
