"use server";

import { z } from "zod";
import {
  isAuthApiError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/lib/action-error";
import {
  affectedReadSurfaces,
  revalidateReadSurfaces,
} from "@/lib/revalidation";

/**
 * `/mypage` の Passkey 削除（`docs/v2/oracle-routes-ui.md` §1 `/mypage`）。
 * 削除は `auth.passkey.delete()`（Supabase Auth 自体の API、WebAuthn
 * ceremony を伴わない通常の authenticated request）で、Server Action に
 * できる —— 登録（`registerPasskey()`）はブラウザの
 * `navigator.credentials.create()` を要するため Client Component 側で
 * 直接呼ぶ（oracle の記述どおり）。
 *
 * `auth.passkey.*` の experimental capability と cookie wiring は
 * `@/lib/supabase/server.ts` の shared factory が所有する。認証済み
 * `authActionClient` の ctx client をそのまま使い、action 内で client を
 * 作り直さない。
 */
const deletePasskeyInputSchema = z.object({
  passkeyId: z.string().min(1),
});

export const deletePasskeyAction = authActionClient
  .inputSchema(deletePasskeyInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { error } = await ctx.supabase.auth.passkey.delete({
      passkeyId: parsedInput.passkeyId,
    });
    if (error) {
      if (
        isAuthSessionMissingError(error) ||
        (isAuthApiError(error) && [401, 403].includes(error.status ?? 0))
      ) {
        throw new ActionError("unauthenticated", "サインインが必要です。");
      }
      // Supabase Auth の生 error.message を client へ渡さない
      // （`@/lib/safe-action.ts` の `toActionErrorShape` が分類されて
      // いない例外に対して行う扱いと同じ方針）。詳細は server 側の
      // ログにのみ残す。
      console.error("[passkey] delete failed", error);
      throw new ActionError("failure", "Passkeyの削除に失敗しました。");
    }

    revalidateReadSurfaces(affectedReadSurfaces.passkeyDelete());
    return { ok: true as const };
  });
