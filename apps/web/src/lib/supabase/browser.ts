import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/env";
import type { Database } from "@/lib/data/database.types";

/**
 * Client Component から直接呼ぶ操作のための Supabase client。
 *
 * `docs/architecture/authentication.md` の browser/server separation における
 * browser client。anon key のみを
 * 使い、cookie の読み書きは `@supabase/ssr` の browser 既定
 * （ブラウザの cookie storage）に任せる。
 *
 * Passkey Auth API は supabase-js でデフォルト有効になっている。呼び出しごとに client を
 * 生成する設計と browser の既定 cookie storage は維持する。
 *
 * 生成済み Database 型を client factory に接続し、schema/table/column/RPC
 * の drift を TypeScript boundary で検知する。これは runtime の client
 * semantics とは独立した type-safety の責務である。呼び出しごとに client
 * を生成する設計と browser cookie behavior はそのまま維持する。
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
