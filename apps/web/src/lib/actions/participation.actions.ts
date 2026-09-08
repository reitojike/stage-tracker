"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  eventIdSchema,
  occurrenceIdSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import { ActionError } from "@/lib/action-error";
import { authActionClient } from "@/lib/safe-action";
import { PARTICIPATION_CHOICES, setParticipationChoice } from "./participation";

const setParticipationChoiceInputSchema = z.object({
  // revalidatePath のスコープ算出にのみ使う（このタスクの制約により
  // `apps/web/src/lib/data/` は変更しないため、`occurrenceId` からその
  // event を逆引きする read boundary はここには無い）。呼び出し元
  // (`ParticipationControls`) は自分が描画している event のページから
  // 呼ぶ以外に用途が無く、誤った eventId を渡しても data 到達範囲は
  // 変えず、無関係なキャッシュパスを再検証するだけで安全側に倒れる。
  eventId: eventIdSchema,
  occurrenceId: occurrenceIdSchema,
  choice: z.enum(PARTICIPATION_CHOICES),
});

/**
 * `docs/v2/oracle-routes-ui.md` §1 `setParticipationChoiceAction`。
 *
 * revalidate 対象（oracle §1 補足「影響する経路だけを個別指定する」）:
 * - `/catalog/events/[eventId]`: この画面自体の participation 表示
 * - `/calendar`: `listMyParticipations` を読む個人カレンダー
 * - `/`: ホームの「直近の予定」ブロックも同じ read を使う
 * - `/catalog/invitations`: `attending` への遷移は DB trigger
 *   (`resolve_pending_invitations_on_attending`) が同一
 *   occurrence/invitee の pending invitation を副作用で解消するため
 */
export const setParticipationChoiceAction = authActionClient
  .inputSchema(setParticipationChoiceInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const userId = userIdSchema.parse(ctx.userId);

    const result = await setParticipationChoice(ctx.supabase, {
      occurrenceId: parsedInput.occurrenceId,
      userId,
      choice: parsedInput.choice,
    });

    if (!result.ok) {
      throw new ActionError(result.error.kind, result.error.message);
    }

    revalidatePath(`/catalog/events/${parsedInput.eventId}`);
    revalidatePath("/calendar");
    revalidatePath("/");
    revalidatePath("/catalog/invitations");

    return { choice: parsedInput.choice };
  });
