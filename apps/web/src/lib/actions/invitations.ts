"use server";

import { z } from "zod";
import {
  invitationIdSchema,
  occurrenceIdSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import { ActionError, GENERIC_FAILURE_MESSAGE_JA } from "@/lib/action-error";
import { authActionClient } from "@/lib/safe-action";
import { setParticipationChoice } from "./participation";
import {
  affectedReadSurfaces,
  revalidateReadSurfaces,
} from "@/lib/revalidation";

/**
 * `/catalog/invitations` の書き込み層
 * （`docs/v2/oracle-routes-ui.md` §1 `/catalog/invitations`）。
 */

/**
 * Accept: specs/001-occurrence-participation/spec.md Invitation Requirements /
 * decisions.md 「accept は専用 RPC を持た
 * ない」— 通常の participation write（`considering`/rowなし ->
 * `attending`）と全く同一の operation として実装する。書き込みが成功すると
 * DB 側の `resolve_pending_invitations_on_attending` トリガーが、同一
 * occurrence への他の pending invitation も含めて自動的に解決する
 * （`supabase/migrations/20260830000000_simplify_invitation_pending_only.sql`）
 * ため、この action 自身は invitation テーブルに一切触れない。
 *
 * **書き込みは `setParticipationChoice` をそのまま使う。** 当初はここで
 * SELECT -> INSERT/UPDATE を独自に組んでいたが、それでは「同一の
 * operation」という上記の主張がコード上は成立しておらず、実際 PR #383 が
 * participation 側で直した 0 行 UPDATE race（SELECT と UPDATE の間に対象行が
 * 並行 withdraw で消えても PostgREST は成功を返す）を、こちらだけが抱えた
 * ままだった。同じ競合処理を 2 箇所で持たない（PR #384 review）。
 */
const acceptInvitationInputSchema = z.object({
  occurrenceId: occurrenceIdSchema,
});

export const acceptInvitationAction = authActionClient
  .inputSchema(acceptInvitationInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const userId = userIdSchema.parse(ctx.userId);

    const result = await setParticipationChoice(ctx.supabase, {
      occurrenceId: parsedInput.occurrenceId,
      userId,
      choice: "attending",
    });

    if (!result.ok) {
      throw new ActionError(result.error.kind, result.error.message);
    }

    // Accept is the same attending transition as the generic participation
    // action, including the trigger-driven invitation convergence. The
    // invitation action only has an occurrence id, so resolve the concrete
    // event-detail path without changing the write boundary or result shape.
    const { data: occurrence } = await ctx.supabase
      .from("event_occurrences")
      .select("event_id")
      .eq("id", parsedInput.occurrenceId)
      .maybeSingle();
    if (occurrence === null) {
      revalidateReadSurfaces(affectedReadSurfaces.participationConvergence());
    } else {
      revalidateReadSurfaces(
        affectedReadSurfaces.participationWrite(
          occurrence.event_id,
          "attending",
        ),
      );
    }
    return { ok: true as const };
  });

const declineInvitationInputSchema = z.object({
  invitationId: invitationIdSchema,
});

/**
 * Decline: P3 決定（`docs/v2/decisions.md`）どおり、即座に hard delete して
 * 確定させる。`decline_occurrence_invitation` RPC
 * （`supabase/migrations/20260830000000_simplify_invitation_pending_only.sql`）
 * が対象行を削除して返す。中間状態はサーバに一切持たない。
 *
 * 既に解決済み（他のタブ/操作で先に resolve された）場合、RPC は `null`
 * を返す（idempotent）。
 *
 * **エラー分類は単一の opaque failure。** `decline_occurrence_invitation`
 * （`supabase/migrations/20260830000000_simplify_invitation_pending_only.sql`）
 * は `raise exception` に `using errcode` を一切指定しておらず、custom
 * SQLSTATE を発生させない（未認証/invitationId 欠落の2箇所のみで、いずれも
 * `authActionClient`/zod スキーマにより実際には到達しない）。したがって
 * SQLSTATE 別に分岐する classifier（`duplicate-occurrence`/`delete-blocked`/
 * `occurrence-canceled` 等）は、このRPCに対しては到達不能な分岐を宣言する
 * だけになるため使わない（Issue #500 AC: unreachable classifier branches
 * をテストだけのために維持しない）。
 */
export const declineInvitationAction = authActionClient
  .inputSchema(declineInvitationInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { error } = await ctx.supabase.rpc("decline_occurrence_invitation", {
      p_invitation_id: parsedInput.invitationId,
    });
    if (error) {
      console.error("[invitation decline] unclassified PostgREST error", {
        code: error.code,
        message: error.message,
      });
      throw new ActionError("failure", GENERIC_FAILURE_MESSAGE_JA);
    }

    revalidateReadSurfaces(affectedReadSurfaces.invitationDecline());
    return { ok: true as const };
  });
