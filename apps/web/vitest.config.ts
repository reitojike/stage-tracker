import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // e2e/support は Playwright の journey ではなく、その足回り（接続先の
    // 検査など）の純関数。Playwright は *.spec.ts だけを拾うよう
    // playwright.config.ts の testMatch で明示してあるので、ここで
    // *.test.ts を拾っても二重実行にはならない。
    include: ["src/**/*.test.{ts,tsx}", "e2e/**/*.test.ts"],
    css: false,
  },
});
