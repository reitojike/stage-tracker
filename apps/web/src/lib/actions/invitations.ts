"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  invitationIdSchema,
  occurrenceIdSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/lib/action-error";
import { classifyPostgrestLikeError } from "./postgrest-error";

/**
 * `/catalog/invitations` の書き込み層
 * （`docs/v2/oracle-routes-ui.md` §1 `/catalog/invitations`）。
 */

/**
 * Accept: AGENTS.md "Invitation" / decisions.md 「accept は専用 RPC を持た
 * ない」— 通常の participation write（`considering`/rowなし ->
 * `attending`）と全く同一の operation として実装する。書き込みが成功すると
 * DB 側の `resolve_pending_invitations_on_attending` トリガーが、同一
 * occurrence への他の pending invitation も含めて自動的に解決する
 * （`supabase/migrations/20260830000000_simplify_invitation_pending_only.sql`）
 * ため、この action 自身は invitation テーブルに一切触れない。
 */
const acceptInvitationInputSchema = z.object({
  occurrenceId: occurrenceIdSchema,
});

export const acceptInvitationAction = authActionClient
  .inputSchema(acceptInvitationInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { data: existing, error: selectError } = await ctx.supabase
      .from("occurrence_participations")
      .select("id, status")
      .eq("occurrence_id", parsedInput.occurrenceId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (selectError) {
      throw classifyPostgrestLikeError(selectError);
    }

    if (existing === null) {
      const { error: insertError } = await ctx.supabase
        .from("occurrence_participations")
        .insert({
          occurrence_id: parsedInput.occurrenceId,
          user_id: ctx.userId,
          status: "attending",
        });
      if (insertError) {
        // 23505 (unique_violation on (occurrence_id, user_id)): select と
        // insert の間に別リクエストが行を作った稀な race。同じ意図
        // （このoccurrenceに attending になる）を UPDATE として再試行する。
        if (insertError.code === "23505") {
          const { error: retryError } = await ctx.supabase
            .from("occurrence_participations")
            .update({ status: "attending" })
            .eq("occurrence_id", parsedInput.occurrenceId)
            .eq("user_id", ctx.userId);
          if (retryError) {
            throw classifyPostgrestLikeError(retryError);
          }
        } else {
          throw classifyPostgrestLikeError(insertError);
        }
      }
    } else if (existing.status !== "attending") {
      const { error: updateError } = await ctx.supabase
        .from("occurrence_participations")
        .update({ status: "attending" })
        .eq("id", existing.id);
      if (updateError) {
        throw classifyPostgrestLikeError(updateError);
      }
    }
    // else: 既に attending（pending-only モデルでは通常この invitation
    // 自体が既に存在しないはずだが、念のため冪等に成功として扱う）。

    revalidatePath("/catalog/invitations");
    revalidatePath("/mypage");
    revalidatePath("/calendar");
    return { ok: true as const };
  });

const declineInvitationInputSchema = z.object({
  invitationId: invitationIdSchema,
});

const declinedInvitationRowSchema = z.object({
  occurrence_id: occurrenceIdSchema,
  inviter_id: userIdSchema,
  invitee_id: userIdSchema,
});

export interface DeclinedInvitationSnapshotOutput {
  readonly occurrenceId: string;
  readonly inviterId: string;
  readonly inviteeId: string;
}

/**
 * Decline: P3 決定（`docs/v2/decisions.md`）どおり、即座に hard delete して
 * 確定させる。`decline_occurrence_invitation` RPC
 * （`supabase/migrations/20260830000000_simplify_invitation_pending_only.sql`）
 * が対象行を削除して返す。中間状態はサーバに一切持たない — undo の可否は
 * 呼び出し元（client）が保持するこの snapshot だけに依存する。
 *
 * 既に解決済み（他のタブ/操作で先に resolve された）場合、RPC は `null`
 * を返す（idempotent）。この場合 undo に使える snapshot も無いため
 * `snapshot: null` を返す。
 */
export const declineInvitationAction = authActionClient
  .inputSchema(declineInvitationInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { data, error } = await ctx.supabase.rpc(
      "decline_occurrence_invitation",
      { p_invitation_id: parsedInput.invitationId },
    );
    if (error) {
      throw classifyPostgrestLikeError(error);
    }

    revalidatePath("/catalog/invitations");
    revalidatePath("/mypage");

    const parsed = declinedInvitationRowSchema.safeParse(data);
    const snapshot: DeclinedInvitationSnapshotOutput | null = parsed.success
      ? {
          occurrenceId: parsed.data.occurrence_id,
          inviterId: parsed.data.inviter_id,
          inviteeId: parsed.data.invitee_id,
        }
      : null;
    return { snapshot };
  });

const undoDeclineInvitationInputSchema = z.object({
  occurrenceId: occurrenceIdSchema,
  inviterId: userIdSchema,
  inviteeId: userIdSchema,
});

/**
 * Undo: `docs/v2/decisions.md` P3 は「同じ inviter からの pending
 * invitation を作り直す」と記述するが、**現行の RPC/RLS 構成ではこの
 * action の呼び出し元（invitee 本人 - `occurrence_invitations` の SELECT
 * は invitee 限定なので招待一覧を見られるのは invitee だけ）が、
 * inviter に成り代わって invitation を作り直す経路が存在しない**:
 *
 * - `invite_to_occurrence` は `inviter_id := auth.uid()` を必ず採用する。
 *   invitee 本人が呼ぶと `p_invitee_id`（= 元の invitee = 自分自身）との
 *   self-invite になり、無条件に拒否される
 *   （`cannot invite yourself`）。
 * - `occurrence_invitations` テーブルには authenticated 向けの INSERT
 *   grant が一切無く（SECURITY DEFINER RPC 経由の書き込みのみを許可する
 *   設計 - `supabase/migrations/20260822010100_create_occurrence_invitations.sql`）、
 *   direct insert の代替手段も無い。
 * - `apps/web/src/env.ts` が明記するとおり、この app runtime は
 *   service role key を意図的に持たない（`docs/v2/oracle-domain.md`
 *   §4.1）ため、RLS を迂回して代理挿入することもできない。
 *
 * したがって元の invitation を正確に復元するには、invitee が
 * （元 inviter の現在の attending 状態と occurrence の中止状態を
 * re-validate した上で）代理で pending invitation を作れる、新しい
 * SECURITY DEFINER RPC が要る。これは migration の追加を要し、この
 * Task の許可された編集範囲（`apps/web/src/lib/actions/` 等）の外にある。
 * 「決められなかった点」としてこのタスクの報告に明記し、ここでは
 * 成功したふりをせず、また確実に失敗する `invite_to_occurrence` 呼び出し
 * （誤解を招く "cannot invite yourself" エラーになる）も行わず、
 * 分類済みの `failure` を返す。
 */
export const undoDeclineInvitationAction = authActionClient
  .inputSchema(undoDeclineInvitationInputSchema)
  .action(async () => {
    throw new ActionError(
      "failure",
      "招待を復元できませんでした。お手数ですが、招待者に再度の招待を依頼してください。",
    );
  });
