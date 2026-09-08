"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  isAuthApiError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { env } from "@/env";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/lib/action-error";

/**
 * `/mypage` の Passkey 削除（`docs/v2/oracle-routes-ui.md` §1 `/mypage`）。
 * 削除は `auth.passkey.delete()`（Supabase Auth 自体の API、WebAuthn
 * ceremony を伴わない通常の authenticated request）で、Server Action に
 * できる —— 登録（`registerPasskey()`）はブラウザの
 * `navigator.credentials.create()` を要するため Client Component 側で
 * 直接呼ぶ（oracle の記述どおり）。
 *
 * `auth.passkey.*` は Supabase Auth の `experimental.passkey: true` flag
 * が有効な client からしか呼べない（有効でないと全メソッドが throw する）。
 * この flag は `@/lib/supabase/server.ts` の共有 `createSupabaseServerClient`
 * には付いていない（このタスクの編集許可範囲外のファイルであり、変更
 * できない）。そのため、このファイル内で同じ cookie 配線を持つ
 * 独立した client をこの1箇所だけのために構築する（重複はこの1呼び出し
 * にとどめる）。`docs/v2/oracle-routes-ui.md` §1 の `/mypage` の Passkey
 * 一覧側（`app/(app)/mypage/_data/passkeySupabaseClient.ts`）も同じ理由で
 * 独自に client を持つ。理想的には共有 factory 側に flag を集約すべきだが
 * それは本タスクの scope 外（このタスクの報告に記録する）。
 */
async function createPasskeyServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { experimental: { passkey: true } },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // apps/web/src/lib/supabase/server.ts の同名コメント参照:
            // Server Component のレンダー中は cookie ストアが read-only。
          }
        },
      },
    },
  );
}

const deletePasskeyInputSchema = z.object({
  passkeyId: z.string().min(1),
});

export const deletePasskeyAction = authActionClient
  .inputSchema(deletePasskeyInputSchema)
  .action(async ({ parsedInput }) => {
    const passkeyClient = await createPasskeyServerClient();
    const { error } = await passkeyClient.auth.passkey.delete({
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

    revalidatePath("/mypage");
    return { ok: true as const };
  });
