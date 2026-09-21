import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ScheduleShareId,
  PersonalScheduleEntryId,
} from "@stage-tracker/domain";
import type { Database } from "@/lib/data/database.types";
import { ActionError } from "@/lib/action-error";
import {
  classifyRpcError,
  classifyWritePostgrestError,
  SHARE_UNREGISTERED_RECIPIENT_CODE,
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

const UNREGISTERED_RECIPIENT_EMAIL_MESSAGE_JA =
  "このメールアドレスは、Stage Trackerに登録されていません。";

function resolveShareByEmailBusinessRuleMessage(
  code: string,
): string | undefined {
  if (code === SHARE_UNREGISTERED_RECIPIENT_CODE) {
    return UNREGISTERED_RECIPIENT_EMAIL_MESSAGE_JA;
  }
  return undefined;
}

export async function addScheduleShareByEmail(
  client: SupabaseClient<Database>,
  entryId: PersonalScheduleEntryId,
  recipientEmail: string,
): Promise<void> {
  const { error, status } = await client.rpc("share_schedule_entry_by_email", {
    p_schedule_entry_id: entryId,
    p_recipient_email: recipientEmail,
  });

  if (error !== null) {
    // この RPC の業務ルール違反（未登録 email・自己共有・owner 以外からの
    // 呼び出し等）のうち、code で区別できるのは未登録 email（`90010`）と
    // 自己共有（`90011`）だけが構造化された業務ルールコードである。
    // この呼び出し元は owner 本人が「共有追加」フォームから呼ぶため、
    // `validation` を選ぶ。
    //
    // `resolveShareByEmailBusinessRuleMessage`（このファイル冒頭）だけが
    // 表示文言を個別に選ぶ狭い exception:
    // 「対象 email が未登録」は product rule
    // （Spec 012 PSH-006）が owner への
    // 開示を明示的に許可した classified な状態であり、それ以外の業務ルール
    // 違反（自己共有・owner 以外からの呼び出し等）は `classifyRpcError` の
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
  client: SupabaseClient<Database>,
  entryId: PersonalScheduleEntryId,
  shareId: ScheduleShareId,
): Promise<void> {
  const { data, error, status } = await client
    .from("personal_schedule_shares")
    .delete()
    .eq("id", shareId)
    .eq("schedule_entry_id", entryId)
    .select("id");

  if (error !== null) {
    throw classifyWritePostgrestError(error, status);
  }
  if (data.length === 0) {
    throw new ActionError("not-found", "対象の共有が見つかりませんでした。");
  }
}
