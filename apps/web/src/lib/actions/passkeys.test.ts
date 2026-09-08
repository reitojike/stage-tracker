import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * review finding 1 への回帰テスト: `deletePasskeyAction` が Supabase Auth の
 * 生 `error.message` を client へそのまま返していた（`@/lib/safe-action.ts`
 * の `toActionErrorClass` が分類されていない例外に対して行う「生メッセージを
 * client へ渡さない」扱いを、この action だけが `ActionError` 経由で
 * バイパスしていた）。修正後は固定の日本語文言だけを返し、生メッセージは
 * `console.error` で server 側にのみ残す。
 *
 * `deletePasskeyAction` は `@supabase/ssr` の `createServerClient` を
 * `next/headers` の cookie と一緒にこのファイル内で直接構築するため
 * （`passkeys.ts` 冒頭のコメント参照）、それらを差し替えて Supabase Auth の
 * 応答を制御する。`authActionClient`（`@/lib/safe-action.ts`）が使う
 * `createSupabaseServerClient`（`@/lib/supabase/server`）も同様に差し替え、
 * 認証済み扱いにする。
 */

const mockGetUser = vi.fn();
const mockPasskeyDelete = vi.fn();
const mockRevalidatePath = vi.fn();
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { passkey: { delete: mockPasskeyDelete } },
  })),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const { deletePasskeyAction } = await import("./passkeys.js");

describe("deletePasskeyAction", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockPasskeyDelete.mockReset();
    mockRevalidatePath.mockReset();
    mockConsoleError.mockClear();
    mockGetUser.mockResolvedValue({
      data: {
        user: { id: "11111111-1111-4111-8111-111111111111" },
      },
      error: null,
    });
  });

  it("never lets Supabase's raw error.message reach the client and returns a fixed message instead", async () => {
    const rawMessage = "secret internal detail";
    mockPasskeyDelete.mockResolvedValue({
      error: { message: rawMessage, name: "SomeUnclassifiedAuthError" },
    });

    const result = await deletePasskeyAction({ passkeyId: "passkey-1" });

    expect(result.serverError?.message).not.toContain(rawMessage);
    expect(result.serverError).toEqual({
      kind: "failure",
      message: "Passkeyの削除に失敗しました。",
    });
    // 生詳細は server 側ログにのみ残す。
    expect(mockConsoleError).toHaveBeenCalled();
  });

  it("succeeds and revalidates /mypage when Supabase reports no error", async () => {
    mockPasskeyDelete.mockResolvedValue({ error: null });

    const result = await deletePasskeyAction({ passkeyId: "passkey-1" });

    expect(result.data).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/mypage");
  });
});
