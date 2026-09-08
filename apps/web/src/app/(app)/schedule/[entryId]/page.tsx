import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StatePanel } from "@stage-tracker/ui";
import {
  personalScheduleEntryIdSchema,
  userIdSchema,
  type PersonalScheduleEntryId,
} from "@stage-tracker/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import {
  listScheduleShareRecipientEmails,
  findOwnScheduleShareId,
} from "@/lib/actions/schedule/schedule-share-write";
import { findVisibleScheduleEntry } from "../_lib/entryLookup";
import { classifyScheduleEntryReadResult } from "../_lib/entryReadState";
import { safelyCall } from "../_lib/safelyCall";
import { BackLink, PageHeading } from "../_components/PageChrome";
import { ScheduleEntryDetailView } from "../_components/ScheduleEntryDetailView";
import { ShareAddForm } from "../_components/ShareAddForm";
import { RecipientList } from "../_components/RecipientList";
import { LeaveShareButton } from "../_components/LeaveShareButton";
import { DeleteEntryButton } from "../_components/DeleteEntryButton";

function resolveBackHref(month: string | undefined): string {
  return month !== undefined && month.length > 0
    ? `/calendar?month=${month}`
    : "/calendar";
}

/**
 * owner 向けの共有相手管理。recipient 一覧取得の失敗
 * （`docs/v2/oracle-routes-ui.md` §2「予定詳細」: 「owner側の recipient
 * 一覧取得失敗」）は、entry 本体の表示とは別枠の専用メッセージで表す
 * - entry 自体は表示を継続する。
 *
 * `description` は `(app)/` 配下の read panel（例:
 * `../../page.tsx`）と同じ `READ_FAILURE_RETRY_HINT_JA` を使う固定文言
 * であり、`safelyCall` が拾った例外の内容（`ActionError.message` を含む）を
 * 一切表示に使わない。`description={...message}` の形を全廃する M6c の
 * 修正対象であり、`safelyCall` 自体もこの節を受けて「呼び出し元が dynamic
 * な message を表示できないよう、そもそも message を返さない」形へ変更した
 * （`_lib/safelyCall.ts` 参照）。
 */
async function OwnerShareManagement({
  supabase,
  entryId,
}: {
  readonly supabase: SupabaseClient;
  readonly entryId: PersonalScheduleEntryId;
}) {
  const result = await safelyCall(() =>
    listScheduleShareRecipientEmails(supabase, entryId),
  );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-title font-semibold text-foreground">共有相手</h2>
      {result.ok ? (
        <RecipientList entryId={entryId} recipients={result.value} />
      ) : (
        <StatePanel
          variant="error"
          title="共有相手の一覧を読み込めませんでした。"
          description={READ_FAILURE_RETRY_HINT_JA}
        />
      )}
      <ShareAddForm entryId={entryId} />
    </section>
  );
}

/**
 * 非owner向けの自分の共有状態。自分の share 行取得失敗
 * （oracle 同節: 「非owner側の自分のshare行取得失敗」）は entry 本体とは
 * 別枠で表示する。`description` は上記 `OwnerShareManagement` と同じ理由で
 * 固定文言にする。
 */
async function NonOwnerShareStatus({
  supabase,
  entryId,
  userId,
}: {
  readonly supabase: SupabaseClient;
  readonly entryId: PersonalScheduleEntryId;
  readonly userId: string;
}) {
  const result = await safelyCall(() =>
    findOwnScheduleShareId(supabase, entryId, userIdSchema.parse(userId)),
  );

  if (!result.ok) {
    return (
      <StatePanel
        variant="error"
        title="共有状態を確認できませんでした。"
        description={READ_FAILURE_RETRY_HINT_JA}
      />
    );
  }
  // null は「自分の share 行が見つからない」= 通常は起こらない
  // （RLS 上そもそもこの entry が見えているのは owner か recipient の
  // どちらかであり、非owner ならこの場合 recipient のはずのため）が、
  // 万一の場合はボタン自体を非表示にする（エラー表示はしない）。
  if (result.value === null) {
    return null;
  }
  return <LeaveShareButton entryId={entryId} />;
}

export default async function ScheduleEntryDetailPage({
  params,
  searchParams,
}: PageProps<"/schedule/[entryId]">) {
  const { entryId: rawEntryId } = await params;
  const { month: rawMonth } = await searchParams;
  const month = typeof rawMonth === "string" ? rawMonth : undefined;
  const backHref = resolveBackHref(month);

  const entryIdResult = personalScheduleEntryIdSchema.safeParse(rawEntryId);

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={backHref}>← カレンダーへ戻る</BackLink>
      <PageHeading>予定の詳細</PageHeading>
      {!entryIdResult.success ? (
        <StatePanel variant="empty" title="この予定は見つかりませんでした。" />
      ) : (
        <ScheduleEntryDetailBody entryId={entryIdResult.data} />
      )}
    </div>
  );
}

async function ScheduleEntryDetailBody({
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
        title="ログイン状態を確認できませんでした。"
        description="再度サインインしてからお試しください。"
      />
    );
  }

  const entryReadResult = await findVisibleScheduleEntry(supabase, entryId);
  const entryState = classifyScheduleEntryReadResult(entryReadResult);

  if (entryState.variant === "empty") {
    // 存在しない entry と非公開 entry は同一の empty 扱い（意図的。
    // `_lib/entryLookup.ts` の doc comment参照）。
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
  const isOwner = entry.ownerId === user.id;

  return (
    <div className="flex flex-col gap-4">
      <ScheduleEntryDetailView entry={entry} />
      {isOwner ? (
        <>
          <OwnerShareManagement supabase={supabase} entryId={entryId} />
          <div className="flex flex-col gap-2">
            <Link
              href={`/schedule/${entryId}/edit`}
              className="text-body-sm text-primary underline-offset-4 hover:underline"
            >
              編集する
            </Link>
            <DeleteEntryButton entryId={entryId} />
          </div>
        </>
      ) : (
        <NonOwnerShareStatus
          supabase={supabase}
          entryId={entryId}
          userId={user.id}
        />
      )}
    </div>
  );
}
