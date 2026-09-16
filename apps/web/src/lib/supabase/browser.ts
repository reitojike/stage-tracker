import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/env";
import type { Database } from "@/lib/data/database.types";

/**
 * Client Component から直接呼ぶ操作のための Supabase client。
 *
 * `docs/v2/oracle-domain.md` §4.1 の現行 3 系統（browser / server /
 * cookieless-server）のうち、browser client に対応する。anon key のみを
 * 使い、cookie の読み書きは `@supabase/ssr` の browser 既定
 * （ブラウザの cookie storage）に任せる。
 *
 * 現行の唯一の用途は passkey の WebAuthn ceremony（ブラウザ API を直接
 * 必要とするため Server Action にできない）だが、v2 のこの段階では
 * passkey 機能自体が未実装。呼び出し元が無いまま先行実装しないという
 * 方針とのバランスとして、配線（このファイル）だけをここで用意し、
 * 実際の呼び出しは passkey 機能を実装する Task 側に委ねる。
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
