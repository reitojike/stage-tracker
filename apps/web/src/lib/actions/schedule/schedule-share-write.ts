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
  LEGACY_DEFAULT_BUSINESS_RULE_CODE,
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

/**
 * `share_schedule_entry_by_email` RPC が「対象 email が登録済みアカウント
 * ではない」場合に返す、2 通りの形。
 *
 * **移行期間中なので両方を受け付ける。** 詳細は `postgrest-error.ts` の
 * `BUSINESS_RULE_POSTGRES_CODES` の doc comment 参照。SQLSTATE の literal は
 * ここで再定義せず、正本（`./postgrest-error`）から import する。
 *
 * - **新**: `SHARE_UNREGISTERED_RECIPIENT_CODE`（構造化された判定。本来あるべき形）
 * - **旧**: `LEGACY_DEFAULT_BUSINESS_RULE_CODE` + 生メッセージの完全一致（PR #389 の migration が
 *   Production へ適用されるまでの現行 DB の形）
 *
 * 旧形式の完全一致比較は、`docs/v2/decisions.md` A8 が禁止する「エラー種別
 * 自体を message で判定する」こととは別軸の狭い用途に限定する: `kind`
 * （`validation`）は `classifyRpcError` が既に確定済みであり、ここでは
 * *その後* の表示文言だけを、product rule が明示的に開示を許可した一点
 * （「Authenticated-user targeting」節: personal schedule の共有には
 * Invitation のような第三者 private state がなく、対象 email が未登録で
 * あることを owner へ知らせてよい）に絞って安全な classified 文言へ
 * 差し替える。一致しない場合（migration の文言変更を含む）は
 * `classifyRpcError` が自動的に generic な安全文言へ fail-closed する -
 * この関数は「未登録」を見逃す方向にしか壊れない。
 *
 * **PR C（contract）でこの関数から旧形式の分岐を落とす。** その時点で
 * message 一致は完全に無くなり、A8 の負債が解消する。
 */
const UNREGISTERED_RECIPIENT_EMAIL_RAW_MESSAGE =
  "recipient email is not a registered account";
const UNREGISTERED_RECIPIENT_EMAIL_MESSAGE_JA =
  "このメールアドレスは、Stage Trackerに登録されていません。";

function resolveShareByEmailBusinessRuleMessage(rejection: {
  readonly code: string;
  readonly rawMessage: string;
}): string | undefined {
  if (rejection.code === SHARE_UNREGISTERED_RECIPIENT_CODE) {
    return UNREGISTERED_RECIPIENT_EMAIL_MESSAGE_JA;
  }
  if (
    rejection.code === LEGACY_DEFAULT_BUSINESS_RULE_CODE &&
    rejection.rawMessage === UNREGISTERED_RECIPIENT_EMAIL_RAW_MESSAGE
  ) {
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
    // 自己共有（`90011`）だけで、残りは依然 `P0001` にまとまっている
    // （`classifyRpcError` の doc comment 参照）。この呼び出し元は常に
    // owner 本人が「共有追加」フォームから呼ぶため、現実的に起こり得るのは
    // email 起因の入力拒否であり、`validation` を選ぶ。
    //
    // `resolveShareByEmailBusinessRuleMessage`（このファイル冒頭）だけが
    // 唯一、表示文言を個別に選ぶ狭い exception:
    // 「対象 email が未登録」は product rule
    // （product-rules.md「Authenticated-user targeting」節）が owner への
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
