import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ScheduleShareId,
  PersonalScheduleEntryId,
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
 * **同一の DB 操作**（`personal_schedule_shares` の DELETE、対象は shareId）
 * であることに注意 - RLS の `personal_schedule_shares_delete_owner_or_self`
 * が「owner 自身の share row 削除」と「recipient 自身の self-leave」の
 * 両方を1つの USING 句で許可しているのと対称。呼び出し元
 * （`schedule-share-actions.ts` の2つの Server Action）は同じ関数を呼ぶが、
 * 「delete-as-owner」と「self-leave」という product 上別の operation
 * である区別は、呼び出し元の action 名・呼び出し元の caller 制約
 * （このタスクの報告「自己離脱と削除の区別」参照）で表現する。
 */

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
    throw classifyRpcError(error, status, "validation");
  }
}

/**
 * owner が entry の recipient を除去する場合と、recipient が自分自身を
 * 除去する場合の両方が使う共通 DELETE（doc comment 上部参照）。
 */
export async function removeScheduleShare(
  client: SupabaseClient,
  shareId: ScheduleShareId,
): Promise<void> {
  const { data, error, status } = await client
    .from("personal_schedule_shares")
    .delete()
    .eq("id", shareId)
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
 * 一意制約 `(schedule_entry_id, shared_with_user_id)` により、この
 * 呼び出しが1行を超えて返すことはない。
 */
export async function findOwnScheduleShareId(
  client: SupabaseClient,
  entryId: PersonalScheduleEntryId,
): Promise<ScheduleShareId | null> {
  const { data, error, status } = await client
    .from("personal_schedule_shares")
    .select("id")
    .eq("schedule_entry_id", entryId)
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
