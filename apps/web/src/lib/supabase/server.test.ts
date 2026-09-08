import { describe, expect, it, vi } from "vitest";

/**
 * PR #386 review（Codex）への回帰テスト。
 *
 * Preview で Production Supabase へ authenticated 接続しないという保証を、
 * **消費側の guard ではなく client factory** が与えていることを固定する。
 *
 * 当初は `authActionClient` / `requireAuthenticatedUserId` を個別に守って
 * いたが、`sign-out/actions.ts` のように guard を経由しない authenticated
 * 経路が穴になった。ここで検証するのは「factory が cookie を渡さないので、
 * guard を持たない経路でも session が成立しない」ことである。
 */
const mockGetAll = vi.fn(() => [
  { name: "sb-example-auth-token", value: "production-session" },
]);
const mockSet = vi.fn();
const mockIsPreview = vi.fn();
const capturedCookieOptions: { current: unknown } = { current: null };

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: mockGetAll, set: mockSet })),
}));

vi.mock("@/lib/auth/vercel-environment", () => ({
  isPreviewDeployment: () => mockIsPreview(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: unknown) => {
    capturedCookieOptions.current = options;
    return { auth: {} };
  }),
}));

const { createSupabaseServerClient } = await import("./server.js");

interface CookieOptions {
  cookies: {
    getAll: () => unknown[];
    setAll: (
      toSet: { name: string; value: string; options: unknown }[],
    ) => void;
  };
}

async function cookieAdapter(): Promise<CookieOptions["cookies"]> {
  await createSupabaseServerClient();
  return (capturedCookieOptions.current as CookieOptions).cookies;
}

describe("createSupabaseServerClient: Preview deployment", () => {
  it("preview では session cookie を Supabase へ渡さない", async () => {
    mockIsPreview.mockReturnValue(true);
    mockGetAll.mockClear();

    const adapter = await cookieAdapter();

    // 実際に cookie が存在していても、Supabase には空で渡る。
    expect(adapter.getAll()).toEqual([]);
  });

  it("preview では session cookie を発行しない", async () => {
    mockIsPreview.mockReturnValue(true);
    mockSet.mockClear();

    const adapter = await cookieAdapter();
    adapter.setAll([
      { name: "sb-example-auth-token", value: "new", options: {} },
    ]);

    expect(mockSet).not.toHaveBeenCalled();
  });

  it("preview でなければ従来どおり cookie を読み書きする", async () => {
    mockIsPreview.mockReturnValue(false);
    mockSet.mockClear();

    const adapter = await cookieAdapter();

    expect(adapter.getAll()).toEqual([
      { name: "sb-example-auth-token", value: "production-session" },
    ]);
    adapter.setAll([
      { name: "sb-example-auth-token", value: "new", options: {} },
    ]);
    expect(mockSet).toHaveBeenCalledWith("sb-example-auth-token", "new", {});
  });
});
