import { StatePanel } from "@stage-tracker/ui";
import {
  personalScheduleEntryIdSchema,
  type PersonalScheduleEntryId,
} from "@stage-tracker/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { findVisibleScheduleEntry } from "../../_lib/entryLookup";
import { classifyScheduleEntryReadResult } from "../../_lib/entryReadState";
import { BackLink, PageHeading } from "../../_components/PageChrome";
import { EditScheduleEntryForm } from "../../_components/EditScheduleEntryForm";

function resolveBackHref(month: string | undefined): string {
  return month !== undefined && month.length > 0
    ? `/calendar?month=${month}`
    : "/calendar";
}

export default async function EditScheduleEntryPage({
  params,
  searchParams,
}: PageProps<"/schedule/[entryId]/edit">) {
  const { entryId: rawEntryId } = await params;
  const { month: rawMonth } = await searchParams;
  const month = typeof rawMonth === "string" ? rawMonth : undefined;
  const backHref = resolveBackHref(month);

  const entryIdResult = personalScheduleEntryIdSchema.safeParse(rawEntryId);

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={backHref}>カレンダーへ戻る</BackLink>
      <PageHeading>予定を編集</PageHeading>
      {!entryIdResult.success ? (
        <StatePanel variant="empty" title="この予定は見つかりませんでした。" />
      ) : (
        <EditScheduleEntryBody entryId={entryIdResult.data} />
      )}
    </div>
  );
}

async function EditScheduleEntryBody({
  entryId,
}: {
  readonly entryId: PersonalScheduleEntryId;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return (
      <StatePanel
        variant="unavailable"
        title="サインイン状態を確認できませんでした。"
        description="再度サインインしてからお試しください。"
      />
    );
  }

  const entryReadResult = await findVisibleScheduleEntry(supabase, entryId);
  const entryState = classifyScheduleEntryReadResult(entryReadResult);

  if (entryState.variant === "empty") {
    return (
      <StatePanel variant="empty" title="この予定は見つかりませんでした。" />
    );
  }
  if (entryState.variant === "unavailable") {
    return (
      <StatePanel variant="unavailable" title="この予定を表示できません。" />
    );
  }
  if (entryState.variant === "error") {
    return (
      <StatePanel
        variant="error"
        title="予定を読み込めませんでした。"
        description={READ_FAILURE_RETRY_HINT_JA}
      />
    );
  }

  const entry = entryState.data;
  // owner 以外が直接 URL へ到達した場合、明示的な permission-denied
  // パネルを表示しフォーム自体は描画しない
  // （`docs/v2/oracle-routes-ui.md` §2「予定編集」）。真の書き込み権限
  // 境界は常に RLS 側（`personal_schedule_entries_update_own`）であり、
  // このチェックはレンダー制御のみ。
  if (entry.ownerId !== user.id) {
    return (
      <StatePanel
        variant="unavailable"
        title="この予定を編集する権限がありません。"
        description="この操作は予定の作成者のみ行えます。"
      />
    );
  }

  return <EditScheduleEntryForm entry={entry} />;
}
