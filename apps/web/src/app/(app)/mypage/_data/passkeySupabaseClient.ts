import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/env";

/**
 * `auth.passkey.*`（一覧/削除）専用の server client。
 *
 * `@/lib/supabase/server.ts` の共有 `createSupabaseServerClient` には
 * Supabase Auth の `experimental.passkey: true` flag が付いていない
 * （このタスクで編集できる範囲外のファイル）ため、この機能専用に同じ
 * cookie 配線を持つ client を独立して構築する。`@/lib/actions/passkeys.ts`
 * の `deletePasskeyAction` も同じ理由で同型の client を持つ（write boundary
 * 側は `apps/web/src/lib/actions/` 配下という別スコープのため、この file
 * を import せず自己完結させている）。
 */
export async function createPasskeyServerClient() {
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
            // Server Component のレンダー中は cookie ストアが read-only
            // であり得る（`@/lib/supabase/server.ts` と同じ意図的な握り
            // つぶし）。
          }
        },
      },
    },
  );
}
