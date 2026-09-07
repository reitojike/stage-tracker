"use server";

import { z } from "zod";
import { authActionClient } from "@/lib/safe-action";
import { resolveServerTokyoDate } from "@/lib/tokyo-date";

const pingInputSchema = z.object({
  message: z.string().trim().min(1).max(200),
});

/**
 * 動作確認用の最小 Server Action。
 *
 * env（`src/env.ts`）→ Supabase server client（`src/lib/supabase/server.ts`）
 * → 認証チェック（`authActionClient`、`src/lib/safe-action.ts`）→ 共通
 * error kind 語彙（`src/lib/action-error.ts`）の配線が実際に動作している
 * ことを確認するためのアクション。認証済みセッションが無い状態で呼べば
 * `unauthenticated` kind のエラーが返り、これも配線が正しく動いている
 * ことの証跡になる（サインイン UI は本 Task の scope 外のため未実装）。
 *
 * `serverTokyoDate` は `@stage-tracker/ui` 配線と同じく M6 で新たに配線した
 * `@stage-tracker/domain` の実使用箇所。「今」を読む（`Date.now()`）のは
 * clock-free な domain package ではなくこの application 層であり、
 * domain 側の `instantToTokyoCalendarDate`/`epochMsToInstant` は「今」を
 * 引数として受け取るだけ（`@/lib/tokyo-date.ts` 参照）。product 上の日付
 * 境界が `Asia/Tokyo` であること（AGENTS.md 時刻・タイムゾーン節）の配線が
 * 実際に動くことを、この ping action でも合わせて確認する。
 */
export const pingAction = authActionClient
  .inputSchema(pingInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    return {
      echoedMessage: parsedInput.message,
      userId: ctx.userId,
      serverTokyoDate: resolveServerTokyoDate(Date.now()),
    };
  });
