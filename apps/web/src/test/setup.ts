import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

// テスト間で jsdom へ残った DOM をクリーンにする（React Testing Library）。
afterEach(() => {
  cleanup();
});

// MSW server のライフサイクル。listen は最初に一度、resetHandlers は各テスト後、
// close は全テスト終了後。`onUnhandledRequest: "error"` により、意図せず
// mock されていないネットワークリクエストが飛んだ場合にテストを失敗させる。
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
