"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { occurrenceIdSchema, userIdSchema } from "@stage-tracker/domain";
import { ActionError } from "@/lib/action-error";
import { authActionClient } from "@/lib/safe-action";
import { inviteToOccurrenceByEmail } from "./invitation";

const inviteToOccurrenceInputSchema = z.object({
  occurrenceId: occurrenceIdSchema,
  // DB RPC (`invite_to_occurrence_by_email`) 自身も `lower(btrim(...))` で
  // 正規化するが、opacity boundary の self-invite pre-check
  // (`inviteToOccurrenceByEmail`) はこの正規化後の値を直接文字列比較する
  // ため、ここで同じ正規化を行っておく。
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

/**
 * `docs/v2/oracle-routes-ui.md` §1/§2 イベント詳細の
 * `inviteToOccurrenceAction`。
 *
 * **opacity**: 成功時に返すのは `./invitation.ts` の
 * `inviteToOccurrenceByEmail` が返す `InviteOutcome`
 * （`'invite-sent'` という単一リテラル）だけ。invitee の3分岐
 * （行なし/considering/attending）のどれが実際に起きたかを表す情報は、
 * この action のどの return 経路にも一切含まれない。
 *
 * revalidate は成功時のみ、`/catalog/invitations`（invitee 側の一覧）だけを
 * 対象にする。inviter 自身のこの画面上の見た目（自分の participation /
 * occurrence 表示）は invite 操作で変化しないため、対象に含めない。
 * この revalidate 呼び出し自体は invitee の3分岐によらず常に同一の
 * タイミング・対象で実行される（決して分岐しない）ため、opacity boundary
 * を破らない。
 */
export const inviteToOccurrenceAction = authActionClient
  .inputSchema(inviteToOccurrenceInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const userId = userIdSchema.parse(ctx.userId);
    const {
      data: { user },
    } = await ctx.supabase.auth.getUser();

    const result = await inviteToOccurrenceByEmail(ctx.supabase, {
      occurrenceId: parsedInput.occurrenceId,
      inviterUserId: userId,
      inviterEmail: user?.email ?? null,
      inviteeEmail: parsedInput.email,
    });

    if (!result.ok) {
      throw new ActionError(result.error.kind, result.error.message);
    }

    revalidatePath("/catalog/invitations");

    return { outcome: result.value };
  });
