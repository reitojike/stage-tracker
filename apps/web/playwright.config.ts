import { defineConfig, devices } from "@playwright/test";
import { readLocalSupabaseStatus } from "./e2e/support/localSupabase";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

/**
 * E2E runs against a production-equivalent build (`next build && next
 * start`) targeting a real local Supabase stack (Issue #380 - "Playwright
 * の E2E が主要 journey をカバーし、CI で実行される"). The journeys under
 * `./e2e` sign in through the real `/sign-in` -> Mailpit -> `/auth/confirm`
 * path and exercise real Server Actions/RPCs/RLS, so this can no longer use
 * placeholder Supabase credentials the way the original M0 placeholder
 * suite did.
 *
 * `NEXT_PUBLIC_*` values must be real at *build* time too, not only at
 * runtime: Next.js substitutes `NEXT_PUBLIC_*` into client bundles during
 * `next build` (server code reads them from `process.env` at request time
 * instead). Reading the local stack's status once
 * here and passing it into `webServer.env` covers both build and start,
 * since `next build && next start` runs as one process inheriting the same
 * env.
 *
 * The local stack must already be running before `playwright test` starts
 * (`pnpm run verify:database:start` + `supabase db reset` - see
 * `apps/web/README.md`/this repo's CI `Verify / E2E` job); this call fails
 * fast with a clear error otherwise, rather than silently falling back to
 * placeholder values that would make every journey fail at sign-in.
 */
const supabaseStatus = readLocalSupabaseStatus();

export default defineConfig({
  testDir: "./e2e",
  // *.spec.ts だけが journey。e2e/support 配下の *.test.ts は Playwright の
  // 既定 testMatch にも当たるが、あちらは Vitest が実行する純関数のテスト
  // なので、ここで明示的に除外する。
  testMatch: "**/*.spec.ts",
  // Every journey provisions/tears down its own Supabase Auth users and
  // catalog rows (no shared fixtures across files), so nothing here is
  // unsafe to interleave. `workers` is nonetheless pinned to 1 below: this
  // suite is genuine integration testing against one shared local Supabase
  // stack and one single `next start` process, not mocked units, and
  // running journeys one at a time keeps Mailpit polling / Postgres load
  // predictable rather than trading a few seconds of wall-clock time for a
  // flakier CI signal.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // `docs/ux-ui.md` は「stage-tracker は smartphone-first。desktop は
  // secondary」「mobile experience を desktop 版の縮小版にはしない」と
  // している。desktop だけで journey を回すと、**主要な形態**の reflow・
  // bottom navigation・フォーム操作が壊れても CI は成功してしまう
  // （PR #386 review, Codex）。主要形態を先に置き、両方で同じ journey を
  // 回す。実行時間は約 2 倍になるが、journey は 5 本なので許容範囲。
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `next build && next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseStatus.apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseStatus.anonKey,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
