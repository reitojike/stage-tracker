import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ScheduleShareId,
  PersonalScheduleEntryId,
  UserId,
} from "@stage-tracker/domain";
import { ActionError } from "@/lib/action-error";
import {
  classifyRpcError,
  classifyWritePostgrestError,
} from "./postgrest-error";

/**
 * `personal_schedule_shares` の write 層。owner の共有追加/解除、非owner の
 * 自己離脱をここに集約する。
 *
 * `removeScheduleShare` は owner-as-remover と self-as-leaver の両方で
 * **同一の DB 操作**（`personal_schedule_shares` の DELETE、対象は
 * `entryId` + `shareId` の組）であることに注意 - RLS の
 * `personal_schedule_shares_delete_owner_or_self`
 * が「owner 自身の share row 削除」と「recipient 自身の self-leave」の
 * 両方を1つの USING 句で許可しているのと対称。呼び出し元
 * （`schedule-share-actions.ts` の2つの Server Action）は同じ関数を呼ぶが、
 * 「delete-as-owner」と「self-leave」という product 上別の operation
 * である区別は、呼び出し元の action 名・呼び出し元の caller 制約
 * （このタスクの報告「自己離脱と削除の区別」参照）で表現する。
 */

/**
 * `share_schedule_entry_by_email` RPC
 * （`supabase/migrations/20260823020000_create_schedule_share_email_boundary.sql`）
 * が「対象 email が登録済みアカウントではない」場合に `raise exception` する、
 * 唯一かつ安定した生メッセージ。この RPC の業務ルール違反はすべて同一の
 * SQLSTATE (`P0001`) で返るため（`classifyRpcError` の doc comment参照）、
 * この1件だけを他の業務ルール違反（自己共有・owner 以外からの呼び出し等）
 * から区別する構造化された手段が migration 側にまだ無い。
 *
 * この定数を使った完全一致比較は、`docs/v2/decisions.md` A8 が禁止する
 * 「エラー種別自体を message で判定する」こととは別軸の狭い用途に限定する:
 * `error.code === "P0001"` によって `kind`（`validation`）は既に確定済みで
 * あり、ここでは *その後* の表示文言だけを、product rule が明示的に開示を
 * 許可した一点（「Authenticated-user targeting」節: personal schedule の
 * 共有には Invitation のような第三者 private state がなく、対象 email が
 * 未登録であることを owner へ知らせてよい）に絞って安全な classified な
 * 文言へ差し替える。一致しない場合（migration の文言変更を含む）は
 * `classifyRpcError` が自動的に generic な安全文言へ fail-closed する -
 * この関数が「未登録」を見逃す方向にしか壊れない。
 *
 * 正しい長期的解決（A8 の指示どおり custom SQLSTATE を追加する）は
 * `supabase/migrations/` の変更を要するためこの Task の scope 外
 * （このタスクの報告に技術的負債として記録する）。
 */
const UNREGISTERED_RECIPIENT_EMAIL_RAW_MESSAGE =
  "recipient email is not a registered account";
const UNREGISTERED_RECIPIENT_EMAIL_MESSAGE_JA =
  "このメールアドレスは、Stage Trackerに登録されていません。";

function resolveShareByEmailBusinessRuleMessage(
  rawMessage: string,
): string | undefined {
  return rawMessage === UNREGISTERED_RECIPIENT_EMAIL_RAW_MESSAGE
    ? UNREGISTERED_RECIPIENT_EMAIL_MESSAGE_JA
    : undefined;
}

interface RawScheduleShareRow {
  readonly id: string;
  readonly schedule_entry_id: string;
  readonly shared_with_user_id: string;
  readonly created_at: string;
}

export interface ScheduleShareRecipient {
  readonly shareId: ScheduleShareId;
  readonly recipientEmail: string;
  readonly sharedAt: string;
}

interface RawScheduleShareRecipientRow {
  readonly share_id: string;
  readonly recipient_email: string;
  readonly shared_at: string;
}

export async function addScheduleShareByEmail(
  client: SupabaseClient,
  entryId: PersonalScheduleEntryId,
  recipientEmail: string,
): Promise<void> {
  const { error, status } = await client.rpc("share_schedule_entry_by_email", {
    p_schedule_entry_id: entryId,
    p_recipient_email: recipientEmail,
  });

  if (error !== null) {
    // この RPC の業務ルール違反（未登録 email・自己共有・owner 以外からの
    // 呼び出し等）はすべて同一の SQLSTATE (`P0001`) で返るため、code だけ
    // からは細分できない（`classifyRpcError` の doc comment参照）。
    // この呼び出し元は常に owner 本人が「共有追加」フォームから呼ぶため、
    // 現実的に起こり得るのは email 起因の入力拒否であり、`validation` を
    // 選ぶ。
    //
    // `resolveShareByEmailBusinessRuleMessage`（このファイル冒頭）だけが
    // 唯一、生メッセージを見て表示文言を選ぶ狭い exception:
    // 「対象 email が未登録」は product rule
    // （product-rules.md「Authenticated-user targeting」節）が owner への
    // 開示を明示的に許可した classified な状態であり、それ以外の P0001
    // 原因（自己共有・owner 以外からの呼び出し等）は `classifyRpcError` の
    // generic な安全文言（`GENERIC_VALIDATION_MESSAGE_JA`）へ fail-closed
    // する - 生メッセージそのものは決して `ActionError.message` に載らない。
    throw classifyRpcError(
      error,
      status,
      "validation",
      resolveShareByEmailBusinessRuleMessage,
    );
  }
}

