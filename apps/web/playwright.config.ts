import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

/**
 * E2E は本番相当のビルド（`next build && next start`）に対して実行する。
 * `env.ts`（`src/env.ts`）の型付き検証は Supabase 接続情報を要求するが、
 * この Task の E2E はプレースホルダページの表示のみを検証し、実際に
 * Supabase Server Action を実行しない（`SKIP_ENV_VALIDATION=1` を使わず、
 * z.url() を満たすダミー値で検証自体は通す）。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
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
      NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-placeholder-anon-key",
    },
  },
});
