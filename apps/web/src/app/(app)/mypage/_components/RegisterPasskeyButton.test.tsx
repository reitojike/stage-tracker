import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegisterPasskeyButton } from "./RegisterPasskeyButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const registerPasskey = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: vi.fn(() => ({
    auth: { registerPasskey },
  })),
}));

describe("RegisterPasskeyButton", () => {
  it("shows the specific 'duplicate' feedback (not a generic message) when the ceremony reports an already-registered credential", async () => {
    // M8 journey 比較（docs/v2/m8-journey-comparison.md）で確定した分類2の
    // regression test: passkey ceremony outcomes must reach the specific
    // feedback mapping through the real component wiring.
    registerPasskey.mockResolvedValueOnce({
      data: null,
      error: { message: "already exists", code: "webauthn_credential_exists" },
    });
    const user = userEvent.setup();

    render(<RegisterPasskeyButton />);
    await user.click(
      screen.getByRole("button", { name: "この端末にPasskeyを登録" }),
    );

    expect(
      await screen.findByText("このPasskeyは既に登録されています"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Passkeyを登録できませんでした。もう一度お試しください。",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows the generic failure feedback for an unrecognized error code", async () => {
    registerPasskey.mockResolvedValueOnce({
      data: null,
      error: { message: "network error" },
    });
    const user = userEvent.setup();

    render(<RegisterPasskeyButton />);
    await user.click(
      screen.getByRole("button", { name: "この端末にPasskeyを登録" }),
    );

    expect(
      await screen.findByText("Passkeyを登録できませんでした"),
    ).toBeInTheDocument();
  });
});
