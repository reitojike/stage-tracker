import { describe, expect, it, vi } from "vitest";

/**
 * PR #386 review（Codex P1）への回帰テスト。
 *
 * `proxy.ts` の preview 判定は pathname ベースなので、Server Action は
 * 迂回できる。action ID を持つ POST は公開 pathname の `/sign-in` 宛に
 * 送れるため、proxy が素通しした後にこの boundary が Production の
 * session cookie を有効な user として受理してしまう経路があった。
 *
 * 認証境界そのもので拒否していることを固定する。
 */
const mockGetUser = vi.fn();
const mockIsPreview = vi.fn();

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

vi.mock("@/lib/auth/vercel-environment", () => ({
  isPreviewDeployment: () => mockIsPreview(),
}));

const { authActionClient } = await import("./safe-action.js");

const probeAction = authActionClient.action(async ({ ctx }) => ({
  userId: ctx.userId,
}));

const VALID_USER = {
  data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
  error: null,
};

describe("authActionClient", () => {
  it("preview では有効な session があっても実行しない", async () => {
    mockIsPreview.mockReturnValue(true);
    mockGetUser.mockResolvedValue(VALID_USER);

    const result = await probeAction();

    expect(result.data).toBeUndefined();
    expect(result.serverError).toEqual({
      kind: "unauthenticated",
      message: "サインインが必要です。",
    });
    // Supabase へ問い合わせる前に止まる。
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("preview でなければ従来どおり実行する", async () => {
    mockIsPreview.mockReturnValue(false);
    mockGetUser.mockResolvedValue(VALID_USER);

    const result = await probeAction();

    expect(result.data).toEqual({
      userId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("preview でなくセッションが無ければ unauthenticated", async () => {
    mockIsPreview.mockReturnValue(false);
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await probeAction();

    expect(result.serverError).toEqual({
      kind: "unauthenticated",
      message: "サインインが必要です。",
    });
  });
});
