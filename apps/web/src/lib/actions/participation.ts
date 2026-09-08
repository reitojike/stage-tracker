import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  ok,
  type OccurrenceId,
  type Result,
  type UserId,
} from "@stage-tracker/domain";
import type { ActionErrorShape } from "@/lib/action-error";

/**
 * 参加状況の書き込み core（`docs/v2/oracle-routes-ui.md` §1/§2 イベント詳細
 * の `setParticipationChoiceAction`）。next-safe-action の `"use server"`
 * wrapper（`./participation.actions.ts`）から `ctx.supabase`/`ctx.userId` を
 * 渡して呼ばれる。この core 自体は `"use server"` を持たないため、MSW で
 * Supabase の REST レスポンスを作り分けて直接ユニットテストできる
 * （`next/headers` の request-scope に依存しない - `magic-link.ts`/
 * `magic-link.test.ts` と同じ core/wrapper 分離パターン）。
 */
export const PARTICIPATION_CHOICES = [
  "attending",
  "considering",
  "withdraw",
] as const;
export type ParticipationChoice = (typeof PARTICIPATION_CHOICES)[number];

/** `docs/v2/decisions.md` A8: message 文字列マッチではなく custom SQLSTATE で分類する。 */
const OCCURRENCE_CANCELED_SQLSTATE = "90002";
const UNIQUE_VIOLATION_SQLSTATE = "23505";

export type SetParticipationChoiceErrorKind =
  ActionErrorShape<"occurrence-canceled">;

interface PostgrestLikeError {
  readonly code?: string | null;
  readonly message: string;
}

function classifyWriteError(
  error: PostgrestLikeError,
): SetParticipationChoiceErrorKind {
  if (error.code === OCCURRENCE_CANCELED_SQLSTATE) {
    return {
      kind: "occurrence-canceled",
      message: "この公演は中止されているため、この操作はできません。",
    };
  }
  // A8: 上記以外は message match をしない。self-invite 等と違い、この
  // write には「actor 自身の事実」由来で意味のある分岐が他に無いため、
  // 単一の opaque failure として扱う。
  return { kind: "failure", message: "参加状況を更新できませんでした。" };
}

export interface SetParticipationChoiceParams {
  readonly occurrenceId: OccurrenceId;
  readonly userId: UserId;
  readonly choice: ParticipationChoice;
}

interface ExistingParticipationRow {
  readonly id: string;
  readonly status: string;
}

/**
 * `docs/v2/oracle-domain.md` §1.6 の `setParticipation`/`withdrawParticipation`
 * を1関数にまとめた write boundary。
 *
 * **真の `upsert()` は使わない**（oracle-domain.md §1.6 の明示的な指示）。
 * `occurrence_participations` の UPDATE 列 grant は `(status, visibility)`
 * のみで `occurrence_id`/`user_id` を含まない
 * (`20260822010000_create_occurrence_participations.sql`)。PostgREST の
 * `resolution=merge-duplicates` upsert は `ON CONFLICT DO UPDATE SET` に
 * 送信した列（conflict target 列自身を含む）をすべて含めるため、真の
 * upsert を使うと `occurrence_id`/`user_id` の UPDATE を試みて権限エラーに
 * なる。既存行の有無を確認してから INSERT/UPDATE を明示的に使い分ける。
 */
export async function setParticipationChoice(
  client: SupabaseClient,
  params: SetParticipationChoiceParams,
): Promise<Result<void, SetParticipationChoiceErrorKind>> {
  if (params.choice === "withdraw") {
    const { error } = await client
      .from("occurrence_participations")
      .delete()
      .eq("occurrence_id", params.occurrenceId)
      .eq("user_id", params.userId);
    if (error) {
      return err(classifyWriteError(error));
    }
    return ok(undefined);
  }

  const { data: existingRows, error: selectError } = await client
    .from("occurrence_participations")
    .select("id, status")
    .eq("occurrence_id", params.occurrenceId)
    .eq("user_id", params.userId)
    .overrideTypes<ExistingParticipationRow[]>();

  if (selectError) {
    return err(classifyWriteError(selectError));
  }

  const existing = existingRows?.[0] ?? null;

  if (existing !== null) {
    if (existing.status === params.choice) {
      // 既に同じ状態: 書き込み不要（no-op）。
      return ok(undefined);
    }
    const { error } = await client
      .from("occurrence_participations")
      .update({ status: params.choice })
      .eq("id", existing.id);
    if (error) {
      return err(classifyWriteError(error));
    }
    return ok(undefined);
  }

  const { error: insertError } = await client
    .from("occurrence_participations")
    .insert({
      occurrence_id: params.occurrenceId,
      user_id: params.userId,
      status: params.choice,
    });

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION_SQLSTATE) {
      // 同一 (occurrence_id, user_id) への並行 INSERT レース: 相手が先に
      // 行を作った。UPDATE へフォールバックする（`invite_to_occurrence`
      // RPC のリトライループと同じ種類のレース、規模はごく小さいので単純な
      // 1回フォールバックで十分と判断）。
      const { data: raceRow, error: refetchError } = await client
        .from("occurrence_participations")
        .select("id")
        .eq("occurrence_id", params.occurrenceId)
        .eq("user_id", params.userId)
        .overrideTypes<{ id: string }[]>();
      if (refetchError || !raceRow?.[0]) {
        return err(classifyWriteError(insertError));
      }
      const { error: updateError } = await client
        .from("occurrence_participations")
        .update({ status: params.choice })
        .eq("id", raceRow[0].id);
      if (updateError) {
        return err(classifyWriteError(updateError));
      }
      return ok(undefined);
    }
    return err(classifyWriteError(insertError));
  }

  return ok(undefined);
}
