import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 * Codex P1 (docs/v2/decisions.md): Preview must not send magic links at
 * all. `requestSignInLink`'s enumeration-resistance contract (identical
 * response regardless of account existence / send success) must survive
 * this change - the redirect target must stay exactly `ACKNOWLEDGEMENT`.
 */
describe("requestSignInLink - Preview environment authenticated-flow rejection", () => {
  beforeEach(() => {
    mockRequestMagicLink.mockReset();
    mockCreateClient.mockReset();
    mockCreateClient.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not send a magic link in preview, but redirects to the same acknowledgement as usual", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");

    await expect(
      requestSignInLink(formDataWithEmail("known@example.test")),
    ).rejects.toThrow("REDIRECT:/sign-in?requested=1");

    expect(mockRequestMagicLink).not.toHaveBeenCalled();
  });

  it("still sends a magic link outside preview (baseline unaffected)", async () => {
    await expect(
      requestSignInLink(formDataWithEmail("known@example.test")),
    ).rejects.toThrow("REDIRECT:/sign-in?requested=1");

    expect(mockRequestMagicLink).toHaveBeenCalledTimes(1);
  });

  it("still rejects a missing email the same way in preview (local input error, unrelated to preview)", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");

    await expect(requestSignInLink(formDataWithEmail(""))).rejects.toThrow(
      "REDIRECT:/sign-in?error=missing_email",
    );

    expect(mockRequestMagicLink).not.toHaveBeenCalled();
  });
});
