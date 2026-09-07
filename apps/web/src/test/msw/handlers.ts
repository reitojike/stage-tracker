import { http, HttpResponse } from "msw";

/**
 * テスト全体で共有する既定の MSW handler。
 * 個々のテストで追加の handler が必要な場合は `server.use(...)` で
 * 一時的に上書きする（`src/test/setup.ts` の `afterEach` で自動的に
 * `resetHandlers()` されるため、上書きはテスト間に漏れない）。
 */
export const handlers = [
  http.get("https://example.test/api/ping", () => {
    return HttpResponse.json({ message: "pong" });
  }),
];
