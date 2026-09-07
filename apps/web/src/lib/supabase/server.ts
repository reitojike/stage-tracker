import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/env";

/**
 * Server Component / Route Handler / Server Action からの通常の
 * read/write 用の Supabase client。
 *
 * `docs/v2/oracle-domain.md` §4.1 の現行 3 系統のうち、server client に
 * 対応する。anon key のみを使い、`next/headers` の `cookies()` から
 * セッションを読み書きする。
 *
 * Server Component のレンダー中は cookie ストアが read-only であり
 * `setAll` が失敗し得る。この失敗は握りつぶしてよい設計とする——ただし、
 * この判断は「middleware 相当の層が毎リクエストでセッション refresh を
 * 担保している」ことに依存する（`docs/v2/oracle-domain.md` §4.3）。
 * その前提は `src/proxy.ts` の default-deny middleware で満たされている。
 *
 * 呼び出しごとに新しい client を生成すること（request をまたいで
 * 共有しないこと）は `@supabase/ssr` 自身の要件。
 *
 * Database 型は Supabase 生成型がまだ無いため未指定（生成された後は
 * `createServerClient<Database>(...)` のように型引数を渡すだけで
 * 差し込める）。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
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
            // であり得る。session refresh を担保する middleware が
            // 別途あることが前提の意図的な握りつぶし（上記コメント参照）。
          }
        },
      },
    },
  );
}

/**
 * cookie を読むが一切書き込まない Supabase client。
 *
 * `docs/v2/oracle-domain.md` §4.1 の現行 3 系統のうち、cookieless server
 * client に対応する。唯一の用途は magic link 送信（`signInWithOtp`）。
 *
 * 理由: `@supabase/ssr` は PKCE code verifier を、対象アドレスにアカウントが
 * 存在する場合は cookie として書き込み、存在しない場合はむしろ既存の
 * verifier cookie を消去する。つまり sign-in request のレスポンスに
 * 現れる Set-Cookie の有無・差分そのものが「そのメールアドレスのアカウント
 * が存在するか」を漏らす account-existence oracle になり得る。この
 * enumeration を防ぐため、sign-in request では応答側に一切の cookie
 * 差分を残さない（`setAll` を no-op にする）。
 *
 * これで失われるものはない: 実際のサインイン完了は magic link 自体に
 * 埋め込まれた `token_hash` を使う `verifyOtp({ token_hash })`
 * （`/auth/confirm`）経由であり、code verifier を必要としない。
 */
export async function createSupabaseCookielessServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // 意図的に何もしない（上記コメント参照）。
        },
      },
    },
  );
}
