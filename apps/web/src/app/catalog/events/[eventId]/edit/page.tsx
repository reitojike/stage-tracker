import { StatePanel } from "@stage-tracker/ui";
import { eventIdSchema } from "@stage-tracker/domain";
import { classifyListReadResult } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEventForEdit } from "./_data/getEventForEdit";
import { EditEventForm } from "./_components/EditEventForm";

interface EditEventPageProps {
  params: Promise<{ eventId: string }>;
}

/**
 * owner 専用の Event/Occurrence 編集画面
 * （`docs/v2/oracle-routes-ui.md` §1/§2
 * `/catalog/events/[eventId]/edit`）。
 *
 * 空状態/error/unavailable の3分岐は `@/lib/data` の
 * `classifyListReadResult` をそのまま使う。owner 判定はここでの
 * レンダー制御であり、真の書き込み権限境界は常に RLS/RPC 側
 * （AGENTS.md 制約）。
 */
export default async function EditEventPage({ params }: EditEventPageProps) {
  const { eventId } = await params;

  const parsedEventId = eventIdSchema.safeParse(eventId);
  if (!parsedEventId.success) {
    return (
      <StatePanel variant="empty" title="指定された公演が見つかりません" />
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) {
    return (
      <StatePanel
        variant="unavailable"
        title="ログインが必要です"
        description="サインインしてからもう一度お試しください。"
      />
    );
  }

  const result = await getEventForEdit(supabase, parsedEventId.data);
  const state = classifyListReadResult(result);

  if (state.variant === "unavailable" || state.variant === "error") {
    return (
      <StatePanel
        variant={state.variant}
        title="イベントを読み込めませんでした"
        description={state.message}
      />
    );
  }
  if (state.variant === "empty") {
    return (
      <StatePanel variant="empty" title="指定された公演が見つかりません" />
    );
  }

  const [entry] = state.data;
  if (entry === undefined) {
    return (
      <StatePanel variant="empty" title="指定された公演が見つかりません" />
    );
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
      <h1 className="text-heading leading-heading font-semibold text-foreground">
        イベントを編集
      </h1>
      <EditEventForm event={event} occurrences={occurrences} />
    </>
  );
}
