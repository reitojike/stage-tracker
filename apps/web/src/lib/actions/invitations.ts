"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  invitationIdSchema,
  occurrenceIdSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import { authActionClient } from "@/lib/safe-action";
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
 * が対象行を削除して返す。中間状態はサーバに一切持たない。
 *
 * 既に解決済み（他のタブ/操作で先に resolve された）場合、RPC は `null`
 * を返す（idempotent）。
 *
 * この action は削除された行の `snapshot`（occurrence/inviter/invitee）を
 * 引き続き返す。M6d の client はこれを消費しない（undo UI を持たないため -
 * 下記コメント参照）が、Issue #382 が「同じ inviter からの pending
 * invitation を作り直す」undo を実装する際にこの情報が必要になるため、
 * RPC が無償で返す値を捨てずに残す。
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

/**
 * Undo（decline の取り消し）は M6d の scope に無い。実測により、現行の
 * RPC/RLS 構成では invitee 側から invitation を作り直す経路が存在しない
 * ことが判明したため（PO 判断、`docs/v2/decisions.md`「P3 の実装可否」
 * 節参照）:
 *
 * - `occurrence_invitations` への `authenticated` grant は SELECT のみで
 *   INSERT が無い（SECURITY DEFINER RPC 経由の書き込みのみを許可する設計）。
 * - `invite_to_occurrence` / `_by_email` は `inviter_id := auth.uid()` に
 *   束縛される。invitee 本人が呼ぶと元の invitee（= 自分自身）との
 *   self-invite になり無条件に拒否される。
 * - `apps/web/src/env.ts` が明記するとおりこの app runtime は service role
 *   key を意図的に持たないため、RLS を迂回した代理挿入もできない。
 *
 * 復元には invitee が代理で pending invitation を作れる新しい SECURITY
 * DEFINER RPC が要り、migration の追加を伴うため、この Task の許可された
 * 編集範囲の外にある。**Issue #382 で undo（復元 RPC 追加）を対応する。**
 * それまで、動かない undo action/UI は持たない（成功を装う・確実に失敗する
 * `invite_to_occurrence` 呼び出しへ迂回する、のいずれも行わない）。
 */
