import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegisterPasskeyButton } from "./RegisterPasskeyButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// `RegisterPasskeyButton` は独自の passkey 用 browser client を作るため
// `src/env.ts` を直接読む（`@/lib/supabase/browser.ts` の共有 client には
// `experimental.passkey` flag が無い、コンポーネント自身の doc comment
// 参照）。テスト環境には実際の env var が無いため、他の write-action mock
// と同じ理由でこの2つも mock する。
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

const registerPasskey = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: vi.fn(() => ({
    auth: { registerPasskey },
  })),
}));

describe("RegisterPasskeyButton", () => {
  it("shows the specific 'duplicate' feedback (not a generic message) when the ceremony reports an already-registered credential", async () => {
    // M8 journey 比較（docs/v2/m8-journey-comparison.md）で確定した分類2の
    // regression test: oracle-routes-ui.md:245 の「失敗時はエラー種別分類
    // →パネル表示」を満たすかどうかを、実際のコンポーネント配線で確認する。
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