/**
 * owner が entry の recipient を除去する場合と、recipient が自分自身を
 * 除去する場合の両方が使う共通 DELETE（doc comment 上部参照）。
 *
 * `entryId` と `shareId` の両方を DELETE の条件に入れる。RLS は「呼び出し元が
 * その share の owner または recipient 本人であること」までしか enforce
 * せず、「呼び出し元が指定した `entryId` にその `shareId` が属している
 * こと」までは保証しない。`entryId` を revalidate 用の値として受け取るだけで
 * WHERE 句に使わないと、caller が owner である別 entry の shareId を渡した
 * 場合に、その shareId が実在すれば削除自体は成功してしまい、無関係な
 * entry の path を revalidate することになる。`.eq("schedule_entry_id",
 * entryId)` を足すことで、shareId が指定した entryId に属していない限り
 * 0 行 DELETE（= 下の `not-found`）にする。
 */
export async function removeScheduleShare(
  client: SupabaseClient,
  entryId: PersonalScheduleEntryId,
  shareId: ScheduleShareId,
): Promise<void> {
  const { data, error, status } = await client
    .from("personal_schedule_shares")
    .delete()
    .eq("id", shareId)
    .eq("schedule_entry_id", entryId)
    .select("id")
    .overrideTypes<{ id: string }[]>();

  if (error !== null) {
    throw classifyWritePostgrestError(error, status);
  }
  if (data.length === 0) {
    throw new ActionError("not-found", "対象の共有が見つかりませんでした。");
  }
}

/**
 * 非owner が、自分が受け取っている共有のうち特定 entry のものの
 * shareId を得るための read。plain table SELECT で十分な理由:
 * `personal_schedule_shares_select_owner_or_recipient` RLS が
 * 「recipient は自分の share row だけを見られる」を既に保証しており、
 * この読み取りは RPC を必要としない（owner 視点の email 一覧取得
 * （`list_schedule_share_recipient_emails`）とは異なり、email 列を
 * 必要としないため）。
 *
 * `shared_with_user_id` を呼び出し元の `userId` で明示的に絞る。
 * `personal_schedule_shares_select_owner_or_recipient` RLS は recipient
 * 本人だけでなく **entry owner にもその entry の全 share row の SELECT を
 * 許可している**ため、`schedule_entry_id` だけの絞り込みでは、この関数を
 * owner が呼んだ場合に recipient 全員の share row が返り得る。self-leave
 * の呼び出し元（`removeScheduleShareAction`）は「自分自身の share だけを
 * 対象にする」という契約のため、`shared_with_user_id = userId` まで
 * 絞ってはじめて「自分の共有」に束縛される。
 *
 * 一意制約 `(schedule_entry_id, shared_with_user_id)` により、この
 * 呼び出しが1行を超えて返すことはない。
 */
export async function findOwnScheduleShareId(
  client: SupabaseClient,
  entryId: PersonalScheduleEntryId,
  userId: UserId,
): Promise<ScheduleShareId | null> {
  const { data, error, status } = await client
    .from("personal_schedule_shares")
    .select("id")
    .eq("schedule_entry_id", entryId)
    .eq("shared_with_user_id", userId)
    .overrideTypes<Pick<RawScheduleShareRow, "id">[]>();

  if (error !== null) {
    throw classifyWritePostgrestError(error, status);
  }
  const first = data[0];
  return first === undefined ? null : (first.id as ScheduleShareId);
}

/**
 * owner 視点の recipient-email 一覧（`list_schedule_share_recipient_emails`
 * RPC）。この RPC は SECURITY DEFINER で owner-only を再チェックしており
 * （migration の doc comment 参照）、通常この関数は owner だと確認済みの
 * 呼び出し元（`/schedule/[entryId]` が既に `entry.ownerId === callerId` を
 * 確認した後）からのみ呼ぶ。そのため、この RPC が返す唯一現実的な業務
 * ルール違反は「owner ではない」であり、`classifyRpcError` の
 * `businessRuleKind` に `permission-denied` を渡す
 * （`addScheduleShareByEmail` が `validation` を渡すのとは異なる選択 -
 * 理由は各呼び出し元の現実的な失敗モードの違い）。
 */
export async function listScheduleShareRecipientEmails(
  client: SupabaseClient,
  entryId: PersonalScheduleEntryId,
): Promise<readonly ScheduleShareRecipient[]> {
  // `.overrideTypes<Row[]>()` は RPC 呼び出しでは
  // 「single object を array 型へキャストしようとしている」という
  // postgrest-js 側の型レベル guard に阻まれる（Database 型が未配線の
  // client では `.rpc()` の既定推論が単一オブジェクト扱いになるため -
  // `.from().select()` の配列既定とは異なる）。実行時にはこの RPC は常に
  // `returns table (...)` の行配列を返すため、`data` をここで直接
  // アサーションする。
  const { data, error, status } = await client.rpc(
    "list_schedule_share_recipient_emails",
    {
      p_schedule_entry_id: entryId,
    },
  );

  if (error !== null) {
    throw classifyRpcError(error, status, "permission-denied");
  }
  const rows = (data ?? []) as unknown as RawScheduleShareRecipientRow[];
  return rows.map((row) => ({
    shareId: row.share_id as ScheduleShareId,
    recipientEmail: row.recipient_email,
    sharedAt: row.shared_at,
  }));
}
