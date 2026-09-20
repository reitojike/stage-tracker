import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import { StatePanel } from "@stage-tracker/ui";
import {
  personalScheduleEntryIdSchema,
  userIdSchema,
  type PersonalScheduleEntryId,
} from "@stage-tracker/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { REAUTH_RETRY_HINT_JA } from "@/lib/user-facing-copy";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import {
  getOwnScheduleShareId,
  getVisiblePersonalScheduleEntry,
  listScheduleShareRecipientEmails,
} from "@/lib/data";
import { classifyScheduleEntryReadResult } from "../_lib/entryReadState";
import {
  BackLink,
  PageHeading,
  SectionHeading,
} from "../_components/PageChrome";
import { ScheduleEntryDetailView } from "../_components/ScheduleEntryDetailView";
import { ShareAddForm } from "../_components/ShareAddForm";
import { RecipientList } from "../_components/RecipientList";
import { LeaveShareButton } from "../_components/LeaveShareButton";
import { DeleteEntryButton } from "../_components/DeleteEntryButton";

type ScheduleEntryPageProps = {
  readonly params: Promise<{ readonly entryId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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
 * であり、read boundary の `ReadResult` が返す error detail を画面へ表示せず、
 * variant 固有の固定文言だけを使う。
 */
async function OwnerShareManagement({
  supabase,
  entryId,
}: {
  readonly supabase: SupabaseClient<Database>;
  readonly entryId: PersonalScheduleEntryId;
}) {
  const result = await listScheduleShareRecipientEmails(supabase, entryId);

  return (
    <section className="flex flex-col gap-sm border-t-2 border-border pt-card-block">
      <div className="flex items-center justify-between gap-sm">
        <SectionHeading>共有</SectionHeading>
        <ShareAddForm entryId={entryId} />
      </div>
      {result.ok ? (
        <RecipientList entryId={entryId} recipients={result.value} />
      ) : (
        <StatePanel
          variant="error"
          title="共有相手の一覧を読み込めませんでした"
          description={READ_FAILURE_RETRY_HINT_JA}
        />
      )}
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
  readonly supabase: SupabaseClient<Database>;
  readonly entryId: PersonalScheduleEntryId;
  readonly userId: string;
}) {
  const result = await getOwnScheduleShareId(
    supabase,
    entryId,
    userIdSchema.parse(userId),
  );

  if (!result.ok) {
    return (
      <StatePanel
        variant="error"
        title="共有状態を確認できませんでした"
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
}: ScheduleEntryPageProps) {
  const { entryId: rawEntryId } = await params;
  const { month: rawMonth } = await searchParams;
  const month = typeof rawMonth === "string" ? rawMonth : undefined;
  const backHref = resolveBackHref(month);

  const entryIdResult = personalScheduleEntryIdSchema.safeParse(rawEntryId);

  return (
    <div className="flex flex-col gap-section">
      <BackLink href={backHref}>カレンダーへ戻る</BackLink>
      {!entryIdResult.success ? (
        <>
          <PageHeading>予定の詳細</PageHeading>
          <StatePanel variant="empty" title="この予定は見つかりませんでした" />
        </>
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
  const [authResult, entryReadResult] = await Promise.all([
    supabase.auth.getUser(),
    getVisiblePersonalScheduleEntry(supabase, entryId),
  ]);
  const {
    data: { user },
    error: authError,
  } = authResult;

  if (authError || !user) {
    return (
      <>
        <PageHeading>予定の詳細</PageHeading>
        <StatePanel
          variant="unavailable"
          title="サインイン状態を確認できませんでした"
          description={REAUTH_RETRY_HINT_JA}
        />
      </>
    );
  }

  const entryState = classifyScheduleEntryReadResult(entryReadResult);

  if (entryState.variant === "empty") {
    // 存在しない entry と非公開 entry は同一の empty 扱い（意図的。
    // RLS intentionally gives both cases the same successful null result.
    return (
      <>
        <PageHeading>予定の詳細</PageHeading>
        <StatePanel variant="empty" title="この予定は見つかりませんでした" />
      </>
    );
  }
  if (entryState.variant === "unavailable") {
    return (
      <>
        <PageHeading>予定の詳細</PageHeading>
        <StatePanel variant="unavailable" title="この予定を表示できません" />
      </>
    );
  }
  if (entryState.variant === "error") {
    return (
      <>
        <PageHeading>予定の詳細</PageHeading>
        <StatePanel
          variant="error"
          title="予定を読み込めませんでした"
          description={READ_FAILURE_RETRY_HINT_JA}
        />
      </>
    );
  }

  const entry = entryState.data;
  const isOwner = entry.ownerId === user.id;

  return (
    <div className="flex flex-col gap-section">
      <ScheduleEntryDetailView
        entry={entry}
        isOwner={isOwner}
        {...(isOwner ? { editHref: `/schedule/${entryId}/edit` } : {})}
      />
      {isOwner ? (
        <>
          <OwnerShareManagement supabase={supabase} entryId={entryId} />
          <section className="flex flex-col items-start gap-sm border-t-2 border-border pt-card-block">
            <SectionHeading className="w-full border-b border-destructive pb-card-block text-destructive">
              この予定を削除
            </SectionHeading>
            <p className="text-body-sm text-muted-foreground">
              元に戻せません。共有相手からも見えなくなります。
            </p>
            <DeleteEntryButton entryId={entryId} />
          </section>
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
