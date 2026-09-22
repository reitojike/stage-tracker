import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * 型付き環境変数スキーマ。
 *
 * 通常の browser / Route Handler / Server Action / Server Component は anon
 * key + Auth/RLS の境界を維持する。official ingestion Workflow だけが
 * Production-only の dedicated Supabase secret key を使い、その client は
 * `src/workflows/official-import/privileged` に隔離する。secret は build/CI では
 * 不要なので optional とし、Workflow 実行時に専用 factory が fail-closed する。
 */
export const env = createEnv({
  server: {
    STAGE_TRACKER_INGESTION_SUPABASE_SECRET_KEY: z
      .string()
      .startsWith("sb_secret_")
      .optional(),
    JEV_API_KEY: z.string().min(1).optional(),
    FIRECRAWL_API_KEY: z.string().min(1).optional(),
  },
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
