import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * 型付き環境変数スキーマ。
 *
 * 現時点で必要なのは Supabase 接続情報のみ（`docs/v2/oracle-domain.md`
 * §4.1「Supabase client の使い分け」参照）。app runtime（このアプリ）が
 * 使う Supabase client は anon key のみで、service role key を必要と
 * する操作（operator import 等）は app runtime の外（CI/operator
 * script/Trigger.dev job）に閉じる設計を v2 でも維持する。したがって
 * service role key はこのスキーマへ含めない。将来 app runtime 側で
 * 本当に必要になった時点で、`server` 側にのみ追加すること
 * （NEXT_PUBLIC_ prefix を絶対に付けないこと）。
 */
export const env = createEnv({
  server: {},
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  // CI のビルド（lint/typecheck/build を含む）や env 未設定のローカル環境で
  // `pnpm run build` 自体を壊さないための慣用的な逃げ道。実行時に本当に
  // Supabase へ接続する経路（Server Action 実行等）は検証をスキップしても
  // 依然として失敗するので、これは「ビルドを通す」以上の意味を持たない。
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === "1" ||
    process.env.SKIP_ENV_VALIDATION === "true",
  emptyStringAsUndefined: true,
});
