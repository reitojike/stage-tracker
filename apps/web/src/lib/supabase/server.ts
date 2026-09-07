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
 * `setAll` が失敗し得る。現行同様、この失敗は握りつぶしてよい設計とする
 * ——ただし、この判断は「middleware 相当の層が毎リクエストでセッション
 * refresh を担保している」ことに依存する。v2 はまだ default-deny の
 * middleware（現行の `src/proxy.ts` 相当）を持たないため、その前提は
 * 今はまだ成立していない。この関数自体は今回の Task（配線）の対象として
 * 現行と同じ回避方法を実装するが、実際に session refresh を担保する
 * middleware の追加は別 Task の scope として持ち越す。
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
