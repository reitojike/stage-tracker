import { PageHeading, StatePanel } from "@stage-tracker/ui";
import { classifyListReadResult } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedUserId } from "@/app/_lib/require-authenticated-user-id";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { listMyNotifications } from "@/lib/data/reads/notifications";
import { NotificationsList } from "./_components/NotificationsList";

/** Authenticated persisted Notification inbox (`/notifications`). */
export default async function NotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const userResult = await requireAuthenticatedUserId(supabase);

  if (!userResult.ok) {
    return (
      <div className="flex flex-col gap-md">
        <PageHeading>お知らせ</PageHeading>
        <StatePanel
          variant={userResult.error.kind === "failure" ? "error" : "unavailable"}
          title={
            userResult.error.kind === "failure"
              ? "お知らせを読み込めませんでした"
              : "サインインが必要です"
          }
          {...(userResult.error.kind === "failure"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      </div>
    );
  }

  const result = await listMyNotifications(supabase);
  const state = classifyListReadResult(result);

  return (
    <div className="flex flex-col gap-md">
      <PageHeading>お知らせ</PageHeading>
      {state.variant === "unavailable" || state.variant === "error" ? (
        <StatePanel
          variant={state.variant}
          title={
            state.variant === "error"
              ? "お知らせを読み込めませんでした"
              : "お知らせを確認できません"
          }
          {...(state.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      ) : state.variant === "empty" ? (
        <StatePanel
          variant="empty"
          title="お知らせはありません"
          description="新しいお知らせが届くとここに表示されます。"
        />
      ) : (
        <NotificationsList initialNotifications={state.data} />
      )}
    </div>
  );
}
