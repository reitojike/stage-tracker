import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isPreviewDeployment } from "@/lib/auth/vercel-environment";
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
 *
 * ## Preview では session cookie を Supabase へ渡さない
 *
 * PO 判断（`docs/v2/decisions.md`「PO 判断: Preview 環境の位置づけ」）に
 * より、Vercel Preview は Production Supabase へ authenticated 接続しない。
 *
 * **この保証はここで構造的に与える。** 当初は消費側（`authActionClient` /
 * `requireAuthenticatedUserId`）を 1 つずつ守っていたが、その方式では
 * 「guard を通らない新しい authenticated 経路」が生まれるたびに穴が開く。
 * 実際 PR #386 review で `sign-out/actions.ts` がその穴として見つかった
 * （`authActionClient` を経由せず `auth.signOut()` を直接呼ぶため、
 * Production の session を無効化できてしまう）。
 *
 * この factory は、server 側で session cookie を Supabase へ渡す唯一の
 * 経路である。preview では cookie を渡さない（読みも書きもしない）ため、
 * `getUser()` はどこから呼ばれても null になり、`signOut()` は
 * session を持たない client 上の no-op になる。**新しい authenticated
 * 経路を足すときに guard を思い出す必要が無い。**
 *
 * 消費側に残っている preview チェックは fail-fast（ネットワーク往復の前に
 * 止める）であって、correctness を担っているのはこの factory である。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const previewDeployment = isPreviewDeployment();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          // preview では session を一切渡さない（上記コメント参照）。
          return previewDeployment ? [] : cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          if (previewDeployment) {
            // preview では session cookie を発行しない。
            return;
          }
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
