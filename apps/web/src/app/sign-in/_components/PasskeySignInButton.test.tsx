import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PasskeySignInButton } from "./PasskeySignInButton";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// `PasskeySignInButton` は独自の passkey 用 browser client を作るため
// `src/env.ts` を直接読む（`RegisterPasskeyButton.test.tsx` と同じ理由）。
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

const signInWithPasskey = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: vi.fn(() => ({
    auth: { signInWithPasskey },
  })),
}));

describe("PasskeySignInButton", () => {
  it("redirects to / and refreshes on a successful ceremony", async () => {
    // Issue #406: oracle-routes-ui.md:49 の Passkey サインイン導線が
    // 実際に配線されていることを確認する regression test。
    signInWithPasskey.mockResolvedValueOnce({ data: {}, error: null });
    const user = userEvent.setup();

    render(<PasskeySignInButton />);
    await user.click(
      screen.getByRole("button", { name: "Passkeyでサインイン" }),
    );

    expect(signInWithPasskey).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows the specific 'unsupported' feedback (not a generic message) when the device can't do WebAuthn", async () => {
    signInWithPasskey.mockResolvedValueOnce({
      data: null,
      error: { message: "invalid domain", code: "ERROR_INVALID_DOMAIN" },
    });
    const user = userEvent.setup();

    render(<PasskeySignInButton />);
    await user.click(
      screen.getByRole("button", { name: "Passkeyでサインイン" }),
    );

    expect(
      await screen.findByText(
        "この端末・ブラウザではPasskeyサインインを利用できません",
      ),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the generic failure feedback, guiding to Magic Link, for an unrecognized error code", async () => {
    signInWithPasskey.mockResolvedValueOnce({
      data: null,
      error: { message: "network error" },
    });
    const user = userEvent.setup();

    render(<PasskeySignInButton />);
    await user.click(
      screen.getByRole("button", { name: "Passkeyでサインイン" }),
    );

    expect(
      await screen.findByText("Passkeyサインインに失敗しました"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "通信状況を確認してもう一度お試しいただくか、下のメールアドレスからサインインしてください。",
      ),
    ).toBeInTheDocument();
  });
});
