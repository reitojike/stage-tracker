import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  ok,
  type Result,
  type TicketOpportunityId,
  type UserId,
  type UserTicketOpportunityStatus,
} from "@stage-tracker/domain";
import type { ActionErrorShape } from "@/lib/action-error";

/**
 * `user_ticket_opportunity_states` の write core（`docs/v2/oracle-routes-ui.md`
 * の `/tickets` 行の `updateTicketOpportunityStateAction`）。next-safe-action の
 * `"use server"` wrapper（`./ticketOpportunityState.actions.ts`）から
 * `ctx.supabase`/`ctx.userId` を渡して呼ばれる。`participation.ts` と同じ
 * core/wrapper 分離パターン。
 */

export type SetTicketOpportunityStateErrorKind = ActionErrorShape<never>;

interface PostgrestLikeError {
  readonly code?: string | null;
  readonly message: string;
}

const UNIQUE_VIOLATION_SQLSTATE = "23505";

function classifyWriteError(
  error: PostgrestLikeError,
): SetTicketOpportunityStateErrorKind {
  // `occurrence_participations` の `occurrence-canceled` (90002) に相当する
  // actor 事実由来の分岐はこのテーブルには無い（TicketOpportunity の
  // cancellation 状態はこの write の対象外 - AGENTS.md「Ticket
  // Opportunity」に cancellation gate の記述は無い）。単一の opaque
  // failure として扱う。生の code/message は client へ渡さず、server 側
  // ログにのみ残す（`postgrest-error.ts` の `classifyPostgrestLikeError`
  // と同じ方針）。
  console.error("[ticket opportunity state write] unclassified error", {
    code: error.code,
    message: error.message,
  });
  return { kind: "failure", message: "申し込み状況を更新できませんでした。" };
}

/** レース中に自分の書き込みが0行しか更新できなかった場合の opaque failure
 * (`participation.ts`の`CONCURRENT_WRITE_LOST`と同じ位置づけ)。 */
const CONCURRENT_WRITE_LOST: SetTicketOpportunityStateErrorKind = {
  kind: "failure",
  message: "申し込み状況を更新できませんでした。もう一度お試しください。",
};

export interface TicketOpportunityStateTarget {
  readonly opportunityId: TicketOpportunityId;
  readonly userId: UserId;
}

async function updateStatusByUserAndOpportunity(
  client: SupabaseClient,
  target: TicketOpportunityStateTarget,
  status: UserTicketOpportunityStatus,
): Promise<Result<boolean, SetTicketOpportunityStateErrorKind>> {
  const { data, error } = await client
    .from("user_ticket_opportunity_states")
    .update({ status })
    .eq("user_id", target.userId)
    .eq("opportunity_id", target.opportunityId)
    .select("id")
    .maybeSingle();
  if (error) {
    return err(classifyWriteError(error));
  }
  return ok(data !== null);
}

export interface SetTicketOpportunityStateParams extends TicketOpportunityStateTarget {
  readonly status: UserTicketOpportunityStatus;
}

/**
 * `docs/v2/oracle-routes-ui.md`「`updateTicketOpportunityStateAction`→
 * `user_ticket_opportunity_states` の upsert/delete」の upsert 半分。
 *
 * **真の `upsert()` は使わない**（`participation.ts`の`setParticipationChoice`
 * と同じ理由）。`user_ticket_opportunity_states` の UPDATE 列 grant は
 * `status` のみで `user_id`/`opportunity_id` を含まない
 * (`20260828000200_create_user_ticket_opportunity_states.sql`)。PostgREST の
 * `resolution=merge-duplicates` upsert は conflict target 列自身を含めて
 * 送信した列すべてを `ON CONFLICT DO UPDATE SET` するため、真の upsert は
 * `user_id`/`opportunity_id` の UPDATE を試みて権限エラーになる。既存行の
 * 有無を UPDATE の実行結果（0 行 vs 1 行）で判定してから INSERT に
 * フォールバックする。
 */
export async function setMyTicketOpportunityState(
  client: SupabaseClient,
  params: SetTicketOpportunityStateParams,
): Promise<Result<void, SetTicketOpportunityStateErrorKind>> {
  const updateResult = await updateStatusByUserAndOpportunity(
    client,
    params,
    params.status,
  );
  if (!updateResult.ok) {
    return updateResult;
  }
  if (updateResult.value) {
    return ok(undefined);
  }

  const { error: insertError } = await client
    .from("user_ticket_opportunity_states")
    .insert({
      user_id: params.userId,
      opportunity_id: params.opportunityId,
      status: params.status,
    });

  if (!insertError) {
    return ok(undefined);
  }

  if (insertError.code !== UNIQUE_VIOLATION_SQLSTATE) {
    return err(classifyWriteError(insertError));
  }

  // 同一 (user_id, opportunity_id) への並行 INSERT レース: 相手が先に行を
  // 作った。UPDATE へフォールバックする
  // (`participation.ts`の`setParticipationChoice`と同じ種類のレース)。
  const retried = await updateStatusByUserAndOpportunity(
    client,
    params,
    params.status,
  );
  if (!retried.ok) {
    return retried;
  }
  if (retried.value) {
    return ok(undefined);
  }
  return err(CONCURRENT_WRITE_LOST);
}

/**
 * `updateTicketOpportunityStateAction`「delete」半分（intent: `remove`）。
 * 行が既に存在しない場合も PostgREST は 0 行削除のまま成功応答するため、
 * それ自体は失敗として扱わない（「登録されていない」状態への冪等な収束）。
 */
export async function removeMyTicketOpportunityState(
  client: SupabaseClient,
  target: TicketOpportunityStateTarget,
): Promise<Result<void, SetTicketOpportunityStateErrorKind>> {
  const { error } = await client
    .from("user_ticket_opportunity_states")
    .delete()
    .eq("user_id", target.userId)
    .eq("opportunity_id", target.opportunityId);
  if (error) {
    return err(classifyWriteError(error));
  }
  return ok(undefined);
}
