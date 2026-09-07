"use server";

import { z } from "zod";
import { authActionClient } from "@/lib/safe-action";

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
 */
export const pingAction = authActionClient
  .inputSchema(pingInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    return {
      echoedMessage: parsedInput.message,
      userId: ctx.userId,
    };
  });
