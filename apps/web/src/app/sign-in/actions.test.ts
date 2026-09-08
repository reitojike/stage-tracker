import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestMagicLink = vi.fn();
const mockCreateClient = vi.fn();

vi.mock("@/lib/auth/magic-link", () => ({
  requestMagicLink: (...args: unknown[]) => mockRequestMagicLink(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseCookielessServerClient: (...args: unknown[]) =>
    mockCreateClient(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { requestSignInLink } = await import("./actions");

function formDataWithEmail(email: string): FormData {
  const formData = new FormData();
  formData.set("email", email);
  return formData;
}

/**
 * `requestSignInLink` の enumeration 対策は「account の有無・送信成否の
 * いずれによっても応答を変えない」こと。redirect 先が常に同一であることが
 * その観測面なので、そこを固定する。
 */
describe("requestSignInLink", () => {
  beforeEach(() => {
    mockRequestMagicLink.mockReset();
    mockCreateClient.mockReset();
    mockCreateClient.mockResolvedValue({});
  });

  it("magic link を送り、常に同じ acknowledgement へ redirect する", async () => {
    await expect(
      requestSignInLink(formDataWithEmail("known@example.test")),
    ).rejects.toThrow("REDIRECT:/sign-in?requested=1");

    expect(mockRequestMagicLink).toHaveBeenCalledTimes(1);
  });

  it("email 未入力はローカルな入力エラーとして別扱いにする", async () => {
    // アカウントの有無とは無関係なので、これを表示しても何も漏れない。
    await expect(requestSignInLink(formDataWithEmail(""))).rejects.toThrow(
      "REDIRECT:/sign-in?error=missing_email",
    );

    expect(mockRequestMagicLink).not.toHaveBeenCalled();
  });
});
