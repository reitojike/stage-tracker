import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * review finding 1 への回帰テスト: `deletePasskeyAction` が Supabase Auth の
 * 生 `error.message` を client へそのまま返していた（`@/lib/safe-action.ts`
 * の `toActionErrorClass` が分類されていない例外に対して行う「生メッセージを
 * client へ渡さない」扱いを、この action だけが `ActionError` 経由で
 * バイパスしていた）。修正後は固定の日本語文言だけを返し、生メッセージは
 * `console.error` で server 側にのみ残す。
 *
 * `authActionClient` が shared server factory から渡す ctx client の
 * `auth.passkey.delete()` を差し替えて Supabase Auth の応答を制御する。
 */

const mockGetUser = vi.fn<(...args: unknown[]) => unknown>();
const mockPasskeyDelete = vi.fn<(...args: unknown[]) => unknown>();
const mockRevalidatePath = vi.fn<(...args: unknown[]) => unknown>();
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser, passkey: { delete: mockPasskeyDelete } },
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
