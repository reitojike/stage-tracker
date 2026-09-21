"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  personalScheduleEntryIdSchema,
  scheduleShareIdSchema,
} from "@stage-tracker/domain";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/lib/action-error";
import {
  affectedReadSurfaces,
  revalidateReadSurfaces,
} from "@/lib/revalidation";
import {
  addScheduleShareByEmail,
  removeScheduleShare,
} from "./schedule-share-write";
import { getOwnScheduleShareId } from "@/lib/data";

const CALENDAR_PATH = "/calendar";

/**
 * owner が entry に recipient を email 指定で追加する
 * （Spec 012 の sharing semantics; exact action implementation is runtime-owned）。
 *
 * ownership の真の enforcement は
 * `share_schedule_entry_by_email` RPC 自身（SECURITY DEFINER が
 * `is_personal_schedule_entry_owner` を再チェックする）にあり、この
 * action はそれを呼ぶだけ - runtime/schema contract の「各 action は
 * 権限判定を一切行わない」という設計をそのまま踏襲する。
 *
 * `email` の未登録は「知らせてよい」（Spec 012 PSH-006 and its
 * authenticated-user targeting / personal-schedule semantics: sharing に
 * Invitation のような第三者 private state が
 * ないため opacity が要らない）。この action・その先の RPC はどちらも
 * email の存在有無で分岐や隠蔽をせず、RPC が返す結果（成功 or
 * `validation` エラー）をそのまま client へ伝える - これが「知らせてよい」
 * 判断の実装そのものである。
 */
const addScheduleShareByEmailInputSchema = z.object({
  entryId: personalScheduleEntryIdSchema,
  recipientEmail: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください。")
    .email("メールアドレスの形式が正しくありません。"),
});

export const addScheduleShareByEmailAction = authActionClient
  .inputSchema(addScheduleShareByEmailInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await addScheduleShareByEmail(
      ctx.supabase,
      parsedInput.entryId,
      parsedInput.recipientEmail,
    );
    revalidateReadSurfaces(
      affectedReadSurfaces.scheduleShareWrite(parsedInput.entryId),
    );
  });

/**
 * owner が既存 recipient を除去する
 * （Spec 012 の owner revoke semantics）。「owner の recipient『解除』は
 * 確認なしの即時実行」につき、
 * 削除（entry 自体の hard delete）とは異なり画面に留まる - `redirect` せず
 * affected read surface の再検証のみ。
 */
const removeScheduleShareAsOwnerInputSchema = z.object({
  entryId: personalScheduleEntryIdSchema,
  shareId: scheduleShareIdSchema,
});

export const removeScheduleShareAsOwnerAction = authActionClient
  .inputSchema(removeScheduleShareAsOwnerInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await removeScheduleShare(
      ctx.supabase,
      parsedInput.entryId,
      parsedInput.shareId,
    );
    revalidateReadSurfaces(
      affectedReadSurfaces.scheduleShareWrite(parsedInput.entryId),
    );
  });

/**
 * 非owner の自己離脱（Spec 012 の recipient self-leave semantics）。**削除（owner-only hard delete）とは
 * 別の operation** であることをこの action の入力形状自体で表現する:
 * 引数は `shareId` ではなく `entryId` のみ受け取り、削除対象の shareId は
 * 「呼び出した本人（`ctx.userId`）が、この entry に対して持つ自分自身の
 * share row」をこの action が自分で解決する（`getOwnScheduleShareId`）。
 *
 * この「自分自身の share」束縛は、入力形状（`shareId` を受け取らないこと）
 * だけでは成立しない点に注意する。`personal_schedule_shares_select_owner_
 * or_recipient` RLS は recipient 本人だけでなく **entry owner にもその
 * entry の全 share row の SELECT を許可している**ため、owner がこの action
 * を直接呼んだ場合、`entryId` だけの絞り込みでは recipient 全員の share
 * row が見えてしまう。そのため `getOwnScheduleShareId` へ
 * 認証済み context の `ctx.userId` を渡し、
 * `shared_with_user_id = ctx.userId` まで絞ってはじめて「自分の共有だけを
 * 対象にする」不変条件が成立する。
 *
 * 成功時は `/calendar` へ redirect（runtime contract; 「非owner の
 * 『共有から外れる』は確認なしの即時実行、
 * 成功で `/calendar` へ redirect」）- owner の recipient 解除が画面に
 * 留まるのとは異なる導線。
 */
const removeScheduleShareInputSchema = z.object({
  entryId: personalScheduleEntryIdSchema,
});

export const removeScheduleShareAction = authActionClient
  .inputSchema(removeScheduleShareInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const ownShareResult = await getOwnScheduleShareId(
      ctx.supabase,
      parsedInput.entryId,
      ctx.userId,
    );
    if (!ownShareResult.ok) {
      throw new ActionError(
        ownShareResult.error.kind,
        ownShareResult.error.message,
      );
    }
    const ownShareId = ownShareResult.value;
    if (ownShareId === null) {
      throw new ActionError("not-found", "対象の共有が見つかりませんでした。");
    }
    await removeScheduleShare(ctx.supabase, parsedInput.entryId, ownShareId);
    revalidateReadSurfaces(
      affectedReadSurfaces.scheduleShareWrite(parsedInput.entryId),
    );
    redirect(CALENDAR_PATH);
  });
