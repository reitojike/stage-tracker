import { BackLink, StatePanel } from "@stage-tracker/ui";
import { classifyListReadResult } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { listMyReceivedInvitations } from "./_data/listMyReceivedInvitations";
import { InvitationList } from "./_components/InvitationList";

/**
 * 自分宛 pending Invitation 一覧（`docs/v2/oracle-routes-ui.md` §1/§2
 * `/catalog/invitations`）。
 */
export default async function InvitationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return (
      <StatePanel
        variant="unavailable"
        title="サインインが必要です"
        description="サインインしてからもう一度お試しください。"
      />
    );
  }

  const result = await listMyReceivedInvitations(supabase, user.id);
  const state = classifyListReadResult(result);

  return (
    <div className="flex flex-col gap-md">
      <BackLink href="/calendar">カレンダーへ戻る</BackLink>
      <header className="flex items-baseline justify-between gap-sm border-b-2 border-foreground pb-card-block">
        <h1 className="text-heading leading-heading font-semibold text-foreground">
          招待一覧
        </h1>
        {state.variant === "empty" || state.variant === "populated" ? (
          <p className="text-body-sm text-muted-foreground">
            未回答 {state.variant === "populated" ? state.data.length : 0}件
          </p>
        ) : null}
      </header>
      {state.variant === "unavailable" || state.variant === "error" ? (
        <StatePanel
          variant={state.variant}
          title={
            state.variant === "unavailable"
              ? "招待を確認できません"
              : "招待を読み込めませんでした"
          }
          {...(state.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      ) : state.variant === "empty" ? (
        <StatePanel variant="empty" title="招待はありません" />
      ) : (
        <InvitationList initialInvitations={state.data} />
      )}
    </div>
  );
}
