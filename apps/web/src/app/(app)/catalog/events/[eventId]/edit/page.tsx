import { PageHeading, StatePanel } from "@stage-tracker/ui";
import { eventIdSchema } from "@stage-tracker/domain";
import { classifyListReadResult, getEventWithOccurrences } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { REAUTH_RETRY_HINT_JA } from "@/lib/user-facing-copy";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { EVENT_NOT_FOUND_TITLE } from "../_lib/eventCopy";
import { EditEventForm } from "./_components/EditEventForm";

interface EditEventPageProps {
  params: Promise<{ eventId: string }>;
}

/**
 * owner 専用の Event/Occurrence 編集 route。Lifecycle semantics follow Spec
 * 005; exact route/render mechanics are runtime-owned。
 *
 * 空状態/error/unavailable の3分岐は `@/lib/data` の
 * `classifyListReadResult` をそのまま使う。owner 判定はここでの
 * レンダー制御であり、真の書き込み権限境界は常に RLS/RPC 側
 * （current RPC/RLS/schema contract）。
 */
export default async function EditEventPage({ params }: EditEventPageProps) {
  const { eventId } = await params;

  const parsedEventId = eventIdSchema.safeParse(eventId);
  if (!parsedEventId.success) {
    return <StatePanel variant="empty" title={EVENT_NOT_FOUND_TITLE} />;
  }

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

  const result = await getEventWithOccurrences(supabase, parsedEventId.data);
  const state = classifyListReadResult(result);

  if (state.variant === "unavailable" || state.variant === "error") {
    return (
      <StatePanel
        variant={state.variant}
        title={
          state.variant === "unavailable"
            ? "イベントを確認できません"
            : "イベントを読み込めませんでした"
        }
        {...(state.variant === "error"
          ? { description: READ_FAILURE_RETRY_HINT_JA }
          : {})}
      />
    );
  }
  if (state.variant === "empty") {
    return <StatePanel variant="empty" title={EVENT_NOT_FOUND_TITLE} />;
  }

  const [entry] = state.data;
  if (entry === undefined) {
    return <StatePanel variant="empty" title={EVENT_NOT_FOUND_TITLE} />;
  }
  const { event, occurrences } = entry;

  if (event.ownerId !== user.id) {
    return (
      <StatePanel
        variant="unavailable"
        title="編集する権限がありません"
        description="このイベントの owner のみが編集できます。"
      />
    );
  }

  return (
    <>
      <PageHeading>イベントを編集</PageHeading>
      <EditEventForm event={event} occurrences={occurrences} />
    </>
  );
}
