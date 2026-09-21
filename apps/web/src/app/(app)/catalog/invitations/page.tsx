import { userIdSchema } from "@stage-tracker/domain";
import { BackLink, PageHeading, StatePanel } from "@stage-tracker/ui";
import { classifyListReadResult, listMyReceivedInvitations } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { REAUTH_RETRY_HINT_JA } from "@/lib/user-facing-copy";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { resolveScreenNow } from "@/app/_lib/now";
import { tokyoYearMonthOf } from "@/app/_lib/calendar-grid";
import { catalogMonthHref } from "../_lib/catalog-links";
import { InvitationList } from "./_components/InvitationList";

/**
 * 自分宛 pending Invitation 一覧（`specs/006-invitation-coordination-opacity/spec.md`
 * `/catalog/invitations`）。
 */
export default async function InvitationsPage() {
  const backHref = catalogMonthHref(
    tokyoYearMonthOf(resolveScreenNow().todayTokyoDate),
  );
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return (
      <StatePanel
        variant="unavailable"
        title="サインインが必要です"
        description={REAUTH_RETRY_HINT_JA}
      />
    );
  }

  const parsedUserId = userIdSchema.safeParse(user.id);
  if (!parsedUserId.success) {
    return (
      <StatePanel
        variant="unavailable"
        title="サインインが必要です"
        description={REAUTH_RETRY_HINT_JA}
      />
    );
  }

  const result = await listMyReceivedInvitations(supabase, parsedUserId.data);
  const state = classifyListReadResult(result);

  return (
    <div className="flex flex-col gap-md">
      <BackLink href={backHref}>イベントへ戻る</BackLink>
      <header className="flex items-baseline justify-between gap-sm border-b-2 border-foreground pb-card-block">
        <PageHeading>招待一覧</PageHeading>
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
